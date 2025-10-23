const express = require('express');
const router = express.Router();
const SmsForwarderService = require('../services/smsForwarderService');

// Webhook endpoint for SMS forwarder service
// This would be called by your SMS forwarding service (like Twilio, AWS SNS, etc.)
router.post('/webhook', async (req, res) => {
    try {
        const raw = req.body || {};
        // Normalize various possible payload keys from different forwarder apps
        const from = raw.from || raw.sender || raw.number || raw.phone || raw['in-number'] || raw.msisdn || 'unknown';
        const to = raw.to || raw.receiver || raw['in-sim'] || raw.sim || null;
        const body = raw.body || raw.message || raw.msg || raw.text || raw.key || '';
        const timestamp = raw.timestamp || raw.time || raw.receivedTime || raw.date || null;
        const messageId = raw.messageId || raw.id || raw['message-id'] || null;

        console.log('SMS Webhook received:', { from, to, body: typeof body === 'string' ? body.substring(0, 100) + '...' : typeof body });

        // Determine if this is from a user or receiver based on phone number
        // You'll need to configure which numbers are your agent numbers
        const agentNumbers = process.env.AGENT_PHONE_NUMBERS?.split(',') || [];
        const isFromAgent = agentNumbers.includes(from);

        const source = isFromAgent ? 'receiver' : 'user';

        // Store the SMS
        // Robust timestamp parsing with fallback to now
        let parsedAt = new Date();
        if (timestamp) {
            const numeric = Number(timestamp);
            if (!Number.isNaN(numeric) && numeric > 0) {
                parsedAt = new Date(numeric);
            } else {
                const parsed = Date.parse(String(timestamp));
                parsedAt = Number.isNaN(parsed) ? new Date() : new Date(parsed);
            }
        }

        const smsRecord = await SmsForwarderService.storeIncomingSMS({
            phoneNumber: from || 'unknown',
            message: body,
            timestamp: parsedAt,
            source,
            messageId
        });

        // Try to match with existing SMS
        await attemptAutoMatching(smsRecord);

        res.json({
            success: true,
            message: 'SMS processed successfully',
            smsId: smsRecord._id
        });

    } catch (error) {
        console.error('SMS webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process SMS'
        });
    }
});

// Helper function to attempt automatic matching with race condition prevention
async function attemptAutoMatching(newSMS) {
    const mongoose = require('mongoose');
    const SMSRecord = require('../models/SMSRecord');
    const User = require('../models/User');

    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            // Find potential matches based on amount and time window
            const timeWindow = 10 * 60 * 1000; // 10 minutes
            const startTime = new Date(newSMS.timestamp.getTime() - timeWindow);
            const endTime = new Date(newSMS.timestamp.getTime() + timeWindow);

            // Use session to ensure consistent reads
            const potentialMatches = await SMSRecord.find({
                _id: { $ne: newSMS._id },
                'parsedData.amount': newSMS.parsedData.amount,
                timestamp: { $gte: startTime, $lte: endTime },
                status: 'pending',
                source: { $ne: newSMS.source } // Only different sources
            }).session(session);

            // Sort by timestamp and phone number for consistent matching
            potentialMatches.sort((a, b) => {
                // First sort by phone number to group same users
                if (a.phoneNumber !== b.phoneNumber) {
                    return a.phoneNumber.localeCompare(b.phoneNumber);
                }
                // Then by timestamp (earliest first)
                return a.timestamp - b.timestamp;
            });

            console.log(`Found ${potentialMatches.length} potential matches for SMS ${newSMS._id}`);

            for (const potentialMatch of potentialMatches) {
                // Enhanced matching with better verification
                const matchResult = await SmsForwarderService.matchSMS(newSMS, potentialMatch);

                if (matchResult.isVerified) {
                    // Determine which is user SMS and which is receiver SMS
                    const userSMS = newSMS.source === 'user' ? newSMS : potentialMatch;
                    const receiverSMS = newSMS.source === 'receiver' ? newSMS : potentialMatch;

                    // Additional verification: ensure user exists and phone matches
                    if (userSMS.userId) {
                        const user = await User.findById(userSMS.userId).session(session);
                        if (!user) {
                            console.log(`User ${userSMS.userId} not found, skipping match`);
                            continue;
                        }

                        // Verify phone number matches
                        if (user.phone !== userSMS.phoneNumber) {
                            console.log(`Phone mismatch: user.phone=${user.phone}, sms.phone=${userSMS.phoneNumber}`);
                            continue;
                        }
                    }

                    // Create deposit verification within transaction
                    await SmsForwarderService.createDepositVerification(
                        userSMS.userId,
                        userSMS,
                        receiverSMS,
                        matchResult
                    );

                    // Update SMS records status within transaction
                    await SMSRecord.findByIdAndUpdate(
                        newSMS._id,
                        {
                            status: 'matched',
                            matchedWith: potentialMatch._id
                        },
                        { session }
                    );

                    await SMSRecord.findByIdAndUpdate(
                        potentialMatch._id,
                        {
                            status: 'matched',
                            matchedWith: newSMS._id
                        },
                        { session }
                    );

                    console.log(`✅ Auto-matched SMS: ${newSMS._id} with ${potentialMatch._id} (confidence: ${matchResult.confidence.toFixed(1)}%)`);
                    break; // Only break after successful match
                } else {
                    console.log(`❌ Match failed for SMS ${newSMS._id} with ${potentialMatch._id}: ${matchResult.reason}`);
                }
            }
        });
    } catch (error) {
        console.error('Auto-matching error:', error);
    } finally {
        await session.endSession();
    }
}

module.exports = router;
