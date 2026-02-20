const express = require('express');
const router = express.Router();
const SmsForwarderService = require('../services/smsForwarderService');
const SMSRecord = require('../models/SMSRecord');
const DepositVerification = require('../models/DepositVerification');
const ImageDepositRequest = require('../models/ImageDepositRequest');
const WalletService = require('../services/walletService');

// POST /sms-forwarder/incoming - Receive SMS from forwarder
router.post('/incoming', async (req, res) => {
    try {
        const { phoneNumber, message, timestamp, source = 'forwarder' } = req.body;

        if (!phoneNumber || !message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: phoneNumber, message (non-empty)'
            });
        }

        // Store the incoming SMS
        const smsRecord = await SmsForwarderService.storeIncomingSMS({
            phoneNumber,
            message,
            timestamp: timestamp ? new Date(timestamp) : new Date(),
            source
        });

        // Try to match with existing user SMS
        const verification = await attemptAutoMatching(smsRecord);

        res.json({
            success: true,
            message: 'SMS received and processed',
            smsId: smsRecord._id,
            verificationId: verification ? verification._id : null
        });
    } catch (error) {
        console.error('SMS forwarder error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process SMS'
        });
    }
});

// POST /sms-forwarder/user-sms - User forwards their SMS
router.post('/user-sms', async (req, res) => {
    try {
        const { userId, message, phoneNumber } = req.body;
        const mongoose = require('mongoose');

        if (!userId || !message) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, message'
            });
        }

        // Validate userId format to avoid 500s from invalid ObjectId
        if (!mongoose.Types.ObjectId.isValid(String(userId))) {
            return res.status(400).json({ success: false, error: 'Invalid userId format' });
        }

        // Store user SMS
        const userSMS = await SmsForwarderService.storeIncomingSMS({
            phoneNumber: phoneNumber || 'user',
            message,
            source: 'user',
            userId
        });

        // Try to match with existing receiver SMS
        let verification = await attemptAutoMatching(userSMS);

        // If no verification was created, create a pending one from user SMS so admins get buttons
        if (!verification) {
            try {
                verification = await SmsForwarderService.createPendingVerificationFromUserSMS(userSMS);
            } catch (e) {
                console.error('Failed to create pending verification from user SMS:', e);
                // If duplicate, find existing verification so bot can show Approve/Deny buttons
                if (e?.message?.includes('DUPLICATE_VERIFICATION')) {
                    verification = await DepositVerification.findOne({
                        userSMS: userSMS._id,
                        status: { $in: ['pending_review', 'verified', 'approved'] }
                    });
                }
            }
        }

        res.json({
            success: true,
            message: 'User SMS received and processed',
            smsId: userSMS._id,
            verificationId: verification ? verification._id : null,
            status: verification ? verification.status : null,
            isVerified: verification ? verification.status === 'verified' : false
        });
    } catch (error) {
        console.error('User SMS error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process user SMS'
        });
    }
});

// GET /sms-forwarder/verifications - Get pending verifications
router.get('/verifications', async (req, res) => {
    try {
        const { limit = 50, skip = 0, status = 'pending_review' } = req.query;

        const verifications = await DepositVerification.find({ status })
            .populate('userId', 'firstName lastName phone telegramId')
            .populate('userSMS')
            .populate('receiverSMS')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(skip));

        res.json({
            success: true,
            verifications
        });
    } catch (error) {
        console.error('Get verifications error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get verifications'
        });
    }
});

// POST /sms-forwarder/approve/:id - Approve verification
router.post('/approve/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { adminId } = req.body;

        const result = await SmsForwarderService.approveVerification(id, adminId);

        res.json({
            success: true,
            message: 'Verification approved and deposit processed',
            transaction: result.transaction
        });
    } catch (error) {
        console.error('Approve verification error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to approve verification'
        });
    }
});

