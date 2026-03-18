const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const User = require('../models/User');

class WalletService {
    // Get wallet by user ID
    static async getWallet(userId) {
        try {
            let wallet = await Wallet.findOne({ userId });
            console.log('WalletService.getWallet - Initial find:', {
                userId: userId.toString(),
                found: !!wallet,
                main: wallet?.main,
                play: wallet?.play,
                balance: wallet?.balance
            });

            if (!wallet) {
                console.log('WalletService.getWallet - Creating new wallet for userId:', userId.toString());
                wallet = await this.createWallet(userId);
            }

            console.log('WalletService.getWallet - Final wallet:', {
                userId: userId.toString(),
                main: wallet?.main,
                play: wallet?.play,
                balance: wallet?.balance
            });
            
            return wallet;
        } catch (error) {
            console.error('Error getting wallet:', error);
            throw error;
        }
    }

    // Create wallet
    static async createWallet(userId) {
        try {
            const wallet = new Wallet({
                userId,
                balance: 0,
                main: 0,
                play: 0,
                gamesWon: 0
            });
            await wallet.save();
            return wallet;
        } catch (error) {
            console.error('Error creating wallet:', error);
            throw error;
        }
    }

    // Update wallet balance
    static async updateBalance(userId, updates) {
        try {
            const wallet = await Wallet.findOne({ userId });
            if (!wallet) {
                throw new Error('Wallet not found');
            }

            const balanceBefore = {
                balance: wallet.balance,
                main: wallet.main,
                play: wallet.play
            };

            // Update balances
            if (updates.balance !== undefined) wallet.balance = Math.max(0, wallet.balance + updates.balance);
            if (updates.main !== undefined) wallet.main = Math.max(0, wallet.main + updates.main);
            if (updates.play !== undefined) wallet.play = Math.max(0, wallet.play + updates.play);
            if (updates.gamesWon !== undefined) wallet.gamesWon += updates.gamesWon;

            await wallet.save();

            return {
                wallet,
                balanceBefore,
                balanceAfter: {
                    balance: wallet.balance,
                    main: wallet.main,
                    play: wallet.play
                }
            };
        } catch (error) {
            console.error('Error updating wallet balance:', error);
            throw error;
        }
    }

    // Process deposit
    static async processDeposit(userId, amount, smsData = null) {
        try {
            // Add deposits to play wallet by default (gaming balance)
            const result = await this.updateBalance(userId, { play: amount });

            // Create transaction record
            const transaction = new Transaction({
                userId,
                type: 'deposit',
                amount,
                description: `Deposit via SMS: ETB ${amount} (credited to play wallet)`,
                reference: smsData?.ref || null,
                smsData,
                balanceBefore: result.balanceBefore,
                balanceAfter: result.balanceAfter
            });
            await transaction.save();

            // Update wallet total deposited
            await Wallet.findOneAndUpdate(
                { userId },
                {
                    $inc: { totalDeposited: amount },
                    $set: { lastDepositDate: new Date() }
                }
            );

            // NOTE: Referral reward is handled on invitee registration (contact share), not on deposits.

            return { wallet: result.wallet, transaction };
        } catch (error) {
            console.error('Error processing deposit:', error);
            throw error;
        }
    }

    // Coin conversion feature removed – keep stub to avoid runtime errors if called accidentally.
    static async convertCoins() {
        throw new Error('COIN_FEATURE_DISABLED');
    }

