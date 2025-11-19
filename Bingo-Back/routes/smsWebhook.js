const express = require('express');
const router = express.Router();
const SmsForwarderService = require('../services/smsForwarderService');

// Webhook endpoint for SMS forwarder service
// This would be called by your SMS forwarding service (like Twilio, AWS SNS, etc.)
router.post('/webhook', async (req, res) => {
    try {
        const raw = req.body || {};
        // Secret check removed: accept requests without custom headers
        // Normalize various possible payload keys from different forwarder apps
        const from = raw.from || raw.sender || raw.number || raw.phone || raw['in-number'] || raw.msisdn || 'unknown';
        const to = raw.to || raw.receiver || raw['in-sim'] || raw.sim || null;
        const body = raw.body || raw.message || raw.msg || raw.text || raw.key || '';
        const timestamp = raw.timestamp || raw.time || raw.receivedTime || raw.date || null;
        const messageId = raw.messageId || raw.id || raw['message-id'] || null;

        // Validate that we have a non-empty message
        if (!body || typeof body !== 'string' || !body.trim()) {
            console.log('SMS Webhook: Empty or invalid message body, skipping processing');
            return res.status(400).json({
                success: false,
                error: 'Empty or invalid message body'
            });
        }

        // Determine if this is from a user or receiver based on phone number or service name
        // The 'from' field can contain:
        // - Phone numbers (e.g., "127" for short codes)
        // - Service identifiers (e.g., "CBE", "CBEBirr", "Telebirr")
        // Configuration from environment variables:
        // - AGENT_PHONE_NUMBERS: Comma-separated phone numbers (e.g., "127,0934551781")
        // - AGENT_SERVICES: Comma-separated service names (e.g., "CBE,CBEBirr,Telebirr")
        const agentNumbers = (process.env.AGENT_PHONE_NUMBERS?.split(',') || []).map(n => n.trim());
        const agentServices = (process.env.AGENT_SERVICES?.split(',') || []).map(s => s.trim().toLowerCase());
        
        // Case-insensitive matching for services, exact match for phone numbers
        const fromLower = String(from).toLowerCase().trim();
        const fromTrimmed = String(from).trim();
        const isFromAgent = agentNumbers.includes(fromTrimmed) || 
                           agentServices.includes(fromLower);

        const source = isFromAgent ? 'receiver' : 'user';
        
        // Log source determination for debugging
        console.log('🔍 Source determination:', {
            from,
            fromTrimmed,
            fromLower,
            agentNumbers,
            agentServices,
            isFromAgent,
            source,
            matchedBy: isFromAgent 
                ? (agentNumbers.includes(fromTrimmed) ? 'phone_number' : 'service_name')
                : 'none'
        });

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

        console.log('📨 SMS Webhook received:', {
            from,
            to,
            source,
            bodyPreview: typeof body === 'string' ? body.substring(0, 150) + (body.length > 150 ? '...' : '') : typeof body,
            timestamp: parsedAt
        });

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
            const timeWindow = 15 * 60 * 1000; // 15 minutes
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

            console.log(`🔎 Webhook Auto-matching: Found ${potentialMatches.length} potential matches for SMS ${newSMS._id?.toString()?.substring(0, 8)}`, {
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
                // Safety check: reload potential match to ensure it's still pending (not matched by another transaction)
                const freshMatch = await SMSRecord.findById(potentialMatch._id).session(session);
                if (!freshMatch || freshMatch.status !== 'pending') {
                    console.log(`Skipping potential match ${freshMatch?._id?.toString()?.substring(0, 8)}: status is ${freshMatch?.status || 'not found'}`);
                    continue;
                }
                
                // CRITICAL: Prevent matching SMS with same reference and same source
                // This is a safety check in case duplicate detection didn't catch it
                if (newSMS.parsedData?.reference && freshMatch.parsedData?.reference) {
                    if (newSMS.parsedData.reference === freshMatch.parsedData.reference && 
                        newSMS.source === freshMatch.source) {
                        console.log(`⚠️ Skipping match: Same reference (${newSMS.parsedData.reference}) and same source (${newSMS.source}) - cannot match SMS with itself`, {
                            newSMSId: newSMS._id?.toString()?.substring(0, 8),
                            potentialMatchId: freshMatch._id?.toString()?.substring(0, 8),
                            reference: newSMS.parsedData.reference
                        });
                        continue;
                    }
                }
                
                // Enhanced matching with better verification
                const matchResult = await SmsForwarderService.matchSMS(newSMS, freshMatch);

                if (matchResult.isVerified) {
                    // Determine which is user SMS and which is receiver SMS
                    const userSMS = newSMS.source === 'user' ? newSMS : freshMatch;
                    const receiverSMS = newSMS.source === 'receiver' ? newSMS : freshMatch;

                    // Attach user by userId if present; otherwise attempt lookup by phone number
                    let resolvedUserId = userSMS.userId;
                    let resolvedUser = null;
                    if (resolvedUserId) {
                        resolvedUser = await User.findById(resolvedUserId).session(session);
                        if (!resolvedUser) {
                            console.log(`User ${resolvedUserId} not found, skipping match`);
                            continue;
                        }
                    } else if (userSMS.phoneNumber) {
                        resolvedUser = await User.findOne({ phone: userSMS.phoneNumber }).session(session);
                        if (resolvedUser) {
                            resolvedUserId = resolvedUser._id;
                            // Persist back to SMS so it’s linked for future
                            await SMSRecord.findByIdAndUpdate(userSMS._id, { userId: resolvedUserId }).session(session);
                        }
                    }

                    // If we still have no user, skip creating verification (cannot credit without user)
                    if (!resolvedUserId) {
                        console.log(`Skipping verification: no user found for phone ${userSMS.phoneNumber}`);
                        continue;
                    }

                    // Verify phone number matches if we have a user
                    if (resolvedUser && resolvedUser.phone && userSMS.phoneNumber && resolvedUser.phone !== userSMS.phoneNumber) {
                        console.log(`Phone mismatch: user.phone=${resolvedUser.phone}, sms.phone=${userSMS.phoneNumber}`);
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
                    }).session(session);

                    if (existingVerification) {
                        const statusText = existingVerification.status === 'pending_review' ? 'pending' : existingVerification.status;
                        console.log(`⚠️ Skipping match: UserSMS ${userSMS._id?.toString()?.substring(0, 8)} is already part of ${statusText} verification ${existingVerification._id?.toString()?.substring(0, 8)}`);
                        // Mark SMS as matched to prevent further attempts
                        await SMSRecord.findByIdAndUpdate(userSMS._id, { status: 'matched' }).session(session);
                        continue;
                    }

                    // Create deposit verification within transaction
                    // This will throw an error if duplicate verification is detected
                    try {
                        await SmsForwarderService.createDepositVerification(
                            resolvedUserId,
                            userSMS,
                            receiverSMS,
                            matchResult
                        );
                    } catch (error) {
                        if (error.message && error.message.includes('DUPLICATE_VERIFICATION')) {
                            console.log(`⚠️ Duplicate verification prevented: ${error.message}`);
                            // Mark SMS as matched to prevent further attempts
                            await SMSRecord.findByIdAndUpdate(userSMS._id, { status: 'matched' }).session(session);
                            continue; // Skip to next potential match
                        }
                        throw error; // Re-throw other errors
                    }

                    // Update SMS records status within transaction
                    await SMSRecord.findByIdAndUpdate(
                        newSMS._id,
                        {
                            status: 'matched',
                            matchedWith: freshMatch._id
                        },
                        { session }
                    );

                    await SMSRecord.findByIdAndUpdate(
                        freshMatch._id,
                        {
                            status: 'matched',
                            matchedWith: newSMS._id
                        },
                        { session }
                    );

                    console.log(`✅ Auto-matched SMS: ${newSMS._id} with ${freshMatch._id} (confidence: ${matchResult.confidence.toFixed(1)}%)`);
                    break; // Only break after successful match
                } else {
                    console.log(`❌ Match failed for SMS ${newSMS._id} with ${freshMatch._id}: ${matchResult.reason}`);
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

// TEMP ADMIN ROUTE: Repair bad timestamps (e.g., 2001) from parsed datetime
// Call once: POST /sms-webhook/repair-timestamps
router.post('/repair-timestamps', async (req, res) => {
    try {
        const result = await SmsForwarderService.repairBadTimestamps(2000);
        res.json({ success: true, ...result });
    } catch (e) {
        console.error('repair-timestamps error:', e);
        res.status(500).json({ success: false, error: 'repair_failed' });
    }
});
