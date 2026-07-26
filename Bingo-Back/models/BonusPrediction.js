const mongoose = require('mongoose');

const bonusPredictionSchema = new mongoose.Schema({
    matchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BonusMatch',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    predictedScore1: { type: Number, required: true, min: 0, max: 30 },
    predictedScore2: { type: Number, required: true, min: 0, max: 30 },
    entryFeePaid: { type: Number, required: true },
    isWinner: { type: Boolean, default: false },
    payout: { type: Number, default: 0 }
}, { timestamps: true });

bonusPredictionSchema.index({ matchId: 1, userId: 1 }, { unique: true });
bonusPredictionSchema.index({ matchId: 1, predictedScore1: 1, predictedScore2: 1 });

module.exports = mongoose.model('BonusPrediction', bonusPredictionSchema);