    // Process game bet - use main wallet first, then play wallet
    static async processGameBet(userId, amount, gameId) {
        try {
            let wallet = await Wallet.findOne({ userId });
            if (!wallet) {
                wallet = await this.createWallet(userId);
            }

            const main = Number(wallet.main || 0);
            const play = Number(wallet.play || 0);

            // Support paying from main+play combined (main first, remainder from play)
            if (main + play < amount) {
                throw new Error('INSUFFICIENT_FUNDS');
            }

            const mainDeduct = Math.min(main, amount);
            const playDeduct = Math.max(0, amount - mainDeduct);

            const balanceUpdates = {
                ...(mainDeduct > 0 ? { main: -mainDeduct } : {}),
                ...(playDeduct > 0 ? { play: -playDeduct } : {})
            };
            const result = await this.updateBalance(userId, balanceUpdates);

            const source =
                mainDeduct > 0 && playDeduct > 0 ? 'main+play' : mainDeduct > 0 ? 'main' : 'play';

            // Create transaction record (single record for the bet)
            const description =
                source === 'main+play'
                    ? `Game bet: ETB ${amount} (ETB ${mainDeduct} main + ETB ${playDeduct} play)`
                    : `Game bet: ETB ${amount} (from ${source} wallet)`;

            const transaction = new Transaction({
                userId,
                type: 'game_bet',
                amount: -amount,
                description,
                gameId,
                balanceBefore: result.balanceBefore,
                balanceAfter: result.balanceAfter
            });
            await transaction.save();

            return { wallet: result.wallet, transaction, source };
        } catch (error) {
            console.error('Error processing game bet:', error);
            throw error;
        }
    }

    // Process game win - add to main wallet
    static async processGameWin(userId, amount, gameId) {
        try {
            // Check if user has any deposit history
            const depositHistory = await Transaction.find({
                userId,
                type: 'deposit',
                status: { $in: ['completed', 'pending'] }
            }).limit(1);

            const hasDepositHistory = depositHistory.length > 0;

            // If user has never deposited, credit wins to play wallet (bonus balance)
            // Once they have any deposit history, credit wins to main wallet (withdrawable)
            const creditField = hasDepositHistory ? 'main' : 'play';
            const balanceUpdates = { [creditField]: amount, gamesWon: 1 };

            const result = await this.updateBalance(userId, balanceUpdates);

            // Create transaction record
            const transaction = new Transaction({
                userId,
                type: 'game_win',
                amount,
                description: `Game win: ETB ${amount} (credited to ${creditField} wallet)`,
                gameId,
                balanceBefore: result.balanceBefore,
                balanceAfter: result.balanceAfter
            });
            await transaction.save();

            return { wallet: result.wallet, transaction };
        } catch (error) {
            console.error('Error processing game win:', error);
            throw error;
        }
    }

    // Process game completion - coin gifts disabled
    static async processGameCompletion(userId, gameId) {
        try {
            // Keep method for compatibility but do not modify balances or create transactions.
            const wallet = await this.getWallet(userId);
            return { wallet, transaction: null };
        } catch (error) {
            console.error('Error processing game completion:', error);
            throw error;
        }
    }

    // Get transaction history
    static async getTransactionHistory(userId, type = null, limit = 50, skip = 0) {
        try {
            const query = { userId };
            if (type) {
                query.type = type;
            }

            const transactions = await Transaction.find(query)
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip(skip);

            const total = await Transaction.countDocuments({ userId });

            return { transactions, total };
        } catch (error) {
            console.error('Error getting transaction history:', error);
            throw error;
        }
    }

    // Process withdrawal request
    static async processWithdrawal(userId, amount, destination) {
        try {
            const wallet = await this.getWallet(userId);

            // Check if user has deposit history
            const depositHistory = await Transaction.find({
                userId,
                type: 'deposit',
                status: { $in: ['completed', 'pending'] }
            }).limit(1);

            const hasDepositHistory = depositHistory.length > 0;

            // If no deposit history, any main wallet balance should be treated as bonus:
            // 1) Move full main balance to play wallet
            // 2) Block withdrawal until user makes a deposit
            if (!hasDepositHistory) {
                if (wallet.main > 0) {
                    const migrateAmount = wallet.main;
                    await this.transferFunds(userId, migrateAmount, 'main-to-play');
                }

                return { 
                    success: false, 
                    error: 'NO_DEPOSIT_HISTORY_MIN_300',
                    message: 'ያሸነፍከው በተሰጠው ቦነስ ስለሆነ ለተጨማሪ መጫዎቻ ብቻ ነው ያሸነፍከው። እባክዎ ክቡር ደንበኛችን የሚሸነፉት ሙሉ በሙሉ ወጪ እንዲሆንልዎ የDeposit ታሪክ ይኖርዎት። ይህም የተደረገበት ለጭዋታው ፍታሃዊና ሚዛናዊነት ሲባል መሆኑን በቅንነት ይረዱት።'
                };
            }

            // For users with deposit history, enforce normal balance check
            if (wallet.main < amount) {
                return { success: false, error: 'INSUFFICIENT_FUNDS' };
            }

            // Create pending withdrawal transaction
            const transaction = new Transaction({
                userId,
                type: 'withdrawal',
                amount,
                status: 'pending',
                description: `Withdrawal to ${destination}`,
                metadata: { destination }
            });

            await transaction.save();

            return {
                success: true,
                transactionId: transaction._id
            };
        } catch (error) {
            console.error('Error processing withdrawal:', error);
            return { success: false, error: 'INTERNAL_ERROR' };
        }
    }

