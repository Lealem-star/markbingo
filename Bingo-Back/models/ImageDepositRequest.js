const mongoose = require('mongoose');

const imageDepositRequestSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    telegramId: {
        type: String,
        required: true,
        index: true
    },
    imageFileId: {
        type: String,
        required: true
    },
    userName: {
        type: String,
        default: null
    },
    userPhone: {
        type: String,
        default: null
    },
    amount: {
        type: Number,
        default: null  // Set when admin approves
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    approvedAt: {
        type: Date,
        default: null
    },
    rejectedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    rejectedAt: {
        type: Date,
        default: null
    },
    rejectionReason: {
        type: String,
        default: null
    },
    transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction',
        default: null
    }
}, {
    timestamps: true
});

imageDepositRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ImageDepositRequest', imageDepositRequestSchema);


