const mongoose = require('mongoose');

const dailyStatsSchema = new mongoose.Schema({
    // Local calendar day this snapshot represents (Africa/Addis_Ababa)
    date: {
        type: String, // Format: YYYY-MM-DD
        required: true,
        unique: true,
        index: true
    },

    // Core game metrics
    totalGames: { type: Number, default: 0 },
    totalPlayers: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalPrizes: { type: Number, default: 0 },
    botWinningsFromRealGames: { type: Number, default: 0 },

    // Finance metrics
    totalDeposits: { type: Number, default: 0 },
    totalNewUsers: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    totalPendingWithdrawals: { type: Number, default: 0 },
    totalPendingWithdrawalAmount: { type: Number, default: 0 },

    // Admin withdrawal approvals breakdown
    adminWithdrawals: [{
        adminId: { type: String },
        adminName: { type: String },
        adminTelegramId: { type: String },
        totalAmount: { type: Number, default: 0 }
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('DailyStats', dailyStatsSchema);