    // Process withdrawal approval (admin)
    static async processWithdrawalApproval(userId, amount) {
        try {
            const wallet = await this.getWallet(userId);

            if (wallet.main < amount) {
                return { success: false, error: 'INSUFFICIENT_FUNDS' };
            }

            // Deduct from main wallet
            wallet.main -= amount;
            await wallet.save();

            return { success: true };
        } catch (error) {
            console.error('Error processing withdrawal approval:', error);
            return { success: false, error: 'INTERNAL_ERROR' };
        }
    }

    // Process deposit approval (admin)
    static async processDepositApproval(userId, amount) {
        try {
            const wallet = await this.getWallet(userId);

            // Add deposits to play wallet by default
            const result = await this.updateBalance(userId, { play: amount });

            return { success: true, wallet: result.wallet };
        } catch (error) {
            console.error('Error processing deposit approval:', error);
            return { success: false, error: 'INTERNAL_ERROR' };
        }
    }

    // Transfer funds between main and play wallets
    static async transferFunds(userId, amount, direction) {
        try {
            const wallet = await Wallet.findOne({ userId });
            if (!wallet) {
                throw new Error('Wallet not found');
            }

            const balanceBefore = {
                main: wallet.main,
                play: wallet.play
            };

            let sourceWallet, targetWallet, sourceField, targetField;

            if (direction === 'main-to-play') {
                sourceWallet = wallet.main;
                targetWallet = wallet.play;
                sourceField = 'main';
                targetField = 'play';
            } else if (direction === 'play-to-main') {
                sourceWallet = wallet.play;
                targetWallet = wallet.main;
                sourceField = 'play';
                targetField = 'main';
            } else {
                throw new Error('Invalid transfer direction');
            }

            if (sourceWallet < amount) {
                throw new Error('Insufficient funds');
            }

            // Perform transfer
            wallet[sourceField] -= amount;
            wallet[targetField] += amount;
            await wallet.save();

            // Create transaction record
            const transaction = new Transaction({
                userId,
                type: 'wallet_transfer',
                amount: amount,
                description: `Transfer ${amount} from ${sourceField} to ${targetField} wallet`,
                balanceBefore: balanceBefore,
                balanceAfter: {
                    main: wallet.main,
                    play: wallet.play
                }
            });
            await transaction.save();

            return { wallet, transaction };
        } catch (error) {
            console.error('Error transferring funds:', error);
            throw error;
        }
    }

    // Process invite deposit reward - award 10% of invited user's deposit to inviter
    static async processInviteDepositReward(depositingUserId, depositAmount) {
        try {
            const User = require('../models/User');
            const depositingUser = await User.findById(depositingUserId);
            
            // Check if user was invited
            if (!depositingUser || !depositingUser.invitedBy) {
                return null; // User was not invited, no reward
            }

            const inviterId = depositingUser.invitedBy;
            const rewardAmount = Math.floor(depositAmount * 0.1); // 10% of deposit

            if (rewardAmount <= 0) {
                return null; // No reward for very small deposits
            }

            // Award reward to inviter's play wallet
            const result = await this.updateBalance(inviterId, { play: rewardAmount });

            // Create transaction record for inviter
            const transaction = new Transaction({
                userId: inviterId,
                type: 'invite_reward',
                amount: rewardAmount,
                description: `Invite reward: 10% of ${depositingUser.firstName}'s deposit (ETB ${depositAmount}) = ETB ${rewardAmount} (added to play wallet)`,
                metadata: { 
                    inviteeId: depositingUserId,
                    depositAmount: depositAmount,
                    rewardType: 'deposit_based'
                },
                balanceBefore: result.balanceBefore,
                balanceAfter: result.balanceAfter
            });
            await transaction.save();

            // Update inviter's invite rewards total
            const inviter = await User.findById(inviterId);
            if (inviter) {
                inviter.inviteRewards = (inviter.inviteRewards || 0) + rewardAmount;
                await inviter.save();
            }

            console.log(`Invite deposit reward: User ${inviterId} earned ETB ${rewardAmount} from ${depositingUser.firstName}'s deposit of ETB ${depositAmount}`);

            return { wallet: result.wallet, transaction, inviterId, rewardAmount };
        } catch (error) {
            console.error('Error processing invite deposit reward:', error);
            // Don't throw - we don't want deposit to fail if invite reward fails
            return null;
        }
    }

