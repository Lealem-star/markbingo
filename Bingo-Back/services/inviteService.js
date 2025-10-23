const User = require('../models/User');
const WalletService = require('./walletService');
const crypto = require('crypto');

class InviteService {
    // Generate unique invite code for user
    static async generateInviteCode(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Generate unique invite code
            let inviteCode;
            let isUnique = false;

            while (!isUnique) {
                inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
                const existingUser = await User.findOne({ inviteCode });
                if (!existingUser) {
                    isUnique = true;
                }
            }

            // Update user with invite code
            user.inviteCode = inviteCode;
            await user.save();

            return inviteCode;
        } catch (error) {
            console.error('Error generating invite code:', error);
            throw error;
        }
    }

    // Track successful invite
    static async trackInvite(inviterId, inviteeId) {
        try {
            const inviter = await User.findById(inviterId);
            const invitee = await User.findById(inviteeId);

            if (!inviter || !invitee) {
                throw new Error('User not found');
            }

            // Check if invitee was already invited by someone
            if (invitee.invitedBy) {
                throw new Error('User already invited by someone else');
            }

            // Update inviter's stats
            inviter.totalInvites += 1;
            inviter.inviteHistory.push({
                invitedUserId: inviteeId,
                invitedAt: new Date(),
                rewardEarned: 0,
                status: 'pending'
            });

            // Set invitee's inviter
            invitee.invitedBy = inviterId;

            await Promise.all([inviter.save(), invitee.save()]);

            // Process rewards for inviter
            await this.processInviteRewards(inviterId);

            return { success: true, inviter, invitee };
        } catch (error) {
            console.error('Error tracking invite:', error);
            throw error;
        }
    }

    // Process invite rewards based on tiers
    static async processInviteRewards(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const totalInvites = user.totalInvites;
            const rewardTiers = WalletService.getInviteRewardTiers();
            const claimedRewards = user.claimedRewards || [];

            let totalRewardEarned = 0;
            const newClaimedRewards = [...claimedRewards];

            // Check which reward tiers the user has reached
            for (const [threshold, reward] of Object.entries(rewardTiers)) {
                const thresholdNum = parseInt(threshold);

                if (totalInvites >= thresholdNum && !claimedRewards.includes(thresholdNum)) {
                    // Award the reward
                    await WalletService.processInviteReward(userId, reward);

                    // Mark reward as claimed
                    newClaimedRewards.push(thresholdNum);
                    totalRewardEarned += reward;

                    // Update invite history status
                    const inviteHistory = user.inviteHistory;
                    const recentInvites = inviteHistory.slice(-thresholdNum);
                    recentInvites.forEach(invite => {
                        if (invite.status === 'pending') {
                            invite.status = 'rewarded';
                            invite.rewardEarned = reward / thresholdNum; // Distribute reward among recent invites
                        }
                    });

                    user.inviteHistory = inviteHistory;
                }
            }

            // Update user with claimed rewards and total invite rewards
            if (totalRewardEarned > 0) {
                user.claimedRewards = newClaimedRewards;
                user.inviteRewards += totalRewardEarned;
                await user.save();

                // Send notification (if bot is available)
                await this.sendRewardNotification(userId, totalRewardEarned);
            }

            return { totalRewardEarned, newClaimedRewards };
        } catch (error) {
            console.error('Error processing invite rewards:', error);
            throw error;
        }
    }

    // Send reward notification via Telegram
    static async sendRewardNotification(userId, rewardAmount) {
        try {
            const user = await User.findById(userId);
            if (!user || !user.telegramId) {
                return;
            }

            // This will be called from the bot context
            // For now, we'll just log it
            console.log(`🎉 User ${userId} earned ${rewardAmount} birr in invite rewards!`);

            // The actual Telegram notification will be sent from the bot
            return { userId, telegramId: user.telegramId, rewardAmount };
        } catch (error) {
            console.error('Error sending reward notification:', error);
        }
    }

    // Get invite statistics for a user
    static async getInviteStats(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const rewardTiers = WalletService.getInviteRewardTiers();
            const claimedRewards = user.claimedRewards || [];
            const totalInvites = user.totalInvites || 0;

            // Find next reward tier
            let nextReward = null;
            for (const [threshold, reward] of Object.entries(rewardTiers)) {
                const thresholdNum = parseInt(threshold);
                if (totalInvites < thresholdNum && !claimedRewards.includes(thresholdNum)) {
                    nextReward = {
                        threshold: thresholdNum,
                        reward: reward,
                        invitesNeeded: thresholdNum - totalInvites
                    };
                    break;
                }
            }

            return {
                totalInvites,
                totalRewards: user.inviteRewards || 0,
                claimedRewards,
                nextReward,
                inviteCode: user.inviteCode,
                inviteHistory: user.inviteHistory || []
            };
        } catch (error) {
            console.error('Error getting invite stats:', error);
            throw error;
        }
    }

    // Get global invite statistics (for admin)
    static async getGlobalInviteStats() {
        try {
            const stats = await User.aggregate([
                {
                    $group: {
                        _id: null,
                        totalUsers: { $sum: 1 },
                        totalInvites: { $sum: '$totalInvites' },
                        totalInviteRewards: { $sum: '$inviteRewards' },
                        avgInvitesPerUser: { $avg: '$totalInvites' }
                    }
                }
            ]);

            const topInviters = await User.find({ totalInvites: { $gt: 0 } })
                .sort({ totalInvites: -1 })
                .limit(10)
                .select('firstName lastName totalInvites inviteRewards');

            return {
                global: stats[0] || {
                    totalUsers: 0,
                    totalInvites: 0,
                    totalInviteRewards: 0,
                    avgInvitesPerUser: 0
                },
                topInviters
            };
        } catch (error) {
            console.error('Error getting global invite stats:', error);
            throw error;
        }
    }

    // Validate invite code
    static async validateInviteCode(inviteCode) {
        try {
            const user = await User.findOne({ inviteCode });
            if (!user) {
                return { valid: false, error: 'Invalid invite code' };
            }

            return { valid: true, user };
        } catch (error) {
            console.error('Error validating invite code:', error);
            return { valid: false, error: 'Error validating invite code' };
        }
    }
}

module.exports = InviteService;