// POST /sms-forwarder/reject/:id - Reject verification
router.post('/reject/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { adminId, reason } = req.body;

        const result = await SmsForwarderService.rejectVerification(id, adminId, reason);

        res.json({
            success: true,
            message: 'Verification rejected',
            verification: result
        });
    } catch (error) {
        console.error('Reject verification error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to reject verification'
        });
    }
});

// POST /sms-forwarder/image-deposit - Create image deposit request
router.post('/image-deposit', async (req, res) => {
    try {
        const { userId, telegramId, imageFileId, userName, userPhone, amount } = req.body;

        if (!userId || !telegramId || !imageFileId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, telegramId, imageFileId'
            });
        }

        if (!amount || isNaN(amount) || Number(amount) < 50) {
            return res.status(400).json({
                success: false,
                error: 'Valid amount required (minimum 50).'
            });
        }

        const request = new ImageDepositRequest({
            userId,
            telegramId,
            imageFileId,
            userName: userName || null,
            userPhone: userPhone || null,
            amount: Number(amount),
            status: 'pending'
        });
        await request.save();

        res.json({
            success: true,
            requestId: request._id.toString()
        });
    } catch (error) {
        console.error('Create image deposit error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to create image deposit request'
        });
    }
});

// POST /sms-forwarder/approve-image-deposit/:id - Approve image deposit (amount stored in request)
router.post('/approve-image-deposit/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { amount } = req.body; // Optional - will use request's amount if not provided

        const request = await ImageDepositRequest.findById(id).populate('userId');
        if (!request) {
            return res.status(404).json({ success: false, error: 'Request not found' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Request already processed' });
        }

        // Use amount from request (user-entered) or from body (if provided for backward compatibility)
        const depositAmount = amount ? Number(amount) : (request.amount || 0);
        if (!depositAmount || depositAmount < 50) {
            return res.status(400).json({
                success: false,
                error: 'Valid amount required (minimum 50). Amount should be stored in request.'
            });
        }

        const result = await WalletService.processDeposit(request.userId._id, depositAmount, {
            type: 'image_deposit',
            requestId: id
        });

        request.status = 'approved';
        // Amount is already set when request was created, but ensure it's set
        if (!request.amount) {
            request.amount = depositAmount;
        }
        request.approvedAt = new Date();
        request.transactionId = result.transaction._id;
        await request.save();

        // Notify user via Telegram
        const BOT_TOKEN = process.env.BOT_TOKEN;
        const WEBAPP_URL = process.env.WEBAPP_URL || 'https://fikirbingo.com';
        const userTelegramId = request.userId?.telegramId || request.telegramId;
        if (BOT_TOKEN && userTelegramId) {
            const text = `✅ Deposit Approved!\n\n💰 Amount: ETB ${depositAmount.toFixed(2)}\n✅ Credited to: Play Wallet\n\nYour balance has been updated. Good luck!`;
            const reply_markup = {
                inline_keyboard: [
                    [{ text: '🎮 Play Now', web_app: { url: WEBAPP_URL + '?stake=10' } }],
                    [{ text: '💼 Check Balance', callback_data: 'balance' }]
                ]
            };
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(userTelegramId), text, reply_markup })
            }).catch(() => { });
        }

        res.json({
            success: true,
            message: 'Image deposit approved and credited',
            wallet: result.wallet
        });
    } catch (error) {
        console.error('Approve image deposit error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to approve image deposit'
        });
    }
});

