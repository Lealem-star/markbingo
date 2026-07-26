const BonusMatch = require('../models/BonusMatch');
const BonusPrediction = require('../models/BonusPrediction');
const WalletService = require('./walletService');
const NotificationService = require('./notificationService');

const DEFAULT_ENTRY_FEE = 10;
const SYSTEM_CUT_RATE = 0.2;

function formatMatchPublic(match, userPrediction = null) {
    if (!match) return null;
    const entryCount = match.entryCount || 0;
    const totalCollected = match.totalCollected || entryCount * (match.entryFee || DEFAULT_ENTRY_FEE);
    const livePrizePool = Math.floor(totalCollected * (1 - (match.systemCutRate ?? SYSTEM_CUT_RATE)));

    return {
        id: match._id.toString(),
        team1Name: match.team1Name,
        team1Flag: match.team1Flag,
        team2Name: match.team2Name,
        team2Flag: match.team2Flag,
        status: match.status,
        entryFee: match.entryFee || DEFAULT_ENTRY_FEE,
        opensAt: match.opensAt,
        closesAt: match.closesAt,
        entryCount,
        totalCollected,
        livePrizePool,
        finalScore1: match.finalScore1,
        finalScore2: match.finalScore2,
        prizePool: match.prizePool,
        winnerCount: match.winnerCount,
        payoutEach: match.payoutEach,
        settledAt: match.settledAt,
        userPrediction: userPrediction
            ? {
                predictedScore1: userPrediction.predictedScore1,
                predictedScore2: userPrediction.predictedScore2
            }
            : null
    };
}

function formatHistoryMatch(match) {
    return {
        id: match._id.toString(),
        team1Name: match.team1Name,
        team1Flag: match.team1Flag,
        team2Name: match.team2Name,
        team2Flag: match.team2Flag,
        finalScore1: match.finalScore1,
        finalScore2: match.finalScore2,
        prizePool: match.prizePool,
        winnerCount: match.winnerCount,
        payoutEach: match.payoutEach,
        entryCount: match.entryCount,
        settledAt: match.settledAt
    };
}

async function autoLockExpiredMatches() {
    const now = new Date();
    await BonusMatch.updateMany(
        { status: 'open', closesAt: { $lte: now } },
        { $set: { status: 'locked' } }
    );
}

class BonusService {
    static async getActiveMatch(userId = null) {
        await autoLockExpiredMatches();

        const match = await BonusMatch.findOne({ status: { $in: ['open', 'locked'] } })
            .sort({ opensAt: -1 });

        if (!match) {
            return null;
        }

        let userPrediction = null;
        if (userId) {
            userPrediction = await BonusPrediction.findOne({
                matchId: match._id,
                userId
            });
        }

        return formatMatchPublic(match, userPrediction);
    }

    static async getHistory(limit = 20) {
        const matches = await BonusMatch.find({ status: 'settled' })
            .sort({ settledAt: -1 })
            .limit(limit);

        return matches.map(formatHistoryMatch);
    }

    static async createMatch(data, adminUserId) {
        const closesAt = new Date(data.closesAt);
        if (Number.isNaN(closesAt.getTime())) {
            throw new Error('INVALID_CLOSES_AT');
        }

        const match = new BonusMatch({
            team1Name: data.team1Name,
            team1Flag: data.team1Flag || '🏳️',
            team2Name: data.team2Name,
            team2Flag: data.team2Flag || '🏳️',
            entryFee: DEFAULT_ENTRY_FEE,
            systemCutRate: SYSTEM_CUT_RATE,
            opensAt: data.opensAt ? new Date(data.opensAt) : new Date(),
            closesAt,
            status: data.openImmediately ? 'open' : 'draft',
            createdBy: adminUserId || null
        });

        if (match.status === 'open') {
            const existingOpen = await BonusMatch.findOne({ status: 'open' });
            if (existingOpen) {
                throw new Error('ANOTHER_MATCH_OPEN');
            }
        }

        await match.save();
        return formatMatchPublic(match);
    }

    static async openMatch(matchId) {
        await autoLockExpiredMatches();
        const match = await BonusMatch.findById(matchId);
        if (!match) throw new Error('MATCH_NOT_FOUND');
        if (match.status !== 'draft') throw new Error('MATCH_NOT_OPENABLE');

        const existingOpen = await BonusMatch.findOne({ status: 'open' });
        if (existingOpen && existingOpen._id.toString() !== String(matchId)) {
            throw new Error('ANOTHER_MATCH_OPEN');
        }

        match.status = 'open';
        match.opensAt = new Date();
        await match.save();

        return formatMatchPublic(match);
    }

    static async lockMatch(matchId) {
        const match = await BonusMatch.findByIdAndUpdate(
            matchId,
            { $set: { status: 'locked' } },
            { new: true }
        );
        if (!match) throw new Error('MATCH_NOT_FOUND');
        return formatMatchPublic(match);
    }

