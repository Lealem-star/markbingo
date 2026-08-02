const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        required: true,
        unique: true
    },
    stake: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['registration', 'running', 'finished', 'cancelled'],
        default: 'registration'
    },
    players: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        cartelaNumber: {
            type: Number,
            required: true
        },
        cardData: {
            type: Object,
            required: true
        },
        joinedAt: {
            type: Date,
            default: Date.now
        }
    }],
    calledNumbers: [{
        type: Number
    }],
    winners: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        cartelaNumber: {
            type: Number
        },
        prize: {
            type: Number
        },
        winningPattern: {
            type: String
        }
    }],
    pot: {
        type: Number,
        default: 0
    },
    systemCut: {
        type: Number,
        default: 0
    },
    totalPrizes: {
        type: Number,
        default: 0
    },
    startedAt: {
        type: Date,
        default: null
    },
    finishedAt: {
        type: Date,
        default: null
    },
    registrationEndsAt: {
        type: Date,
        required: true
    },
    /** Super Bingo presale metadata (stake 50). */
    isSuperBingo: {
        type: Boolean,
        default: false
    },
    superMode: {
        type: String,
        default: null
    },
    regCode: {
        type: String,
        default: null
    },
    scheduledStartAt: {
        type: Date,
        default: null
    },
    superCountdownAnnounced: {
        type: Boolean,
        default: false
    },
    /** Paid presale cartelas — survives server restarts. */
    presaleEntries: [{
        userId: { type: String, required: true },
        cartelaNumber: { type: Number, required: true },
        confirmedAt: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true
});

// Create indexes
gameSchema.index({ status: 1 });
gameSchema.index({ status: 1, finishedAt: -1 }); // Admin stats: find finished games by date
gameSchema.index({ stake: 1 });
gameSchema.index({ 'players.userId': 1 });
gameSchema.index({ createdAt: -1 });
gameSchema.index({ isSuperBingo: 1, status: 1, scheduledStartAt: -1 });

module.exports = mongoose.model('Game', gameSchema);
