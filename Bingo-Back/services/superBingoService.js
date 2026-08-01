/** Super Bingo (stake 50) — weekend appointment + early registration. */

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
 * Next scheduled Super Bingo start: Saturday or Sunday at 21:00 Ethiopia time.
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
    const dow = eth.getUTCDay(); // 0 Sun … 6 Sat
    const hour = eth.getUTCHours();
    const minute = eth.getUTCMinutes();

    const candidates = [];

    const todayAt22 = fromEthiopiaParts(y, m, d, 21, 0);
    if ((dow === 6 || dow === 0) && fromMs < todayAt22) {
        candidates.push(todayAt22);
    }

    for (let add = 1; add <= 14; add++) {
        const t = new Date(fromMs + add * 24 * 60 * 60 * 1000);
        const e = toEthiopiaDate(t.getTime());
        const dow2 = e.getUTCDay();
        if (dow2 === 6 || dow2 === 0) {
            candidates.push(
                fromEthiopiaParts(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate(), 21, 0)
            );
            break;
        }
    }

    if (candidates.length === 0) {
        return fromMs + 7 * 24 * 60 * 60 * 1000;
    }
    return Math.min(...candidates.filter((c) => c > fromMs));
}

function isWeekendLiveWindow(fromMs = Date.now()) {
    const eth = toEthiopiaDate(fromMs);
    const dow = eth.getUTCDay();
    if (dow !== 6 && dow !== 0) return false;
    const h = eth.getUTCHours();
    return h >= 21 || h < 2;
}

function isSuperBingoStake(stake) {
    return Number(stake) === SUPER_STAKE;
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

module.exports = {
    SUPER_STAKE,
    SUPER_COUNTDOWN_MS,
    generateRegCode,
    getNextScheduledStartMs,
    isWeekendLiveWindow,
    isSuperBingoStake,
    buildSuperSnapshotFields,
};
