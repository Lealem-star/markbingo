const mongoose = require('mongoose');

const bonusMatchSchema = new mongoose.Schema({
    team1Name: { type: String, required: true, trim: true },
    team1Flag: { type: String, default: '🏳️', trim: true },
    team2Name: { type: String, required: true, trim: true },
    team2Flag: { type: String, default: '🏳️', trim: true },
    status: {
        type: String,
        enum: ['draft', 'open', 'locked', 'settled', 'cancelled'],
        default: 'draft'
    },
    entryFee: { type: Number, default: 10 },
    systemCutRate: { type: Number, default: 0.2 },
    opensAt: { type: Date, default: Date.now },
    closesAt: { type: Date, required: true },
    finalScore1: { type: Number, default: null },
    finalScore2: { type: Number, default: null },
    entryCount: { type: Number, default: 0 },
    totalCollected: { type: Number, default: 0 },
    prizePool: { type: Number, default: 0 },
    systemAmount: { type: Number, default: 0 },
    winnerCount: { type: Number, default: 0 },
    payoutEach: { type: Number, default: 0 },
    settledAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

bonusMatchSchema.index({ status: 1, closesAt: -1 });
bonusMatchSchema.index({ status: 1, settledAt: -1 });

module.exports = mongoose.model('BonusMatch', bonusMatchSchema);
