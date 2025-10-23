const mongoose = require('mongoose');
const SMSRecord = require('../models/SMSRecord');
const DepositVerification = require('../models/DepositVerification');

// SMS Forwarder Service for dual SMS verification
class SmsForwarderService {

    // Store incoming SMS from forwarder
    static async storeIncomingSMS(smsData) {
        try {
            const smsRecord = new SMSRecord({
                phoneNumber: smsData.phoneNumber,
                message: smsData.message,
                timestamp: smsData.timestamp || new Date(),
                source: smsData.source || 'forwarder',
                parsedData: this.parseSMSContent(smsData.message),
                status: 'pending'
            });

            await smsRecord.save();
            return smsRecord;
        } catch (error) {
            console.error('Error storing SMS:', error);
            throw error;
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
                /(\d+(?:\.\d{1,2})?)/i
            ],
            // Reference/Transaction ID patterns
            reference: [
                /id=([A-Z0-9]+)/i,
                /ref[:\s]*([A-Z0-9]+)/i,
                /transaction[:\s]*([A-Z0-9]+)/i,
                /txn[:\s]*([A-Z0-9]+)/i,
                /reference[:\s]*([A-Z0-9]+)/i
            ],
            // Date/Time patterns
            datetime: [
                /on\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+at\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i,
                /([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2})/i,
                /time[:\s]*([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2})/i
            ],
            // Payment method patterns
            paymentMethod: [
                /telebirr/i,
                /commercial/i,
                /cbe/i,
                /birr/i,
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
                /to\s+([A-Za-z\s]+)\s+on/i,  // "to Tadesse Meseret on"
                /transferred\s+ETB\s+[\d.]+?\s+to\s+([A-Za-z\s]+)\s+on/i
            ],
            // Account number patterns
            accountNumber: [
                /account\s+(\*?\d+)/i,  // "account 1*7959"
                /from\s+your\s+account\s+(\*?\d+)/i
            ],
            // Transaction reference patterns (CBE specific)
            cbeReference: [
                /id=([A-Z0-9]+)/i,  // "id=FT25242NR98315847959"
                /FT\d+([A-Z0-9]+)/i
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

        // Extract datetime
        for (const pattern of patterns.datetime) {
            const match = message.match(pattern);
            if (match) {
                parsed.datetime = match[0];
                break;
            }
        }

        // Extract payment method
        for (const pattern of patterns.paymentMethod) {
            if (pattern.test(message)) {
                parsed.paymentMethod = pattern.source.replace(/[\/i]/g, '');
                break;
            }
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

        // Extract account number
        for (const pattern of patterns.accountNumber) {
            const match = message.match(pattern);
            if (match) {
                parsed.accountNumber = match[1];
                break;
            }
        }

        // Extract CBE-specific reference
        for (const pattern of patterns.cbeReference) {
            const match = message.match(pattern);
            if (match) {
                parsed.reference = match[1];
                break;
            }
        }

        return parsed;
    }

    // Match user SMS with receiver SMS
    static async matchSMS(userSMS, receiverSMS) {
        try {
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

            // Time matching (reduced to 2 minutes for simultaneous deposits)
            if (userParsed.datetime && receiverParsed.datetime) {
                const userTime = new Date(userParsed.datetime);
                const receiverTime = new Date(receiverParsed.datetime);
                const timeDiff = Math.abs(userTime - receiverTime);
                matches.timeMatch = timeDiff <= 2 * 60 * 1000; // 2 minutes
            }

            // Payment method matching
            if (userParsed.paymentMethod && receiverParsed.paymentMethod) {
                matches.paymentMethodMatch = userParsed.paymentMethod === receiverParsed.paymentMethod;
            }

            // NEW: Recipient name matching (for CBE transfers)
            if (userParsed.recipientName && receiverParsed.recipientName) {
                matches.recipientMatch = userParsed.recipientName.toLowerCase() === receiverParsed.recipientName.toLowerCase();
            }

            // NEW: Account number matching
            if (userParsed.accountNumber && receiverParsed.accountNumber) {
                matches.accountMatch = userParsed.accountNumber === receiverParsed.accountNumber;
            }

            // Enhanced scoring with weighted criteria
            const criticalMatches = [matches.phoneMatch, matches.amountMatch];
            const optionalMatches = [matches.referenceMatch, matches.timeMatch, matches.paymentMethodMatch, matches.recipientMatch, matches.accountMatch];

            const criticalScore = criticalMatches.filter(Boolean).length;
            const optionalScore = optionalMatches.filter(Boolean).length;

            // Weighted confidence calculation
            const totalPossibleScore = (criticalMatches.length * 2) + optionalMatches.length;
            const actualScore = (criticalScore * 2) + optionalScore;
            const confidence = (actualScore / totalPossibleScore) * 100;

            // Enhanced verification logic
            const isVerified = criticalScore >= 2 && (criticalScore + optionalScore) >= 3;

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
            return verification;
        } catch (error) {
            console.error('Error creating deposit verification:', error);
            throw error;
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

            if (verification.status !== 'pending_review') {
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

            return verification;
        } catch (error) {
            console.error('Error rejecting verification:', error);
            throw error;
        }
    }
}

module.exports = SmsForwarderService;
