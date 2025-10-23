const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    telegramId: {
        type: String,
        required: true,
        unique: true
    },
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        default: ''
    },
    username: {
        type: String,
        default: ''
    },
    phone: {
        type: String,
        default: null
    },
    isRegistered: {
        type: Boolean,
        default: false
    },
    registrationDate: {
        type: Date,
        default: Date.now
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    totalGamesPlayed: {
        type: Number,
        default: 0
    },
    totalGamesWon: {
        type: Number,
        default: 0
    },
    totalWinnings: {
        type: Number,
        default: 0
    },
    referralCode: {
        type: String,
        unique: true,
        sparse: true
    },
    referredBy: {
        type: String,
        default: null
    },
    // Invite system fields
    invitedBy: {
        type: String,
        default: null
    },
    inviteCode: {
        type: String,
        unique: true,
        sparse: true
    },
    totalInvites: {
        type: Number,
        default: 0
    },
    inviteRewards: {
        type: Number,
        default: 0
    },
    claimedRewards: [{
        type: Number
    }],
    inviteHistory: [{
        invitedUserId: String,
        invitedAt: {
            type: Date,
            default: Date.now
        },
        rewardEarned: {
            type: Number,
            default: 0
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'rewarded'],
            default: 'pending'
        }
    }],
    isActive: {
        type: Boolean,
        default: true
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
        index: true
    }
}, {
    timestamps: true
});

// Create indexes for better performance
userSchema.index({ phone: 1 });
userSchema.index({ isActive: 1 });

module.exports = mongoose.model('User', userSchema);