// POST /sms-forwarder/reject-image-deposit/:id - Reject image deposit
router.post('/reject-image-deposit/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const request = await ImageDepositRequest.findById(id).populate('userId');
        if (!request) {
            return res.status(404).json({ success: false, error: 'Request not found' });
        }
        if (request.status !== 'pending') {
            return res.status(400).json({ success: false, error: 'Request already processed' });
        }

        request.status = 'rejected';
        request.rejectedAt = new Date();
        request.rejectionReason = reason || null;
        await request.save();

        // Notify user via Telegram
        const BOT_TOKEN = process.env.BOT_TOKEN;
        const WEBAPP_URL = process.env.WEBAPP_URL || 'https://fikirbingo.com';
        const userTelegramId = request.userId?.telegramId || request.telegramId;
        if (BOT_TOKEN && userTelegramId) {
            const text = `❌ Deposit Denied\n\n📷 Your receipt image was reviewed.\n${reason ? `📄 Reason: ${reason}\n\n` : '\n'}If you believe this is a mistake, please contact support.`;
            const reply_markup = {
                inline_keyboard: [
                    [{ text: '💬 Contact Support', url: 'https://t.me/Funbingosupport1' }],
                    [{ text: '🎮 Play Now', web_app: { url: WEBAPP_URL + '?stake=10' } }]
                ]
            };
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(userTelegramId), text, reply_markup })
            }).catch(() => { });
        }

        res.json({
            success: true,
            message: 'Image deposit rejected'
        });
    } catch (error) {
        console.error('Reject image deposit error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to reject image deposit'
        });
    }
});

