/**
 * Generate JWT Tokens for Player Bots
 * 
 * This script AUTOMATICALLY creates 20 test users and generates JWT tokens for them.
 * You don't need any existing users - this script creates everything!
 * 
 * Usage:
 *   node scripts/generateBotTokens.js
 * 
 * What it does:
 *   1. Creates 20 test user accounts in your database
 *   2. Creates wallets for each user
 *   3. Generates JWT tokens for each user (tokens never expire)
 *   4. Displays tokens formatted for ecosystem.config.js
 * 
 * Prerequisites:
 *   - MongoDB connection in .env file (MONGODB_URI)
 *   - JWT_SECRET in .env file
 * 
 * After running:
 *   1. Copy the displayed tokens
 *   2. Paste them into ecosystem.config.js (replace JWT_TOKEN: '' for each bot)
 *   3. Add funds to bot accounts (optional but recommended)
 *   4. Start bots: npm run pm2:start:bots
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const WalletService = require('../services/walletService');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_change_this';
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in environment variables');
    console.error('   Please set MONGODB_URI in your .env file');
    process.exit(1);
}

async function generateTokensForBots() {
    try {
        // Connect to database
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const tokens = [];
        const numBots = 20;

        // Ethiopian nicknames for bots
        const ethiopianNames = [
            'Yared', 'Beti', 'Kalkidan', 'Dawit', 'Meaza',      // 1-5 (Stake 10)
            'Birhanu', 'Liya', 'Kidus', 'Frehiwot', 'Tewodros', // 6-10 (Stake 10)
            'Mulugeta', 'Sara', 'Tadesse', 'Hana', 'Abebe',     // 11-15 (Stake 10)
            'Alemayehu', 'Habtamu', 'Mebrat', 'Elias', 'Getachew' // 16-20 (Stake 10)
        ];

        console.log(`🤖 Generating tokens for ${numBots} bots...\n`);
        console.log('📋 Bot distribution: All 20 bots at Stake 10\n');

        for (let i = 1; i <= numBots; i++) {
            // Create unique Telegram ID for each bot
            const telegramId = `bot_user_${i}_${Date.now()}`;
            const telegramUserId = String(9000000000 + i); // Unique Telegram ID (9 billion range)
            const botName = ethiopianNames[i - 1]; // Get Ethiopian name

            const telegramUser = {
                id: telegramUserId,
                first_name: botName,
                last_name: '',
                username: `bot_${botName.toLowerCase()}`
            };

            // Check if user already exists
            let user = await User.findOne({ telegramId: telegramUserId });

            if (!user) {
                // Create new user
                user = new User({
                    telegramId: telegramUserId,
                    firstName: telegramUser.first_name,
                    lastName: telegramUser.last_name || '',
                    username: telegramUser.username || '',
                    phone: null,
                    isRegistered: false,
                    registrationDate: new Date(),
                    lastActive: new Date()
                });
                await user.save();
                console.log(`✅ Created user ${i}: ${user._id} (${user.firstName})`);

                // Create wallet for user
                const wallet = await WalletService.getWallet(user._id);
                if (!wallet) {
                    await WalletService.createWallet(user._id);
                    console.log(`   💰 Wallet created`);
                }
                
                // Fund bot account with enough balance to play many games
                const stake = getStakeForBot(i);
                const initialFunds = stake * 100; // Enough for 100 games
                await WalletService.updateBalance(user._id, { main: initialFunds });
                console.log(`   💵 Funded with ${initialFunds} ETB (enough for ~100 games)`);
            } else {
                // Update existing user with Ethiopian name
                user.firstName = telegramUser.first_name;
                user.username = telegramUser.username || '';
                user.lastActive = new Date();
                await user.save();
                console.log(`✅ Updated user ${i}: ${user._id} (${user.firstName})`);
                
                // Ensure wallet exists and fund it
                const stake = getStakeForBot(i);
                const currentWallet = await WalletService.getWallet(user._id);
                const currentBalance = currentWallet?.main || 0;
                const minFunds = stake * 100; // Enough for 100 games
                
                if (currentBalance < minFunds) {
                    const neededFunds = minFunds - currentBalance;
                    await WalletService.updateBalance(user._id, { main: neededFunds });
                    console.log(`   💵 Added ${neededFunds} ETB (total: ${minFunds} ETB)`);
                } else {
                    console.log(`   💵 Already funded (balance: ${currentBalance} ETB)`);
                }
            }

            // Generate JWT token (no expiration)
            const token = jwt.sign(
                {
                    sub: user._id.toString(),
                    iat: Math.floor(Date.now() / 1000)
                },
                JWT_SECRET
                // No expiresIn - tokens never expire
            );

            const stake = getStakeForBot(i);
            tokens.push({
                botNumber: i,
                userId: user._id.toString(),
                telegramId: user.telegramId,
                firstName: user.firstName,
                token: token,
                stake: stake
            });

            console.log(`   🎫 Token generated (Stake: ${stake})`);
            console.log('');
        }

        // Display tokens formatted for ecosystem.config.js
        console.log('\n' + '='.repeat(80));
        console.log('📋 COPY THESE TOKENS TO ECOSYSTEM.CONFIG.JS:');
        console.log('='.repeat(80));
        console.log('');

        tokens.forEach(({ botNumber, firstName, token, stake }) => {
            console.log(`// Bot ${botNumber} - ${firstName} (Stake ${stake})`);
            console.log(`// name: 'bingo-player-bot-${firstName.toLowerCase()}',`);
            console.log(`JWT_TOKEN: '${token}',`);
            console.log('');
        });

        console.log('='.repeat(80));
        console.log('\n✅ All tokens generated successfully!');
        console.log('\n📝 Instructions:');
        console.log('   1. Copy the tokens above');
        console.log('   2. Open ecosystem.config.js');
        console.log('   3. Replace JWT_TOKEN: \'\' with the tokens above');
        console.log('   4. Each bot should have a unique token');
        console.log('\n🚀 After updating ecosystem.config.js, start bots with:');
        console.log('   npm run pm2:start:bots');
        console.log('\n');

        await mongoose.disconnect();
        console.log('👋 Disconnected from MongoDB');
        return tokens;

    } catch (error) {
        console.error('\n❌ Error generating tokens:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

function getStakeForBot(botNumber) {
    // All 20 bots at stake 10
    return 10;
}

// Run if executed directly
if (require.main === module) {
    generateTokensForBots()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { generateTokensForBots, getStakeForBot };

