const mongoose = require('mongoose');
const SMSRecord = require('../models/SMSRecord');
const DepositVerification = require('../models/DepositVerification');

// SMS Forwarder Service for dual SMS verification
class SmsForwarderService {

    // Store incoming SMS from forwarder
    static async storeIncomingSMS(smsData) {
        try {
            // Additional validation to prevent empty messages
            if (!smsData.message || typeof smsData.message !== 'string' || !smsData.message.trim()) {
                throw new Error('Message cannot be empty or invalid');
            }

            // Parse content first to try to derive an accurate event timestamp from the SMS body
            const parsedData = this.parseSMSContent(smsData.message);

            // Check for duplicate SMS: same reference, same source, same userId within 1 hour
            // This prevents users from sending the same SMS twice to get verified
            if (parsedData?.reference && smsData.userId) {
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                const existingDuplicate = await SMSRecord.findOne({
                    'parsedData.reference': parsedData.reference,
                    source: smsData.source || 'forwarder',
                    userId: smsData.userId,
                    timestamp: { $gte: oneHourAgo }
                    // Removed status filter to catch ALL duplicates regardless of status
                });

                if (existingDuplicate) {
                    console.log(`⚠️ Duplicate SMS detected: Same reference (${parsedData.reference}), source (${smsData.source || 'forwarder'}), and userId (${smsData.userId}) within 1 hour. Skipping storage.`, {
                        existingSMSId: existingDuplicate._id?.toString()?.substring(0, 8),
                        existingStatus: existingDuplicate.status,
                        reference: parsedData.reference
                    });
                    // Return the existing SMS record instead of creating a duplicate
                    return existingDuplicate;
                }
            }

            // Also check for duplicate by message content hash (for cases without reference)
            // Check if same message content, same source, same userId within 1 hour
            if (smsData.userId && smsData.message) {
                const messageHash = require('crypto').createHash('md5').update(smsData.message.trim()).digest('hex');
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                const existingByContent = await SMSRecord.findOne({
                    source: smsData.source || 'forwarder',
                    userId: smsData.userId,
                    timestamp: { $gte: oneHourAgo }
                    // Removed status filter to catch ALL duplicates regardless of status
                });

                // Compare message content if found
                if (existingByContent && existingByContent.message) {
                    const existingHash = require('crypto').createHash('md5').update(existingByContent.message.trim()).digest('hex');
                    if (existingHash === messageHash) {
                        console.log(`⚠️ Duplicate SMS detected: Same message content, source (${smsData.source || 'forwarder'}), and userId (${smsData.userId}) within 1 hour. Skipping storage.`, {
                            existingSMSId: existingByContent._id?.toString()?.substring(0, 8),
                            existingStatus: existingByContent.status
                        });
                        return existingByContent;
                    }
                }
            }

            // Helper to convert parsed datetime like "04/11/2025 13:18:47" into a Date
            function parseParsedDatetimeToDate(dtString) {
                if (!dtString || typeof dtString !== 'string') return null;
                // Try DD/MM/YYYY HH:MM(:SS)?
                let m = dtString.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
                if (m) {
                    const [_, dd, mm, yyyy, HH, MM, SS] = m;
                    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS || 0));
                    if (!isNaN(date.getTime())) return date;
                }
                // Try DD/MM/YY HH:MM (assume 20YY)
                m = dtString.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
                if (m) {
                    const [_, dd, mm, yy, HH, MM, SS] = m;
                    const yyyy = 2000 + Number(yy);
                    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS || 0));
                    if (!isNaN(date.getTime())) return date;
                }
                // Fallback: try native Date
                const d = new Date(dtString);
                return isNaN(d.getTime()) ? null : d;
            }

            const parsedTimestamp = parseParsedDatetimeToDate(parsedData?.datetime);
            // Prefer timestamp parsed from the SMS body over incoming timestamp from forwarder
            const effectiveTimestamp = parsedTimestamp || (smsData.timestamp ? new Date(smsData.timestamp) : new Date());

            const smsRecord = new SMSRecord({
                phoneNumber: smsData.phoneNumber,
                message: smsData.message.trim(), // Ensure trimmed message
                timestamp: effectiveTimestamp,
                source: smsData.source || 'forwarder',
                parsedData,
                status: 'pending',
                userId: smsData.userId || null
            });

            await smsRecord.save();

            // Log parsed data for debugging
            console.log(`💾 SMS Stored:`, {
                id: smsRecord._id?.toString()?.substring(0, 8),
                source: smsRecord.source,
                phoneNumber: smsRecord.phoneNumber,
                amount: parsedData?.amount,
                reference: parsedData?.reference,
                datetime: parsedData?.datetime,
                timestamp: smsRecord.timestamp,
                userId: smsRecord.userId?.toString()?.substring(0, 8) || null
            });

            return smsRecord;
        } catch (error) {
            console.error('Error storing SMS:', error);
            throw error;
        }
    }

    // Repair existing records that have wrong timestamps (e.g., year 2001) using parsedData.datetime
    static async repairBadTimestamps(limit = 1000) {
        try {
            const SMSRecord = require('../models/SMSRecord');

            // Helper to convert parsed datetime like "04/11/2025 13:18:47" into a Date
            function parseParsedDatetimeToDate(dtString) {
                if (!dtString || typeof dtString !== 'string') return null;
                let m = dtString.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
                if (m) {
                    const [_, dd, mm, yyyy, HH, MM, SS] = m;
                    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS || 0));
                    if (!isNaN(date.getTime())) return date;
                }
                m = dtString.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
                if (m) {
                    const [_, dd, mm, yy, HH, MM, SS] = m;
                    const yyyy = 2000 + Number(yy);
                    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS || 0));
                    if (!isNaN(date.getTime())) return date;
                }
                return null;
            }

            const candidates = await SMSRecord.find({
                status: 'pending',
                timestamp: { $lt: new Date('2010-01-01T00:00:00Z') },
                'parsedData.datetime': { $ne: null }
            }).limit(limit);

            let fixed = 0;
            for (const rec of candidates) {
                const repaired = parseParsedDatetimeToDate(rec.parsedData?.datetime);
                if (repaired) {
                    await SMSRecord.findByIdAndUpdate(rec._id, { timestamp: repaired });
                    fixed += 1;
                }
            }

            console.log(`🛠️ Repaired timestamps for ${fixed} SMS records`);
            return { fixed, scanned: candidates.length };
        } catch (e) {
            console.error('Error repairing SMS timestamps:', e);
            throw e;
        }
    }

    // Parse SMS content to extract transaction details
    static parseSMSContent(message) {
        if (typeof message !== 'string' || !message.trim()) {
            return {
                amount: null,
                reference: null,
                datetime: null,
                paymentMethod: null,
                phoneNumber: null,
                rawMessage: message ?? ''
            };
        }
        const patterns = {
            // Amount patterns
            amount: [
                /ETB\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
                /(\d+(?:\.\d{1,2})?)\s*ETB/i,
                /(\d+(?:\.\d{1,2})?)\s*ብር/i,
                /(\d+(?:\.\d{1,2})?)\s*Br\.?/i,
                /(\d+(?:\.\d{1,2})?)\s*Birr/i,
                /(\d+(?:\.\d{1,2})?)/i
            ],
            // Reference/Transaction ID patterns (more specific first)
            reference: [
                /id=([A-Z0-9]+)/i,  // CBE: "id=FT25242NR98315847959" or "id=ABC123"
                /\b(FT[0-9A-Z]{10,})\b/i, // CBE FT code (longer pattern for CBE)
                /\bFT\d+([A-Z0-9]+)/i, // CBE FT code variant
                /\bref\s*no\s*[:\-]?\s*([A-Z0-9]+)/i, // Ref No ABC123
                /\btxn\s*id\s*[:\-]?\s*([A-Z0-9]+)/i, // CBEBirr: "Txn ID CJS8X0WT0Y"
                /\btransaction\s*id\s*[:\-]?\s*([A-Z0-9]+)/i, // Alternative: "Transaction ID ABC123"
                /your\s+transaction\s+number\s+is\s*([A-Z0-9]+)/i, // Telebirr: "Your transaction number is CK45VJZ8JX"
                /transaction\s+number\s+is\s*([A-Z0-9]+)/i, // Alternative format
                /transaction\s+code\s*[:\-]?\s*([A-Z0-9]+)/i, // Some services use "code"
                /txn\s*code\s*[:\-]?\s*([A-Z0-9]+)/i, // Short form
                /id[:\s]*([A-Z0-9]{8,})/i, // Generic ID pattern (minimum 8 chars to avoid false matches)
                /ref[:\s]*([A-Z0-9]{8,})/i, // Generic ref pattern (minimum 8 chars)
                /reference[:\s]*([A-Z0-9]+)/i,
                /\btxn[:\s]*([A-Z0-9]+)/i
            ],
            // Date/Time patterns (order matters - most specific first)
            datetime: [
                /on\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+at\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i,  // "on 04/11/2025 at 13:18:47"
                /on\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i,  // "on 04/11/2025 13:18:47" (telebirr format)
                /([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i,  // "04/11/2025 13:18:47"
                /([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2})/i,  // "04/11/2025 13:18"
                /time[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2})/i,
                /\b([0-9]{2}\/[0-9]{2}\/[0-9]{2})\s+([0-9]{2}:[0-9]{2})\b/i  // CBEBirr: "28/10/25 13:21"
            ],
            // Payment method patterns
            paymentMethod: [
                /telebirr/i,
                /cbebirr/i,
                /commercial\s+bank|cbe\s*birr|\bCBE\b/i,
                /awash/i,
                /dashen/i
            ],
            // Phone number patterns (extract from SMS content)
            phoneNumber: [
                /to\s*(\+?251[0-9]{9})/i,
                /from\s*(\+?251[0-9]{9})/i,
                /(\+?251[0-9]{9})/i,
                /(09[0-9]{8})/i,
                /(9[0-9]{8})/i
            ],
            // CBE specific patterns
            cbeRecipient: [
                /to\s+([A-Za-z\s]+)\s+on/i,  // transfers: "to Name on"
                /transferred\s+ETB\s+[\d.]+?\s+to\s+([A-Za-z\s]+)\s+on/i,
                /from\s+([A-Za-z\s]+)[,\s]/i  // credits: "from Name,"
            ],
            // Account number patterns (CBE specific)
            accountNumber: [
                /account\s+no[:\s]*([\d\*]{10,})/i,  // "account no: 1*********7959" or "account 1000415847959"
                /account[:\s]*([\d\*]{10,})/i,  // "account: 1000415847959" (CBE account numbers are usually 13 digits)
                /from\s+your\s+account\s+([\d\*]+)/i,
                /to\s+account\s+([\d\*]{10,})/i,  // "to account 1000415847959"
                /account\s+([\d\*]{10,})/i  // Generic account pattern (10+ digits for CBE)
            ]
        };

        const parsed = {
            amount: null,
            reference: null,
            datetime: null,
            paymentMethod: null,
            phoneNumber: null,
            recipientName: null,  // NEW: For CBE transfers
            accountNumber: null,  // NEW: Account number
            rawMessage: message
        };

        // Extract amount
        for (const pattern of patterns.amount) {
            const match = message.match(pattern);
            if (match) {
                parsed.amount = Number(match[1]);
                if (parsed.amount >= 50) break; // Minimum deposit amount
            }
        }

        // Extract reference
        for (const pattern of patterns.reference) {
            const match = message.match(pattern);
            if (match) {
                parsed.reference = match[1];
                break;
            }
        }

        // Extract datetime (combine date and time groups)
        for (const pattern of patterns.datetime) {
            const match = message.match(pattern);
            if (match && match.length >= 3) {
                // Combine date (group 1) and time (group 2) into full datetime string
                parsed.datetime = `${match[1]} ${match[2]}`;
                break;
            } else if (match && match[0]) {
                // Fallback: use full match if no groups
                parsed.datetime = match[0];
                break;
            }
        }

        // Extract payment method - map to stable labels (CBE vs CBEBirr are distinct)
        for (const pattern of patterns.paymentMethod) {
            if (pattern.test(message)) {
                if (/telebirr/i.test(message)) {
                    parsed.paymentMethod = 'telebirr';
                } else if (/cbebirr|cbe\s*birr/i.test(message)) {
                    // Brand: CBE Birr (mobile money)
                    parsed.paymentMethod = 'cbebirr';
                } else if (/\bCBE\b|commercial\s+bank/i.test(message)) {
                    // Bank SMS (not CBE Birr)
                    parsed.paymentMethod = 'cbe';
                } else if (/awash/i.test(message)) {
                    parsed.paymentMethod = 'awash';
                } else if (/dashen/i.test(message)) {
                    parsed.paymentMethod = 'dashen';
                } else {
                    parsed.paymentMethod = 'unknown';
                }
                break;
            }
        }

        // Extract transaction type for banks (credited/debited/transferred)
        if (/\bcredited\b/i.test(message)) {
            parsed.transactionType = 'credit';
        } else if (/\bdebited\b/i.test(message)) {
            parsed.transactionType = 'debit';
        } else if (/\btransferred\b/i.test(message)) {
            parsed.transactionType = 'transfer';
        }

        // Extract phone number from SMS content
        for (const pattern of patterns.phoneNumber) {
            const match = message.match(pattern);
            if (match) {
                parsed.phoneNumber = this.normalizePhoneNumber(match[1]);
                break;
            }
        }

        // Extract recipient name (for CBE transfers)
        for (const pattern of patterns.cbeRecipient) {
            const match = message.match(pattern);
            if (match) {
                parsed.recipientName = match[1].trim();
                break;
            }
        }


        // Extract account number (for CBE matching)
        for (const pattern of patterns.accountNumber) {
            const match = message.match(pattern);
            if (match) {
                // Normalize account number (remove masks, keep only digits)
                const accountNum = match[1].replace(/\*/g, '').replace(/\D/g, '');
                if (accountNum.length >= 10) {
                    parsed.accountNumber = accountNum;
                    break;
                }
            }
        }

        return parsed;
    }

    // Match user SMS with receiver SMS
    static async matchSMS(userSMS, receiverSMS) {
        try {
            // CRITICAL SAFETY CHECK: Ensure SMS are from different sources
            // This applies to ALL payment methods: Telebirr, CBEBirr, CBE, and others
            // Matching is only allowed between 'user' and 'receiver' sources
            if (userSMS.source === receiverSMS.source) {
                const userPaymentMethod = userSMS.parsedData?.paymentMethod || 'unknown';
                const receiverPaymentMethod = receiverSMS.parsedData?.paymentMethod || 'unknown';
                const paymentMethod = userPaymentMethod !== 'unknown' ? userPaymentMethod : receiverPaymentMethod;
                console.log(`⚠️ Skipping match: Both SMS are from same source (${userSMS.source}) for payment method: ${paymentMethod}`);
                console.log(`   Matching requires different sources: user ↔ receiver`);
                console.log(`   This validation applies to: Telebirr, CBEBirr, CBE, and all other payment methods`);
                return {
                    matches: {},
                    criticalScore: 0,
                    optionalScore: 0,
                    matchScore: 0,
                    totalCriteria: 0,
                    confidence: 0,
                    isVerified: false,
                    reason: `Same source (${userSMS.source}) - matching not allowed for ${paymentMethod}. Requires user ↔ receiver.`
                };
            }

            const userParsed = userSMS.parsedData;
            const receiverParsed = receiverSMS.parsedData;

            // Enhanced matching criteria
            const matches = {
                amountMatch: false,
                referenceMatch: false,
                timeMatch: false,
                paymentMethodMatch: false,
                phoneMatch: false,  // Phone number matching
                recipientMatch: false,  // NEW: Recipient name matching (CBE)
                accountMatch: false  // NEW: Account number matching
            };

            // Amount matching (exact match required)
            if (userParsed.amount && receiverParsed.amount) {
                matches.amountMatch = Math.abs(userParsed.amount - receiverParsed.amount) < 0.01;
            }

            // NEW: Phone number matching (critical for preventing wrong user assignments)
            if (userSMS.phoneNumber && receiverSMS.phoneNumber) {
                matches.phoneMatch = this.normalizePhoneNumber(userSMS.phoneNumber) === this.normalizePhoneNumber(receiverSMS.phoneNumber);
            }

            // Reference matching (highest priority for simultaneous deposits)
            if (userParsed.reference && receiverParsed.reference) {
                matches.referenceMatch = userParsed.reference === receiverParsed.reference;
            }

            // Time matching (using proper DD/MM/YYYY parsing)
            if (userParsed.datetime && receiverParsed.datetime) {
                // Use the same datetime parsing logic as in storeIncomingSMS
                function parseDatetimeString(dtString) {
                    if (!dtString || typeof dtString !== 'string') return null;
                    // Try DD/MM/YYYY HH:MM(:SS)
                    let m = dtString.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
                    if (m) {
                        const [_, dd, mm, yyyy, HH, MM, SS] = m;
                        const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS || 0));
                        if (!isNaN(date.getTime())) return date;
                    }
                    // Try DD/MM/YY HH:MM (assume 20YY)
                    m = dtString.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
                    if (m) {
                        const [_, dd, mm, yy, HH, MM, SS] = m;
                        const yyyy = 2000 + Number(yy);
                        const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS || 0));
                        if (!isNaN(date.getTime())) return date;
                    }
                    return null;
                }

                const userTime = parseDatetimeString(userParsed.datetime);
                const receiverTime = parseDatetimeString(receiverParsed.datetime);

                if (userTime && receiverTime) {
                    const timeDiff = Math.abs(userTime.getTime() - receiverTime.getTime());
                    matches.timeMatch = timeDiff <= 15 * 60 * 1000; // 15 minutes window (aligned with search window)
                }
            }

            // Payment method matching
            if (userParsed.paymentMethod && receiverParsed.paymentMethod) {
                matches.paymentMethodMatch = userParsed.paymentMethod === receiverParsed.paymentMethod;
            }

            // NEW: Recipient name matching (for CBE transfers)
            if (userParsed.recipientName && receiverParsed.recipientName) {
                matches.recipientMatch = userParsed.recipientName.toLowerCase() === receiverParsed.recipientName.toLowerCase();
            }

            // NEW: Account number matching (for CBE - handle masked accounts)
            if (userParsed.accountNumber && receiverParsed.accountNumber) {
                // Account numbers are already normalized (digits only) from parsing
                // But handle both normalized and raw formats
                const userAccount = String(userParsed.accountNumber).replace(/\*/g, '').replace(/\D/g, '');
                const receiverAccount = String(receiverParsed.accountNumber).replace(/\*/g, '').replace(/\D/g, '');
                // Match if full match or last 4 digits match (common for masked accounts like 1*********7959)
                if (userAccount === receiverAccount) {
                    matches.accountMatch = true;
                } else if (userAccount.length >= 4 && receiverAccount.length >= 4) {
                    // Check if last 4 digits match (for masked accounts)
                    matches.accountMatch = userAccount.slice(-4) === receiverAccount.slice(-4);
                }
            }

            // Enhanced scoring with weighted criteria
            const criticalMatches = [matches.amountMatch];
            const optionalMatches = [matches.referenceMatch, matches.timeMatch, matches.paymentMethodMatch, matches.recipientMatch, matches.accountMatch, matches.phoneMatch];

            const criticalScore = criticalMatches.filter(Boolean).length;
            const optionalScore = optionalMatches.filter(Boolean).length;

            // Weighted confidence calculation
            const totalPossibleScore = (criticalMatches.length * 2) + optionalMatches.length;
            const actualScore = (criticalScore * 2) + optionalScore;
            const confidence = totalPossibleScore > 0 ? (actualScore / totalPossibleScore) * 100 : 0;

            // Verify sources are different (already checked at function start, but log for clarity)
            const sourcesAreDifferent = userSMS.source !== receiverSMS.source;
            if (!sourcesAreDifferent) {
                // This should not happen due to early return, but log if it does
                console.warn(`⚠️ WARNING: Matching attempted with same source (${userSMS.source}) - this should have been caught earlier`);
            }

            // STRICT AUTO-APPROVAL: Require ALL fields to match
            // Amount, reference, datetime, and payment method must ALL be present and match
            // Phone number is parsed but NOT required for matching (optional field)
            let isVerified = false;
            if (matches.amountMatch) {
                // Check if all required fields are present in both SMS
                const userHasAllFields = userParsed.amount && userParsed.reference && userParsed.datetime && userParsed.paymentMethod;
                const receiverHasAllFields = receiverParsed.amount && receiverParsed.reference && receiverParsed.datetime && receiverParsed.paymentMethod;
                
                if (userHasAllFields && receiverHasAllFields) {
                    // All fields present - require ALL to match for auto-approval
                    isVerified = matches.amountMatch && 
                                 matches.referenceMatch && 
                                 matches.timeMatch && 
                                 matches.paymentMethodMatch;
                } else {
                    // Missing required fields - cannot auto-approve
                    isVerified = false;
                }
            }

            // Enhanced logging for debugging
            const userHasAllFields = userParsed.amount && userParsed.reference && userParsed.datetime && userParsed.paymentMethod;
            const receiverHasAllFields = receiverParsed.amount && receiverParsed.reference && receiverParsed.datetime && receiverParsed.paymentMethod;
            
            const verificationReason = isVerified
                ? 'Auto-approved: All required fields match (amount, reference, datetime, payment method)'
                : userHasAllFields && receiverHasAllFields
                    ? 'Cannot auto-approve: Not all fields match (amount, reference, datetime, payment method must all match)'
                    : 'Cannot auto-approve: Missing required fields (amount, reference, datetime, payment method must all be present)';

            console.log(`🔍 SMS Matching Debug:`, {
                userSMSId: userSMS._id?.toString()?.substring(0, 8),
                receiverSMSId: receiverSMS._id?.toString()?.substring(0, 8),
                userSource: userSMS.source,
                receiverSource: receiverSMS.source,
                sourcesDifferent: userSMS.source !== receiverSMS.source,
                amountMatch: matches.amountMatch,
                referenceMatch: matches.referenceMatch,
                timeMatch: matches.timeMatch,
                paymentMethodMatch: matches.paymentMethodMatch,
                accountMatch: matches.accountMatch,
                recipientMatch: matches.recipientMatch,
                phoneMatch: matches.phoneMatch,
                userHasAllFields,
                receiverHasAllFields,
                userAmount: userParsed.amount,
                receiverAmount: receiverParsed.amount,
                userReference: userParsed.reference,
                receiverReference: receiverParsed.reference,
                userPaymentMethod: userParsed.paymentMethod,
                receiverPaymentMethod: receiverParsed.paymentMethod,
                userAccountNumber: userParsed.accountNumber ? '***' + String(userParsed.accountNumber).slice(-4) : null,
                receiverAccountNumber: receiverParsed.accountNumber ? '***' + String(receiverParsed.accountNumber).slice(-4) : null,
                userRecipientName: userParsed.recipientName,
                receiverRecipientName: receiverParsed.recipientName,
                userDatetime: userParsed.datetime,
                receiverDatetime: receiverParsed.datetime,
                isVerified,
                verificationReason,
                confidence: confidence.toFixed(1) + '%',
                sourceValidation: {
                    required: true,
                    validated: sourcesAreDifferent,
                    message: sourcesAreDifferent
                        ? '✅ Sources are different (required for all payment methods)'
                        : '❌ Sources are the same (matching not allowed)'
                },
                note: 'STRICT AUTO-APPROVAL: All fields (amount, reference, datetime, payment method) must be present and match. Phone number is optional.'
            });

            return {
                matches,
                criticalScore,
                optionalScore,
                matchScore: criticalScore + optionalScore,
                totalCriteria: criticalMatches.length + optionalMatches.length,
                confidence,
                isVerified,
                reason: !isVerified ? this.getMatchFailureReason(matches, criticalScore, optionalScore) : null
            };
        } catch (error) {
            console.error('Error matching SMS:', error);
            return { isVerified: false, confidence: 0, reason: 'Matching error' };
        }
    }

    // Helper method to determine why matching failed
    static getMatchFailureReason(matches, criticalScore, optionalScore) {
        if (criticalScore < 2) {
            if (!matches.phoneMatch && !matches.amountMatch) {
                return 'Phone number and amount mismatch';
            } else if (!matches.phoneMatch) {
                return 'Phone number mismatch';
            } else if (!matches.amountMatch) {
                return 'Amount mismatch';
            }
        }
        if ((criticalScore + optionalScore) < 3) {
            return 'Insufficient matching criteria';
        }
        return 'Unknown matching failure';
    }

    // Normalize phone numbers for consistent matching across different formats
    static normalizePhoneNumber(phoneNumber) {
        if (!phoneNumber) return '';

        // Remove all non-digit characters
        let normalized = phoneNumber.replace(/\D/g, '');

        // Handle different Ethiopian phone number formats
        if (normalized.startsWith('251')) {
            // Already has country code: +251911234567 -> 251911234567
            return normalized;
        } else if (normalized.startsWith('09') && normalized.length === 10) {
            // Local format: 0911234567 -> 251911234567
            return '251' + normalized.substring(1);
        } else if (normalized.startsWith('9') && normalized.length === 9) {
            // Without leading 0: 911234567 -> 251911234567
            return '251' + normalized;
        } else if (normalized.length === 10 && normalized.startsWith('0')) {
            // Standard local format: 0911234567 -> 251911234567
            return '251' + normalized.substring(1);
        }

        // Return as-is if format is not recognized
        return normalized;
    }

    // Create deposit verification record
    static async createDepositVerification(userId, userSMS, receiverSMS, matchResult) {
        try {
            // Validate userId is provided
            if (!userId) {
                throw new Error(`Cannot create deposit verification: userId is required but was ${userId}. UserSMS phone: ${userSMS?.phoneNumber || 'unknown'}`);
            }

            // CRITICAL: Check if this userSMS is already part of ANY verification (pending, verified, or approved)
            // This prevents duplicate deposits when user sends the same SMS twice
            // Also prevents matching the same userSMS with different receiver SMS
            const existingVerification = await DepositVerification.findOne({
                userSMS: userSMS._id,
                status: { $in: ['pending_review', 'verified', 'approved'] }
            });

            if (existingVerification) {
                const statusText = existingVerification.status === 'pending_review' ? 'pending' : existingVerification.status;
                console.log(`⚠️ Duplicate verification prevented: UserSMS ${userSMS._id?.toString()?.substring(0, 8)} is already part of ${statusText} verification ${existingVerification._id?.toString()?.substring(0, 8)}`);
                throw new Error(`DUPLICATE_VERIFICATION: This SMS receipt is already being processed. Verification ID: ${existingVerification._id}, Status: ${existingVerification.status}`);
            }

            // Also check by reference if available (additional safety check)
            // Find all verifications (pending, verified, approved) for this user and check their userSMS references
            if (userSMS.parsedData?.reference) {
                const existingVerifications = await DepositVerification.find({
                    userId,
                    status: { $in: ['pending_review', 'verified', 'approved'] }
                })
                .populate('userSMS');

                // Check if any existing verification has the same reference
                for (const existingVer of existingVerifications) {
                    if (existingVer.userSMS?.parsedData?.reference === userSMS.parsedData.reference) {
                        const statusText = existingVer.status === 'pending_review' ? 'pending' : existingVer.status;
                        console.log(`⚠️ Duplicate verification prevented: Reference ${userSMS.parsedData.reference} already ${statusText} in verification ${existingVer._id?.toString()?.substring(0, 8)}`);
                        throw new Error(`DUPLICATE_VERIFICATION: This transaction reference is already being processed. Verification ID: ${existingVer._id}, Status: ${existingVer.status}`);
                    }
                }
            }

            // Check if receiverSMS is already matched (unless it's a placeholder)
            // Check for ALL verification statuses to prevent matching with already-used receiver SMS
            if (receiverSMS.message !== 'PENDING RECEIVER MATCH' && receiverSMS.status === 'matched') {
                const existingReceiverVerification = await DepositVerification.findOne({
                    receiverSMS: receiverSMS._id,
                    status: { $in: ['pending_review', 'verified', 'approved'] }
                });

                if (existingReceiverVerification) {
                    const statusText = existingReceiverVerification.status === 'pending_review' ? 'pending' : existingReceiverVerification.status;
                    console.log(`⚠️ Duplicate verification prevented: ReceiverSMS ${receiverSMS._id?.toString()?.substring(0, 8)} is already matched in ${statusText} verification ${existingReceiverVerification._id?.toString()?.substring(0, 8)}`);
                    throw new Error(`DUPLICATE_VERIFICATION: This receiver SMS is already being processed. Verification ID: ${existingReceiverVerification._id}, Status: ${existingReceiverVerification.status}`);
                }
            }

            const verification = new DepositVerification({
                userId,
                userSMS: userSMS._id,
                receiverSMS: receiverSMS._id,
                amount: userSMS.parsedData.amount,
                matchResult,
                status: matchResult.isVerified ? 'verified' : 'pending_review',
                createdAt: new Date()
            });

            await verification.save();

            // Notify admins that a new verification was created (both verified and pending)
            try {
                await this.notifyAdminsNewVerification(verification);
            } catch (_) { }

            // Auto-credit funds if verification passed automatically
            if (matchResult.isVerified) {
                try {
                    await this.autoApproveVerification(verification._id);
                } catch (autoApproveError) {
                    console.error('Error auto-approving verified deposit:', autoApproveError);
                    // Don't throw - verification is saved, admin can approve manually
                }
            }

            return verification;
        } catch (error) {
            console.error('Error creating deposit verification:', error);
            throw error;
        }
    }

    // Create a pending verification from user SMS alone by generating a placeholder receiver SMS
    static async createPendingVerificationFromUserSMS(userSMS) {
        try {
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

            // Cannot create verification without userId
            if (!resolvedUserId) {
                throw new Error(`Cannot create verification: no user found for phone ${userSMS.phoneNumber}`);
            }

            // Create a placeholder receiver SMSRecord to satisfy schema requirements
            const placeholder = new SMSRecord({
                phoneNumber: 'unknown',
                message: 'PENDING RECEIVER MATCH',
                timestamp: userSMS.timestamp || new Date(),
                source: 'receiver',
                parsedData: {
                    amount: userSMS.parsedData?.amount || null,
                    reference: userSMS.parsedData?.reference || null,
                    datetime: userSMS.parsedData?.datetime || null,
                    paymentMethod: userSMS.parsedData?.paymentMethod || null,
                    rawMessage: 'PENDING RECEIVER MATCH'
                },
                status: 'pending',
                userId: null
            });
            await placeholder.save();

            const matchResult = {
                matches: { amountMatch: !!userSMS.parsedData?.amount, referenceMatch: false, timeMatch: false, paymentMethodMatch: false, phoneMatch: false },
                criticalScore: 1,
                optionalScore: 0,
                matchScore: 1,
                totalCriteria: 2,
                confidence: 0,
                isVerified: false,
                reason: 'Awaiting receiver SMS'
            };

            const verification = await this.createDepositVerification(resolvedUserId, userSMS, placeholder, matchResult);
            return verification;
        } catch (e) {
            console.error('Error creating pending verification from user SMS:', e);
            throw e;
        }
    }

    // Auto-approve and credit funds for verified deposits
    static async autoApproveVerification(verificationId) {
        try {
            const verification = await DepositVerification.findById(verificationId)
                .populate('userId')
                .populate('userSMS')
                .populate('receiverSMS');

            if (!verification) {
                throw new Error('Verification not found');
            }

            // Only auto-approve if still in verified status (not already processed)
            if (verification.status !== 'verified') {
                return verification;
            }

            // Process the deposit
            const WalletService = require('./walletService');
            const result = await WalletService.processDeposit(
                verification.userId._id,
                verification.amount,
                {
                    userSMS: verification.userSMS.parsedData,
                    receiverSMS: verification.receiverSMS.parsedData,
                    verificationId: verification._id
                }
            );

            // Update verification status
            verification.status = 'approved';
            verification.approvedBy = null; // System auto-approved
            verification.approvedAt = new Date();
            await verification.save();

            // Notify user on Telegram
            await this.notifyUserDepositApproved(verification, result, true);

            console.log(`Auto-approved and credited deposit: ${verificationId} - Amount: ETB ${verification.amount}`);
            return result;
        } catch (error) {
            console.error('Error auto-approving verification:', error);
            throw error;
        }
    }

    // Helper to notify user about deposit approval
    static async notifyUserDepositApproved(verification, depositResult, isAutoApproved = false) {
        try {
            const BOT_TOKEN = process.env.BOT_TOKEN;
            const WEBAPP_URL = process.env.WEBAPP_URL || 'https://fikirbingo.com';
            const userTelegramId = verification.userId?.telegramId;

            if (BOT_TOKEN && userTelegramId) {
                const header = isAutoApproved ? '✅ Deposit Auto-Approved!' : '✅ Deposit Approved';
                const text = `${header}\n\n💰 Amount: ETB ${Number(verification.amount).toFixed(2)}\n✅ Credited to: Play Wallet\n\nYour balance has been updated. Good luck!`;
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
        } catch (e) {
            // Silent fail for notifications
        }
    }

    // Get pending verifications for admin review
    static async getPendingVerifications(limit = 50, skip = 0) {
        try {
            const verifications = await DepositVerification.find({ status: 'pending_review' })
                .populate('userId', 'firstName lastName phone telegramId')
                .populate('userSMS')
                .populate('receiverSMS')
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip);

            return verifications;
        } catch (error) {
            console.error('Error getting pending verifications:', error);
            throw error;
        }
    }

    // Approve deposit verification
    static async approveVerification(verificationId, adminId) {
        try {
            const verification = await DepositVerification.findById(verificationId)
                .populate('userId')
                .populate('userSMS')
                .populate('receiverSMS');

            if (!verification) {
                throw new Error('Verification not found');
            }

            // Allow approval of both 'verified' (auto-verified) and 'pending_review' (manual review)
            if (verification.status === 'approved' || verification.status === 'rejected') {
                throw new Error('Verification already processed');
            }

            // Process the deposit
            const WalletService = require('./walletService');
            const result = await WalletService.processDeposit(
                verification.userId._id,
                verification.amount,
                {
                    userSMS: verification.userSMS.parsedData,
                    receiverSMS: verification.receiverSMS.parsedData,
                    verificationId: verification._id
                }
            );

            // Update verification status
            verification.status = 'approved';
            verification.approvedBy = adminId;
            verification.approvedAt = new Date();
            await verification.save();

            // Notify user on Telegram about approval
            await this.notifyUserDepositApproved(verification, result, false);

            return result;
        } catch (error) {
            console.error('Error approving verification:', error);
            throw error;
        }
    }

    // Reject deposit verification
    static async rejectVerification(verificationId, adminId, reason) {
        try {
            const verification = await DepositVerification.findById(verificationId);

            if (!verification) {
                throw new Error('Verification not found');
            }

            verification.status = 'rejected';
            verification.rejectedBy = adminId;
            verification.rejectedAt = new Date();
            verification.rejectionReason = reason;
            await verification.save();

            // Notify user about deposit denial via Telegram
            try {
                const NotificationService = require('./notificationService');
                await NotificationService.notifyDepositDenied(
                    verification.userId,
                    verification.amount,
                    verification._id,
                    reason
                );
            } catch (_) { }

            return verification;
        } catch (error) {
            console.error('Error rejecting verification:', error);
            throw error;
        }
    }

    // Notify admins on Telegram about a new deposit verification
    static async notifyAdminsNewVerification(verification) {
        try {
            const BOT_TOKEN = process.env.BOT_TOKEN;
            if (!BOT_TOKEN) return;
            const User = require('../models/User');
            const userId = verification.userId?._id || verification.userId;
            const user = await User.findById(userId).lean();
            const adminUsers = await User.find({ role: 'admin', telegramId: { $ne: null } }, { telegramId: 1 });
            if (!adminUsers || adminUsers.length === 0) return;

            const amount = Number(verification.amount).toFixed(2);
            const status = verification.status === 'verified' ? 'verified (auto)' : 'pending review';
            let ref = 'N/A';
            if (verification.userSMS) {
                const smsRec = await SMSRecord.findById(verification.userSMS).lean();
                ref = smsRec?.parsedData?.reference || 'N/A';
            }
            const text = verification.status === 'pending_review'
                ? `📝 Pending Deposit Receipt (No Match Yet)\n\n👤 User: ${user?.firstName || ''} ${user?.lastName || ''}\n📱 Phone: ${user?.phone || user?._id || 'N/A'}\n💰 Amount: ETB ${amount}\n🔎 Reference: ${ref}\n\n⏳ Waiting for receiver SMS to auto-verify.`
                : `🆕 New Deposit Verification\n\n👤 User: ${user?.firstName || ''} ${user?.lastName || ''}\n📱 Phone: ${user?.phone || user?._id || 'N/A'}\n💰 Amount: ETB ${amount}\n📋 Verification ID: ${String(verification._id)}\n🔄 Status: ${status}`;

            const reply_markup = {
                inline_keyboard: [
                    [
                        { text: '✅ Approve', callback_data: `approve_dep_${verification._id}` },
                        { text: '❌ Deny', callback_data: `deny_dep_${verification._id}` }
                    ]
                ]
            };

            await Promise.all(
                adminUsers.map(a => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: String(a.telegramId), text, reply_markup })
                }).catch(() => { }))
            );
        } catch (_) {
            // silent
        }
    }
}

module.exports = SmsForwarderService;
