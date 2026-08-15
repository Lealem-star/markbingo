/** Super Bingo (stake 50) — daily appointment at 20 AM EAT + early presale. */

const Game = require('../models/Game');

const SUPER_STAKE = 50;
const SUPER_COUNTDOWN_MS = 5 * 60 * 1000;
const ETHIOPIA_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3, no DST

function generateRegCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
}

function toEthiopiaDate(ms = Date.now()) {
    return new Date(ms + ETHIOPIA_OFFSET_MS);
}

function fromEthiopiaParts(y, m, d, hour, minute = 0) {
    return Date.UTC(y, m, d, hour, minute, 0, 0) - ETHIOPIA_OFFSET_MS;
}

/**
 * Daily Super Bingo start hour on the **phone clock** (EAT, UTC+3) — 5:00 PM.
 * Ethiopian traditional time is 6 hours behind the phone clock:
 * 5:00 PM EAT = 11:00 AM Ethiopian (ከቀን 11).
 */
const SUPER_DAILY_START_HOUR = 17;

/**
 * Next Super Bingo appointment — always the next upcoming 5:00 PM EAT slot
 * (11:00 AM Ethiopian). If today's slot has passed, returns tomorrow's.
 */
function getNextScheduledStartMs(fromMs = Date.now()) {
    const testMinutes = Number(process.env.SUPER_BINGO_TEST_MINUTES);
    if (Number.isFinite(testMinutes) && testMinutes > 0) {
        return fromMs + testMinutes * 60 * 1000;
    }

    const eth = toEthiopiaDate(fromMs);
    const y = eth.getUTCFullYear();
    const m = eth.getUTCMonth();
    const d = eth.getUTCDate();

    const todayStart = fromEthiopiaParts(y, m, d, SUPER_DAILY_START_HOUR, 0);
    if (fromMs < todayStart) {
        return todayStart;
    }

    return fromEthiopiaParts(y, m, d + 1, SUPER_DAILY_START_HOUR, 0);
}

/** Align a stored presale start with the current schedule. */
function reconcilePresaleStartMs(storedMs, fromMs = Date.now()) {
    // Keep past-due appointments so the scheduler can start the game instead of
    // bumping to the next day while players are still waiting.
    if (storedMs && Number.isFinite(storedMs) && storedMs <= fromMs) {
        return storedMs;
    }

    const expectedMs = getNextScheduledStartMs(fromMs);
    if (!storedMs || !Number.isFinite(storedMs)) {
        return expectedMs;
    }
    if (storedMs === expectedMs) {
        return storedMs;
    }
    // Snap any mismatched presale (wrong day or hour) to the current policy schedule.
    return expectedMs;
}

async function updateSuperPresaleSchedule(gameId, scheduledStartMs) {
    await Game.updateOne(
        { gameId },
        {
            $set: {
                scheduledStartAt: new Date(scheduledStartMs),
                registrationEndsAt: new Date(scheduledStartMs),
                superCountdownAnnounced: false,
                superTelegramReminderSent: false,
                superMode: 'presale',
            },
        }
    );
}

function isSuperBingoStake(stake) {
    return Number(stake) === SUPER_STAKE;
}

/** Super Bingo (ሙሉ ዝግ): every cell on the card must be covered by called numbers. */
function checkFullCardBingo(cartella, calledNumbers) {
    if (!cartella || !Array.isArray(cartella) || cartella.length !== 5) {
        return false;
    }
    if (!calledNumbers || !Array.isArray(calledNumbers)) {
        return false;
    }
    return cartella.every(
        (row) =>
            row &&
            Array.isArray(row) &&
            row.every((num) => num === 0 || calledNumbers.includes(num))
    );
}

function buildSuperSnapshotFields(room, userId) {
    if (!room?.isSuperBingo) {
        return {};
    }
    const joined = (room.userCardSelections.get(userId) || []).length > 0;
    return {
        isSuperBingo: true,
        superMode: room.superMode || 'presale',
        scheduledStartAt: room.scheduledStartAt || null,
        regCode: joined ? room.regCode : null,
        lockedSelections: Array.from(room.presaleLockedCards.get(userId) || []),
    };
}

async function saveSuperPresaleOpen(room) {
    if (!room?.isSuperBingo || !room.currentGameId) return;
    await Game.findOneAndUpdate(
        { gameId: room.currentGameId },
        {
            $set: {
                stake: room.stake,
                status: 'registration',
                isSuperBingo: true,
                superMode: room.superMode || 'presale',
                regCode: room.regCode,
                scheduledStartAt: new Date(room.scheduledStartAt),
                superCountdownAnnounced: false,
                registrationEndsAt: new Date(room.scheduledStartAt),
            },
            $setOnInsert: {
                gameId: room.currentGameId,
                presaleEntries: [],
                superTelegramReminderSent: false,
            },
        },
        { upsert: true, setDefaultsOnInsert: true }
    );
}

async function appendSuperPresaleEntry(gameId, userId, cartelaNumber) {
    const uid = String(userId);
    const cardNum = Number(cartelaNumber);
    const game = await Game.findOne({ gameId });
    if (!game) return;
    const exists = (game.presaleEntries || []).some(
        (e) => String(e.userId) === uid && Number(e.cartelaNumber) === cardNum
    );
    if (exists) return;
    await Game.updateOne(
        { gameId },
        {
            $push: {
                presaleEntries: {
                    userId: uid,
                    cartelaNumber: cardNum,
                    confirmedAt: new Date(),
                },
            },
        }
    );
}

async function markSuperCountdownAnnounced(gameId) {
    await Game.updateOne(
        { gameId },
        { superCountdownAnnounced: true, superMode: 'countdown' }
    );
}

async function findActiveSuperPresaleGame() {
    return Game.findOne({
        stake: SUPER_STAKE,
        isSuperBingo: true,
        status: 'registration',
    }).sort({ scheduledStartAt: -1, createdAt: -1 });
}

async function cancelStaleSuperPresales(exceptGameId = null) {
    const query = {
        stake: SUPER_STAKE,
        isSuperBingo: true,
        status: 'registration',
    };
    if (exceptGameId) {
        query.gameId = { $ne: exceptGameId };
    }
    await Game.updateMany(query, { status: 'cancelled' });
}

async function cancelSuperPresaleGame(gameId) {
    if (!gameId) return;
    await Game.updateOne(
        { gameId, status: 'registration' },
        {
            $set: {
                status: 'cancelled',
                superMode: 'presale',
                finishedAt: new Date(),
            },
        }
    );
}

async function finalizeSuperBingoGame(gameId) {
    if (!gameId) return;
    await Game.updateOne(
        { gameId },
        {
            $set: {
                status: 'finished',
                finishedAt: new Date(),
                superMode: 'live',
            },
        }
    );
}

module.exports = {
    SUPER_STAKE,
    SUPER_COUNTDOWN_MS,
    generateRegCode,
    getNextScheduledStartMs,
    reconcilePresaleStartMs,
    isSuperBingoStake,
    checkFullCardBingo,
    buildSuperSnapshotFields,
    saveSuperPresaleOpen,
    appendSuperPresaleEntry,
    markSuperCountdownAnnounced,
    findActiveSuperPresaleGame,
    cancelStaleSuperPresales,
    cancelSuperPresaleGame,
    updateSuperPresaleSchedule,
    finalizeSuperBingoGame,
};