// GET /sms-forwarder/stats - Get verification statistics
router.get('/stats', async (req, res) => {
    try {
        const stats = await DepositVerification.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        const totalSMS = await SMSRecord.countDocuments();
        const matchedSMS = await SMSRecord.countDocuments({ status: 'matched' });

        res.json({
            success: true,
            stats: {
                verifications: stats,
                sms: {
                    total: totalSMS,
                    matched: matchedSMS,
                    matchRate: totalSMS > 0 ? (matchedSMS / totalSMS) * 100 : 0
                }
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get statistics'
        });
    }
});

// Helper function to attempt automatic matching
async function attemptAutoMatching(newSMS) {
    try {
        // Find potential matches based on amount and time window (widened)
        const timeWindow = 15 * 60 * 1000; // 15 minutes
        const startTime = new Date(newSMS.timestamp.getTime() - timeWindow);
        const endTime = new Date(newSMS.timestamp.getTime() + timeWindow);

        const potentialMatches = await SMSRecord.find({
            _id: { $ne: newSMS._id },
            'parsedData.amount': newSMS.parsedData.amount,
            timestamp: { $gte: startTime, $lte: endTime },
            status: 'pending',
            source: { $ne: newSMS.source } // Only match different sources
        });

        console.log(`🔎 Auto-matching: Found ${potentialMatches.length} potential matches for SMS ${newSMS._id?.toString()?.substring(0, 8)}`, {
            newSMSSource: newSMS.source,
            newSMSAmount: newSMS.parsedData?.amount,
            newSMSTimestamp: newSMS.timestamp,
            searchWindow: `${Math.round(timeWindow / 60000)} minutes`,
            potentialMatches: potentialMatches.map(m => ({
                id: m._id?.toString()?.substring(0, 8),
                source: m.source,
                amount: m.parsedData?.amount,
                timestamp: m.timestamp
            }))
        });

        for (const potentialMatch of potentialMatches) {
            // Safety check: ensure potential match is still pending
            if (potentialMatch.status !== 'pending') {
                console.log(`Skipping potential match ${potentialMatch._id?.toString()?.substring(0, 8)}: status is ${potentialMatch.status}`);
                continue;
            }
            
            // CRITICAL: Prevent matching SMS with same reference and same source
            // This is a safety check in case duplicate detection didn't catch it
            if (newSMS.parsedData?.reference && potentialMatch.parsedData?.reference) {
                if (newSMS.parsedData.reference === potentialMatch.parsedData.reference && 
                    newSMS.source === potentialMatch.source) {
                    console.log(`⚠️ Skipping match: Same reference (${newSMS.parsedData.reference}) and same source (${newSMS.source}) - cannot match SMS with itself`, {
                        newSMSId: newSMS._id?.toString()?.substring(0, 8),
                        potentialMatchId: potentialMatch._id?.toString()?.substring(0, 8),
                        reference: newSMS.parsedData.reference
                    });
                    continue;
                }
            }
            
            // Check if they are from different sources
            if (potentialMatch.source !== newSMS.source) {
                const matchResult = await SmsForwarderService.matchSMS(newSMS, potentialMatch);

                // Determine which is user vs receiver SMS
                const userSMS = newSMS.source === 'user' ? newSMS : potentialMatch;
                const receiverSMS = newSMS.source === 'receiver' ? newSMS : potentialMatch;

                // Resolve userId if not present
                let resolvedUserId = userSMS.userId;
                if (!resolvedUserId && userSMS.phoneNumber) {
                    const User = require('../models/User');
                    const resolvedUser = await User.findOne({ phone: userSMS.phoneNumber });
                    if (resolvedUser) {
                        resolvedUserId = resolvedUser._id;
                        // Persist back to SMS record
                        await SMSRecord.findByIdAndUpdate(userSMS._id, { userId: resolvedUserId });
                    }
                }

                // Skip if we still don't have a userId
                if (!resolvedUserId) {
                    console.log(`Skipping verification: no user found for phone ${userSMS.phoneNumber}`);
                    continue;
                }

                // Check if userSMS is already matched (prevent duplicate verifications)
                if (userSMS.status === 'matched') {
                    console.log(`⚠️ Skipping match: UserSMS ${userSMS._id?.toString()?.substring(0, 8)} is already matched`);
                    continue;
                }

                // CRITICAL: Check if userSMS is already part of ANY verification before attempting to match
                // This prevents matching the same userSMS with different receiver SMS
                const DepositVerification = require('../models/DepositVerification');
                const existingVerification = await DepositVerification.findOne({
                    userSMS: userSMS._id,
                    status: { $in: ['pending_review', 'verified', 'approved'] }
                });

                if (existingVerification) {
                    const statusText = existingVerification.status === 'pending_review' ? 'pending' : existingVerification.status;
                    console.log(`⚠️ Skipping match: UserSMS ${userSMS._id?.toString()?.substring(0, 8)} is already part of ${statusText} verification ${existingVerification._id?.toString()?.substring(0, 8)}`);
                    // Mark SMS as matched to prevent further attempts
                    userSMS.status = 'matched';
                    await userSMS.save();
                    continue;
                }

                // Always create a verification record; service will set status
                // This will throw an error if duplicate verification is detected
                let verification;
                try {
                    verification = await SmsForwarderService.createDepositVerification(
                        resolvedUserId,
                        userSMS,
                        receiverSMS,
                        matchResult
                    );
                } catch (error) {
                    if (error.message && error.message.includes('DUPLICATE_VERIFICATION')) {
                        console.log(`⚠️ Duplicate verification prevented: ${error.message}`);
                        // Mark SMS as matched to prevent further attempts
                        userSMS.status = 'matched';
                        await userSMS.save();
                        continue; // Skip to next potential match
                    }
                    throw error; // Re-throw other errors
                }

                if (matchResult.isVerified) {
                    // Update SMS records status only for verified matches
                    newSMS.status = 'matched';
                    newSMS.matchedWith = potentialMatch._id;
                    await newSMS.save();

                    potentialMatch.status = 'matched';
                    potentialMatch.matchedWith = newSMS._id;
                    await potentialMatch.save();

                    console.log(`Auto-verified SMS: ${newSMS._id} with ${potentialMatch._id}`);
                } else {
                    console.log(`Created pending_review verification for SMS ${newSMS._id} with ${potentialMatch._id} (confidence ${matchResult.confidence?.toFixed(1)}%)`);
                }

                // Return the first created verification (verified or pending)
                return verification;
            }
        }
        return null;
    } catch (error) {
        console.error('Auto-matching error:', error);
        return null;
    }
}

module.exports = router;