    static validateScore(score) {
        const n = Number(score);
        return Number.isInteger(n) && n >= 0 && n <= 30;
    }

    static async submitPrediction(userId, matchId, score1, score2) {
        await autoLockExpiredMatches();

        if (!this.validateScore(score1) || !this.validateScore(score2)) {
            throw new Error('INVALID_SCORE');
        }

        const match = await BonusMatch.findById(matchId);
        if (!match) throw new Error('MATCH_NOT_FOUND');
        if (match.status !== 'open') throw new Error('MATCH_NOT_OPEN');
        if (new Date() > new Date(match.closesAt)) {
            match.status = 'locked';
            await match.save();
            throw new Error('MATCH_CLOSED');
        }

        const existing = await BonusPrediction.findOne({ matchId: match._id, userId });
        if (existing) throw new Error('ALREADY_PREDICTED');

        const entryFee = match.entryFee || DEFAULT_ENTRY_FEE;
        const gameRef = `bonus_${match._id}`;

        try {
            await WalletService.processGameBet(userId, entryFee, gameRef);
        } catch (err) {
            if (err.message === 'INSUFFICIENT_FUNDS') {
                throw err;
            }
            throw err;
        }

        const prediction = new BonusPrediction({
            matchId: match._id,
            userId,
            predictedScore1: score1,
            predictedScore2: score2,
            entryFeePaid: entryFee
        });

        try {
            await prediction.save();
        } catch (err) {
            throw new Error('ALREADY_PREDICTED');
        }

        match.entryCount += 1;
        match.totalCollected += entryFee;
        await match.save();

        return {
            match: formatMatchPublic(match, prediction),
            prediction: {
                predictedScore1: prediction.predictedScore1,
                predictedScore2: prediction.predictedScore2
            }
        };
    }

    static async settleMatch(matchId, finalScore1, finalScore2) {
        if (!this.validateScore(finalScore1) || !this.validateScore(finalScore2)) {
            throw new Error('INVALID_SCORE');
        }

        const match = await BonusMatch.findById(matchId);
        if (!match) throw new Error('MATCH_NOT_FOUND');
        if (match.status === 'settled') throw new Error('ALREADY_SETTLED');
        if (match.status === 'cancelled') throw new Error('MATCH_CANCELLED');

        if (match.status === 'open') {
            match.status = 'locked';
        }

        const entryFee = match.entryFee || DEFAULT_ENTRY_FEE;
        const totalCollected = match.totalCollected || match.entryCount * entryFee;
        const systemCutRate = match.systemCutRate ?? SYSTEM_CUT_RATE;
        const prizePool = Math.floor(totalCollected * (1 - systemCutRate));
        const systemAmount = totalCollected - prizePool;

        const winners = await BonusPrediction.find({
            matchId: match._id,
            predictedScore1: finalScore1,
            predictedScore2: finalScore2
        });

        const winnerCount = winners.length;
        let payoutEach = 0;
        const gameRef = `bonus_${match._id}`;

        if (winnerCount > 0) {
            payoutEach = Math.floor(prizePool / winnerCount);
            for (const winner of winners) {
                if (payoutEach > 0) {
                    await WalletService.processGameWin(winner.userId, payoutEach, gameRef);
                }
                winner.isWinner = true;
                winner.payout = payoutEach;
                await winner.save();

                if (payoutEach > 0) {
                    NotificationService.notifyBonusWin(winner.userId, {
                        team1Name: match.team1Name,
                        team1Flag: match.team1Flag,
                        team2Name: match.team2Name,
                        team2Flag: match.team2Flag,
                        finalScore1,
                        finalScore2,
                        predictedScore1: winner.predictedScore1,
                        predictedScore2: winner.predictedScore2,
                        payout: payoutEach
                    }).catch((err) => {
                        console.error('Failed to send bonus win Telegram message:', err);
                    });
                }
            }
        }

        match.finalScore1 = finalScore1;
        match.finalScore2 = finalScore2;
        match.prizePool = prizePool;
        match.systemAmount = winnerCount > 0 ? systemAmount : totalCollected;
        match.winnerCount = winnerCount;
        match.payoutEach = payoutEach;
        match.status = 'settled';
        match.settledAt = new Date();
        match.totalCollected = totalCollected;
        await match.save();

        return formatHistoryMatch(match);
    }

    static async listAdminMatches(limit = 50) {
        const matches = await BonusMatch.find()
            .sort({ createdAt: -1 })
            .limit(limit);
        return matches.map((m) => ({
            ...formatHistoryMatch(m),
            status: m.status,
            opensAt: m.opensAt,
            closesAt: m.closesAt,
            totalCollected: m.totalCollected
        }));
    }
}

module.exports = BonusService;