    // Process invite reward - add to play wallet
    static async processInviteReward(userId, amount, inviteeId = null) {
        try {
            const result = await this.updateBalance(userId, { play: amount });

            // Create transaction record
            const transaction = new Transaction({
                userId,
                type: 'invite_reward',
                amount,
                description: `Invite reward: ETB ${amount} (added to play wallet)${inviteeId ? ` (for inviting user ${inviteeId})` : ''}`,
                metadata: { inviteeId },
                balanceBefore: result.balanceBefore,
                balanceAfter: result.balanceAfter
            });
            await transaction.save();

            return { wallet: result.wallet, transaction };
        } catch (error) {
            console.error('Error processing invite reward:', error);
            throw error;
        }
    }

    // Get invite reward tiers (0.5 birr per invite)
    static getInviteRewardTiers() {
        return {
            1: 0.5,   // 0.5 birr for 1 invite
            2: 1,     // 1 birr for 2 invites
            3: 1.5,   // 1.5 birr for 3 invites
            4: 2,     // 2 birr for 4 invites
            5: 2.5,   // 2.5 birr for 5 invites
            10: 5,    // 5 birr for 10 invites
            20: 10,   // 10 birr for 20 invites
            50: 25,   // 25 birr for 50 invites
            100: 50   // 50 birr for 100 invites
        };
    }

    // Check if a user is a bot (by checking telegramId pattern)
    static async isBotUser(userId) {
        try {
            const user = await User.findById(userId);
            if (!user || !user.telegramId) {
                return false;
            }
            // Bots have telegramId starting with "9000000000" (9 billion range)
            // or contain "bot_user_" pattern
            const telegramId = String(user.telegramId);
            return telegramId.startsWith('9000000000') || telegramId.includes('bot_user_');
        } catch (error) {
            console.error('Error checking if user is bot:', error);
            return false;
        }
    }

    // Automatically fund a bot account
    static async autoFundBot(userId, stake) {
        try {
            const wallet = await this.getWallet(userId);
            const currentBalance = wallet.main || 0;
            const minFunds = stake * 100; // Enough for 100 games
            
            if (currentBalance < minFunds) {
                const neededFunds = minFunds - currentBalance;
                const result = await this.updateBalance(userId, { main: neededFunds });
                
                // Create transaction record
                const transaction = new Transaction({
                    userId,
                    type: 'admin_adjustment',
                    amount: neededFunds,
                    description: `Auto-fund bot: Added ${neededFunds} ETB (total: ${minFunds} ETB, enough for ~100 games)`,
                    balanceBefore: result.balanceBefore,
                    balanceAfter: result.balanceAfter
                });
                await transaction.save();
                
                console.log(`🤖 Auto-funded bot ${userId}: Added ${neededFunds} ETB (total: ${minFunds} ETB)`);
                return { wallet: result.wallet, transaction, funded: true, amount: neededFunds };
            } else {
                console.log(`🤖 Bot ${userId} already has sufficient funds (${currentBalance} ETB)`);
                return { wallet, funded: false, amount: 0 };
            }
        } catch (error) {
            console.error('Error auto-funding bot:', error);
            throw error;
        }
    }
}

module.exports = WalletService;
