const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const UserService = require('../services/userService');
const WalletService = require('../services/walletService');
const Game = require('../models/Game');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const connectDB = require('../config/database');

function startTelegramBot({ BOT_TOKEN, WEBAPP_URL }) {
    try {
        const { Telegraf } = require('telegraf');
        if (!BOT_TOKEN) {
            console.warn('⚠️ BOT_TOKEN not set. Telegram bot is disabled. Create a .env with BOT_TOKEN=...');
            return;
        }

        const bot = new Telegraf(BOT_TOKEN);

        // Ensure MongoDB is connected for bot-only PM2 runs
        (async () => {
            try {
                const hasUri = !!process.env.MONGODB_URI;
                console.log('🧪 Bot DB env check:', { hasUri });
                await connectDB();
                console.log('🗄️  MongoDB Connected (bot)');
            } catch (e) {
                console.error('Mongo connect error (bot):', e?.message || e);
            }
        })();
        const isHttpsWebApp = typeof WEBAPP_URL === 'string' && WEBAPP_URL.startsWith('https://');
        const webAppUrl = WEBAPP_URL;

        // JWT secret for generating tokens
        const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_change_this';

        // Function to generate JWT token for user
        function generateUserToken(userId) {
            return jwt.sign(
                { sub: userId.toString() },
                JWT_SECRET,
                { expiresIn: '1h' }
            );
        }

        (async () => {
            try {
                await bot.telegram.setMyCommands([
                    { command: 'start', description: 'Start' },
                    { command: 'play', description: 'Play' },
                    { command: 'deposit', description: 'Deposit' },
                    { command: 'withdraw', description: 'Withdraw' },
                    { command: 'balance', description: 'Balance' },
                    { command: 'support', description: 'Contact Support' },
                    { command: 'instruction', description: 'How to Play' }
                ]);

                if (isHttpsWebApp) {
                    await bot.telegram.setChatMenuButton({
                        menu_button: { type: 'web_app', text: 'Play-10', web_app: { url: webAppUrl + '?stake=10' } }
                    });
                } else {
                    await bot.telegram.setChatMenuButton({ menu_button: { type: 'commands' } });
                }

                // Per-chat admin command setup is skipped; admins are DB-based and commands shown globally.
            } catch (e) {
                console.log('Failed to set commands/menu:', e?.message || e);
            }
        })();

        function parseReceipt(text) {
            if (typeof text !== 'string' || !text.trim()) return null;

            // Enhanced amount patterns matching backend service
            const amountPatterns = [
                /ETB\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
                /(\d+(?:\.\d{1,2})?)\s*ETB/i,
                /(\d+(?:\.\d{1,2})?)\s*ብር/i,
                /(\d+(?:\.\d{1,2})?)\s*Br\.?/i,
                /(\d+(?:\.\d{1,2})?)\s*Birr/i,
                // CBE bank specific patterns - look for amounts in context
                /transferred\s+ETB\s+([0-9]+(?:\.[0-9]{1,2})?)/i,
                /credited\s+ETB\s+([0-9]+(?:\.[0-9]{1,2})?)/i,
                /debited\s+ETB\s+([0-9]+(?:\.[0-9]{1,2})?)/i,
                /amount[:\s]*ETB\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
                /amount[:\s]*([0-9]+(?:\.[0-9]{1,2})?)\s*ETB/i,
                // Mobile money patterns (Telebirr, CBE Birr) - received/sent
                /received\s+ETB\s+([0-9]+(?:\.[0-9]{1,2})?)/i,
                /sent\s+ETB\s+([0-9]+(?:\.[0-9]{1,2})?)/i,
                /you\s+have\s+received\s+ETB\s+([0-9]+(?:\.[0-9]{1,2})?)/i,
                /you\s+have\s+transferred\s+ETB\s+([0-9]+(?:\.[0-9]{1,2})?)/i,
                /you\s+have\s+sent\s+ETB\s+([0-9]+(?:\.[0-9]{1,2})?)/i,
                // Last resort: standalone numbers that look like amounts (avoid dates, phone numbers)
                // Match numbers that are not part of dates (DD/MM/YYYY) or phone numbers
                /\b(\d{2,}(?:\.\d{1,2})?)\b/i  // At least 2 digits, word boundaries to avoid partial matches
            ];

            let amount = null;
            for (const pattern of amountPatterns) {
                const match = text.match(pattern);
                if (match) {
                    const candidateAmount = Number(match[1]);
                    // Only accept amounts >= 50 (minimum deposit)
                    if (candidateAmount >= 50 && candidateAmount <= 1000000) { // Reasonable upper limit
                        amount = candidateAmount;
                        break;
                    }
                }
            }

            if (!amount || amount < 50) return null;

            // Enhanced datetime patterns (including CBE Birr DD/MM/YY format)
            const whenMatch = text.match(/on\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+at\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i) ||
                text.match(/on\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i) ||
                text.match(/([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i) ||
                text.match(/([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+([0-9]{2}:[0-9]{2})/i) ||
                text.match(/\b([0-9]{2}\/[0-9]{2}\/[0-9]{2})\s+([0-9]{2}:[0-9]{2})\b/i);  // CBE Birr: "28/10/25 13:21"

            // Enhanced reference patterns matching backend service
            const refMatch = text.match(/id=([A-Z0-9]+)/i) ||
                text.match(/\b(FT[0-9A-Z]{10,})\b/i) ||  // CBE FT code
                text.match(/\bref\s*no\s*[:\-]?\s*([A-Z0-9]+)/i) ||
                text.match(/\btxn\s*id\s*[:\-]?\s*([A-Z0-9]+)/i) ||
                text.match(/\btransaction\s*id\s*[:\-]?\s*([A-Z0-9]+)/i) ||
                text.match(/your\s+transaction\s+number\s+is\s*([A-Z0-9]+)/i) ||
                text.match(/transaction\s+number\s+is\s*([A-Z0-9]+)/i) ||
                text.match(/id[:\s]*([A-Z0-9]{8,})/i) ||
                text.match(/ref[:\s]*([A-Z0-9]{8,})/i);

            // Determine payment method
            let type = 'unknown';
            const lowerText = text.toLowerCase();
            if (lowerText.includes('telebirr')) {
                type = 'telebirr';
            } else if (lowerText.includes('cbebirr') || lowerText.includes('cbe birr')) {
                type = 'cbebirr';
            } else if (lowerText.includes('commercial') || (lowerText.includes('cbe') && !lowerText.includes('cbebirr'))) {
                type = 'cbe';
            }

            return {
                amount,
                when: whenMatch ? (whenMatch[2] ? `${whenMatch[1]} ${whenMatch[2]}` : whenMatch[1]) : null,
                ref: refMatch ? refMatch[1] : null,
                type
            };
        }

        async function isAdminByDB(telegramId) {
            try {
                const user = await require('../models/User').findOne({ telegramId: String(telegramId) }, { role: 1 });
                console.log('Admin check for user:', telegramId, 'User found:', user);
                return !!(user && (user.role === 'admin' || user.role === 'super_admin'));
            } catch (e) {
                console.error('Admin check error:', e);
                return false;
            }
        }

        bot.start(async (ctx) => {
            try {
                await UserService.createOrUpdateUser(ctx.from);

                // Handle invite parameter
                const startParam = ctx.message.text.split(' ')[1];
                if (startParam && startParam.startsWith('invite_')) {
                    const inviterTelegramId = startParam.replace('invite_', '');

                    // Track the invite if both users exist
                    try {
                        const InviteService = require('../services/inviteService');
                        const inviter = await UserService.getUserByTelegramId(inviterTelegramId);
                        const newUser = await UserService.getUserByTelegramId(String(ctx.from.id));

                        if (inviter && newUser) {
                            await InviteService.trackInvite(inviter._id, newUser._id);

                            // Send notification to inviter
                            if (inviter.telegramId) {
                                await ctx.telegram.sendMessage(
                                    inviter.telegramId,
                                    `🎉 Great news! Someone joined FUN Bingo using your invite link!`
                                ).catch(() => { }); // Ignore errors if user blocked bot
                            }
                        }
                    } catch (error) {
                        console.error('Error tracking invite:', error);
                        // Continue with normal flow even if invite tracking fails
                    }
                }
            } catch { }

            const isAdmin = await isAdminByDB(ctx.from.id);
            if (isAdmin) {
                const adminText = '🛠️ Admin Panel';

                // Construct admin URL using query parameters instead of hash
                let adminUrl = 'https://fikirbingo.com?admin=true';
                if (WEBAPP_URL && WEBAPP_URL !== 'undefined') {
                    const baseUrl = WEBAPP_URL.replace(/\/$/, '');
                    adminUrl = `${baseUrl}?admin=true`;
                }

                const adminOpen = [{ text: '🌐 Open Admin Panel', web_app: { url: adminUrl } }];
                const keyboard = { reply_markup: { inline_keyboard: [adminOpen, [{ text: '📣 Broadcast', callback_data: 'admin_broadcast' }]] } };
                const photoPath = path.join(__dirname, '..', 'static', 'wellcome.jpg');
                const photo = fs.existsSync(photoPath) ? { source: fs.createReadStream(photoPath) } : (WEBAPP_URL || '').replace(/\/$/, '') + '/wellcome.jpg';
                return ctx.replyWithPhoto(photo, { caption: adminText, reply_markup: keyboard.reply_markup });
            }
            try {
                let registered = false;
                const user = await UserService.getUserByTelegramId(String(ctx.from.id));
                registered = !!(user && (user.isRegistered || user.phone));
                if (!registered) {
                    const regKeyboard = { reply_markup: { keyboard: [[{ text: '📱 Share Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } };
                    const regText = '👋 Welcome to FUN Bingo!\n\n📝 Please complete registration to continue.\n\n📱 Tap "Share Contact" below to provide your phone number.';
                    const photoPath = path.join(__dirname, '..', 'static', 'lb.png');
                    const photo = fs.existsSync(photoPath) ? { source: fs.createReadStream(photoPath) } : (WEBAPP_URL || '').replace(/\/$/, '') + '/lb.png';
                    return ctx.replyWithPhoto(photo, { caption: regText, reply_markup: regKeyboard.reply_markup });
                }
                const welcomeText = `👋 Welcome to FUN Bingo! Choose an Option below.`;
                const playBtn = isHttpsWebApp
                    ? [{ text: '🎮 Play-10', web_app: { url: webAppUrl + '?stake=10' } }]
                    : [{ text: '🎮 Play-10', callback_data: 'play' }];
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            playBtn,
                            [{ text: '💵 Check Balance', callback_data: 'balance' }, { text: '💰 Deposit', callback_data: 'deposit' }],
                            [{ text: '☎️ Contact Support', callback_data: 'support' }, { text: '📖 Instruction', callback_data: 'instruction' }],
                            [{ text: '🤑 Withdraw', callback_data: 'withdraw' }, { text: '🔗 Invite', callback_data: 'invite' }]
                        ]
                    }
                };
                const photoPath = path.join(__dirname, '..', 'static', 'lb.png');
                const photo = fs.existsSync(photoPath) ? { source: fs.createReadStream(photoPath) } : (WEBAPP_URL || '').replace(/\/$/, '') + '/lb.png';
                return ctx.replyWithPhoto(photo, { caption: welcomeText, reply_markup: keyboard.reply_markup });
            } catch {
                return ctx.reply('❌ Database unavailable. Please try again later.');
            }
        });

        async function ensureAdmin(ctx) {
            const isAdmin = await isAdminByDB(ctx.from?.id);
            if (!isAdmin) { await ctx.answerCbQuery('Unauthorized', { show_alert: true }).catch(() => { }); return false; }
            return true;
        }

        // Helper function to notify other admins about admin actions
        async function notifyOtherAdmins(excludingTelegramId, message) {
            try {
                const adminUsers = await User.find({ role: 'admin', telegramId: { $ne: null } });
                for (const admin of adminUsers) {
                    // Skip the admin who performed the action
                    if (String(admin.telegramId) === String(excludingTelegramId)) continue;

                    await bot.telegram.sendMessage(
                        admin.telegramId,
                        message
                    ).catch(e => console.log(`Failed to notify admin ${admin.telegramId}:`, e?.message));
                }
            } catch (error) {
                console.error('Error notifying other admins:', error);
            }
        }

        // Helper: generate report message for a given local-day (start inclusive, end exclusive)
        async function generateDailyReportMessage(start, end) {
            // Fetch stats
            const gamesByFinished = await Game.find({
                finishedAt: { $gte: start, $lt: end },
                status: 'finished'
            }).lean();
            const gamesByCreated = await Game.find({
                finishedAt: { $exists: false },
                createdAt: { $gte: start, $lt: end },
                status: 'finished'
            }).lean();
            const gameMap = new Map();
            [...gamesByFinished, ...gamesByCreated].forEach(g => {
                if (!gameMap.has(g.gameId)) gameMap.set(g.gameId, g);
            });
            const games = Array.from(gameMap.values());
            const totalGames = games.length;
            
            // Calculate total players (unique players across all games)
            const uniquePlayerIds = new Set();
            games.forEach(game => {
                if (game.players && Array.isArray(game.players)) {
                    game.players.forEach(player => {
                        if (player.userId) {
                            uniquePlayerIds.add(player.userId.toString());
                        }
                    });
                }
            });
            const totalPlayers = uniquePlayerIds.size;
            
            const totalRevenue = games.reduce((s, g) => s + (g.systemCut || 0), 0);
            const totalPrizes = games.reduce((s, g) => s + (g.totalPrizes || 0), 0);

            const deposits = await Transaction.find({
                type: 'deposit',
                createdAt: { $gte: start, $lt: end },
                status: { $ne: 'failed' }
            }).lean();
            const totalDeposits = deposits.reduce((s, t) => s + (t.amount || 0), 0);
            
            // Get new users registered
            const User = require('../models/User');
            const newUsers = await User.find({
                registrationDate: { $gte: start, $lt: end },
                isRegistered: true
            }).lean();
            const totalNewUsers = newUsers.length;
            
            // Get pending withdrawal requests
            const pendingWithdrawals = await Transaction.find({
                type: 'withdrawal',
                status: 'pending',
                createdAt: { $gte: start, $lt: end }
            }).lean();
            const totalPendingWithdrawals = pendingWithdrawals.length;
            const totalPendingWithdrawalAmount = pendingWithdrawals.reduce((sum, t) => sum + (t.amount || 0), 0);

            const withdrawals = await Transaction.find({
                type: 'withdrawal',
                status: 'completed',
                $or: [
                    { 'processedBy.processedAt': { $gte: start, $lt: end } },
                    { 'processedBy.processedAt': null, updatedAt: { $gte: start, $lt: end } }
                ],
                'processedBy.adminId': { $exists: true, $ne: null }
            }).lean();
            const byAdmin = {};
            for (const w of withdrawals) {
                if (w.processedBy && w.processedBy.adminId) {
                    const key = String(w.processedBy.adminId);
                    byAdmin[key] = byAdmin[key] || {
                        adminId: key,
                        adminName: w.processedBy.adminName || 'Admin',
                        adminTelegramId: w.processedBy.adminTelegramId,
                        totalAmount: 0
                    };
                    byAdmin[key].totalAmount += (w.amount || 0);
                }
            }
            const adminWithdrawals = Object.values(byAdmin).sort((a, b) => b.totalAmount - a.totalAmount);

            // Format date title using local time
            const displayDate = start.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            const appreciationMessages = [
                "🎉 Great work today! Your platform continues to grow! 🎉",
                "🌟 Excellent performance! Keep up the amazing work! 🌟",
                "💪 Outstanding results! You're building something incredible! 💪",
                "🚀 Fantastic progress! The platform is thriving! 🚀",
                "✨ Impressive achievements! Keep pushing forward! ✨",
                "🏆 Congratulations on another successful day! 🏆"
            ];
            const randomAppreciation = appreciationMessages[Math.floor(Math.random() * appreciationMessages.length)];

            let adminWithdrawalsSection = '';
            if (adminWithdrawals.length > 0) {
                adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n';
                for (const admin of adminWithdrawals) {
                    adminWithdrawalsSection += `👤 *${admin.adminName}:*\n   💰 ETB ${admin.totalAmount.toLocaleString()}\n\n`;
                }
            } else {
                adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n   No withdrawals approved.\n\n';
            }

            const message = `📊 *Daily Achievement Report*
${displayDate}

━━━━━━━━━━━━━━━━━━━━
📈 *Today's Statistics:*
━━━━━━━━━━━━━━━━━━━━

🎮 *Total Games:* ${totalGames.toLocaleString()}
👥 *Total Players:* ${totalPlayers.toLocaleString()}
💰 *System Revenue:* ${totalRevenue.toLocaleString()} ETB
🏆 *Total Prizes:* ${totalPrizes.toLocaleString()} ETB
💳 *Total Deposits:* ${totalDeposits.toLocaleString()} ETB
👤 *New Users:* ${totalNewUsers.toLocaleString()}
⏳ *Pending Withdrawals:* ${totalPendingWithdrawals} (${totalPendingWithdrawalAmount.toLocaleString()} ETB)
${adminWithdrawalsSection}━━━━━━━━━━━━━━━━━━━━
${randomAppreciation}

📊 *Breakdown:*
• Games Played: ${totalGames}
• Unique Players: ${totalPlayers}
• Revenue Generated: ${totalRevenue.toLocaleString()} ETB
• Prizes Distributed: ${totalPrizes.toLocaleString()} ETB
• Deposits Received: ${totalDeposits.toLocaleString()} ETB
• New Registrations: ${totalNewUsers}
• Pending Withdrawals: ${totalPendingWithdrawals} (${totalPendingWithdrawalAmount.toLocaleString()} ETB)

Thank you for your dedication! 🙏`;

            return message;
        }

        bot.command('admin', async (ctx) => {
            if (!(await isAdminByDB(ctx.from.id))) { return ctx.reply('Unauthorized'); }
            const adminText = '🛠️ Admin Panel';

            // Construct admin URL using query parameters instead of hash
            let adminUrl = 'https://fikirbingo.com?admin=true';
            if (WEBAPP_URL && WEBAPP_URL !== 'undefined') {
                const baseUrl = WEBAPP_URL.replace(/\/$/, '');
                adminUrl = `${baseUrl}?admin=true`;
            }

            // Debug logging
            console.log('WEBAPP_URL:', WEBAPP_URL);
            console.log('Final admin URL:', adminUrl);

            const adminOpen = [{ text: '🌐 Open Admin Panel', web_app: { url: adminUrl } }];
            const keyboard = { reply_markup: { inline_keyboard: [adminOpen, [{ text: '📣 Broadcast', callback_data: 'admin_broadcast' }], [{ text: '📊 Daily Report', callback_data: 'admin_daily_report' }]] } };

            // Send admin panel with welcome image
            const photoPath = path.join(__dirname, '..', 'static', 'wellcome.jpg');
            const photo = fs.existsSync(photoPath) ? { source: fs.createReadStream(photoPath) } : (WEBAPP_URL || '').replace(/\/$/, '') + '/wellcome.jpg';
            return ctx.replyWithPhoto(photo, { caption: adminText, reply_markup: keyboard.reply_markup });
        });

        // One-time bootstrap: promote caller to admin with secret code
        const mongoose = require('mongoose');
        function isDbReady() {
            return mongoose.connection && mongoose.connection.readyState === 1;
        }
        bot.command('admin_boot', async (ctx) => {
            const parts = (ctx.message.text || '').trim().split(/\s+/);
            const code = parts[1] || '';
            const expected = process.env.ADMIN_BOOT_CODE || '';
            console.log('Admin boot attempt:', { telegramId: ctx.from.id, code, expected });
            if (!expected) return ctx.reply('Boot code not configured.');
            if (code !== expected) return ctx.reply('Invalid code.');
            if (!isDbReady()) return ctx.reply('Database is not connected yet. Please try again in a moment.');
            try {
                const User = require('../models/User');
                const telegramId = String(ctx.from.id);
                const user = await User.findOneAndUpdate(
                    { telegramId },
                    {
                        $set: { role: 'admin' },
                        $setOnInsert: {
                            telegramId,
                            firstName: ctx.from.first_name || 'Unknown',
                            lastName: ctx.from.last_name || '',
                            username: ctx.from.username || ''
                        }
                    },
                    { new: true, upsert: true }
                );
                console.log('Admin boot result:', user);
                if (user) return ctx.reply('✅ You are now an admin. Use /admin');
                return ctx.reply('User not found. Start the bot first.');
            } catch (e) {
                console.error('admin_boot error:', e?.message || e);
                return ctx.reply('Failed to promote.');
            }
        });

        // Admin role management
        bot.command('promote', async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            const parts = (ctx.message.text || '').trim().split(/\s+/);
            const targetId = parts[1];
            if (!targetId) return ctx.reply('Usage: /promote <telegramId>');
            try {
                const adminTelegramId = String(ctx.from.id);
                const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';

                const User = require('../models/User');
                const targetUser = await User.findOne({ telegramId: String(targetId) });
                if (!targetUser) return ctx.reply('User not found.');

                const user = await User.findOneAndUpdate({ telegramId: String(targetId) }, { $set: { role: 'admin' } }, { new: true });
                if (!user) return ctx.reply('User not found.');

                // Notify other admins
                const targetName = `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim() || targetUser.phone || targetId;
                await notifyOtherAdmins(
                    adminTelegramId,
                    `👤 Admin Action: User Promoted to Admin\n\n` +
                    `👤 Target User: ${targetName}\n` +
                    `📱 Telegram ID: ${targetId}\n` +
                    `✅ Promoted by: ${adminName}\n` +
                    `🕐 Time: ${new Date().toLocaleString()}`
                );

                return ctx.reply(`✅ Promoted ${targetId} to admin.`);
            } catch { return ctx.reply('Failed to promote.'); }
        });

        bot.command('demote', async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            const parts = (ctx.message.text || '').trim().split(/\s+/);
            const targetId = parts[1];
            if (!targetId) return ctx.reply('Usage: /demote <telegramId>');
            try {
                const adminTelegramId = String(ctx.from.id);
                const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';

                const User = require('../models/User');
                const targetUser = await User.findOne({ telegramId: String(targetId) });
                if (!targetUser) return ctx.reply('User not found.');

                const user = await User.findOneAndUpdate({ telegramId: String(targetId) }, { $set: { role: 'user' } }, { new: true });
                if (!user) return ctx.reply('User not found.');

                // Notify other admins
                const targetName = `${targetUser.firstName || ''} ${targetUser.lastName || ''}`.trim() || targetUser.phone || targetId;
                await notifyOtherAdmins(
                    adminTelegramId,
                    `👤 Admin Action: Admin Demoted to User\n\n` +
                    `👤 Target User: ${targetName}\n` +
                    `📱 Telegram ID: ${targetId}\n` +
                    `❌ Demoted by: ${adminName}\n` +
                    `🕐 Time: ${new Date().toLocaleString()}`
                );

                return ctx.reply(`✅ Demoted ${targetId} to user.`);
            } catch { return ctx.reply('Failed to demote.'); }
        });

        // User commands
        bot.command('play', async (ctx) => {
            try {
                await UserService.createOrUpdateUser(ctx.from);
                const isAdmin = await isAdminByDB(ctx.from.id);

                if (isAdmin) {
                    // Admin gets admin panel
                    const adminText = '🛠️ Admin Panel';
                    let adminUrl = 'https://fikirbingo.com?admin=true';
                    if (WEBAPP_URL && WEBAPP_URL !== 'undefined') {
                        const baseUrl = WEBAPP_URL.replace(/\/$/, '');
                        adminUrl = `${baseUrl}?admin=true`;
                    }
                    const adminOpen = [{ text: '🌐 Open Admin Panel', web_app: { url: adminUrl } }];
                    const keyboard = { reply_markup: { inline_keyboard: [adminOpen, [{ text: '📣 Broadcast', callback_data: 'admin_broadcast' }]] } };
                    const photoPath = path.join(__dirname, '..', 'static', 'wellcome.jpg');
                    const photo = fs.existsSync(photoPath) ? { source: fs.createReadStream(photoPath) } : (WEBAPP_URL || '').replace(/\/$/, '') + '/wellcome.jpg';
                    return ctx.replyWithPhoto(photo, { caption: adminText, reply_markup: keyboard.reply_markup });
                }

                // Check if user is registered
                let registered = false;
                const user = await UserService.getUserByTelegramId(String(ctx.from.id));
                registered = !!(user && (user.isRegistered || user.phone));

                if (!registered) {
                    const regKeyboard = { reply_markup: { keyboard: [[{ text: '📱 Share Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } };
                    const regText = '👋 Welcome to FUN Bingo!\n\n📝 Please complete registration to continue.\n\n📱 Tap "Share Contact" below to provide your phone number.';
                    return ctx.reply(regText, regKeyboard);
                }

                // Registered user - show web app button
                if (isHttpsWebApp) {
                    const keyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🎮 Open Game', web_app: { url: webAppUrl + '?stake=10' } }],
                                [{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]
                            ]
                        }
                    };
                    return ctx.reply('🎮 Ready to play FUN Bingo!', keyboard);
                } else {
                    // Fallback if no HTTPS web app URL
                    const keyboard = { reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] } };
                    return ctx.reply('🎮 To play FUN Bingo, please use our web app:\n\n' + webAppUrl, keyboard);
                }
            } catch {
                return ctx.reply('❌ Database unavailable. Please try again later.');
            }
        });

        bot.command('balance', async (ctx) => {
            try {
                const telegramId = String(ctx.from.id);
                const userData = await UserService.getUserWithWallet(telegramId);
                if (!userData || !userData.wallet) {
                    return ctx.reply('❌ Wallet not found. Please try again later.');
                }
                const w = userData.wallet;
                
                // Debug logging to verify wallet data matches frontend
                console.log('Bot balance command:', {
                    telegramId: telegramId,
                    userId: userData.user._id.toString(),
                    walletMain: w.main,
                    walletPlay: w.play,
                    walletBalance: w.balance,
                    walletCoins: w.coins
                });

                // Use actual wallet values - if main/play are null/undefined, fall back to balance
                const mainValue = (w.main !== null && w.main !== undefined) ? w.main : (w.balance ?? 0);
                const playValue = (w.play !== null && w.play !== undefined) ? w.play : 0;

                const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
                if (isHttpsWebApp) keyboard.inline_keyboard.unshift([{ text: '🌐 Open Web App', web_app: { url: webAppUrl + '?stake=10' } }]);
                ctx.reply(`💵 Your Wallet Balance:\n\n💰 Main Wallet: ETB ${mainValue.toFixed(2)}\n🎮 Play Balance: ETB ${playValue.toFixed(2)}\n🪙 Coins: ${(w.coins ?? 0).toFixed(0)}`, { reply_markup: keyboard });
            } catch (error) {
                console.error('Balance check error:', error);
                ctx.reply('❌ Error checking balance. Please try again.');
            }
        });

        bot.command('deposit', async (ctx) => {
            const userId = String(ctx.from.id);
            // Clear any withdrawal state to prevent conflicts
            if (typeof withdrawalStates !== 'undefined' && withdrawalStates instanceof Map) {
                withdrawalStates.delete(userId);
            }
            ctx.reply('Please select the bank option you wish to use for the top-up.\n\nእባክዎ ለማስገባት የሚፈልጉትን የባንክ አማራጭ ይምረጡ:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📱 Telebirr', callback_data: 'deposit_telebirr' }]
                    ]
                }
            });
        });

        // Add /withdraw command to initiate withdrawal flow
        bot.command('withdraw', async (ctx) => {
            try {
                // Start the same flow as pressing the Withdraw button
                const userId = String(ctx.from.id);
                // Initialize withdrawal state to await amount
                if (typeof withdrawalStates !== 'undefined' && withdrawalStates instanceof Map) {
                    withdrawalStates.set(userId, 'awaiting_amount');
                }
                ctx.reply('💰 እባክዎትን ማውጣት የፈለጉትን የገንዘብ መጠን ያስገቡ (ETB 50 - 10,000):\n\n💡 Example: 100');
            } catch (e) {
                ctx.reply('❌ Could not start withdrawal. Please try again.');
            }
        });

        bot.command('support', (ctx) => {
            ctx.reply('☎️ Contact Support:\n\n📞 For payment issues:\n@Funbingosupport1\n\n💬 For general support:\n@Funbingosupport1\n\n⏰ Support hours:\n24/7 available', { reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] } });
        });

        bot.command('instruction', (ctx) => {
            const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
            if (isHttpsWebApp) keyboard.inline_keyboard.unshift([{ text: '🎮 Start Playing', web_app: { url: webAppUrl + '?stake=10' } }]);
            ctx.reply('📖 How to Play FUN Bingo:\n\n1️⃣ Select a bingo card\n2️⃣ Wait for numbers to be called\n3️⃣ Mark numbers on your card\n4️⃣ Call "BINGO!" when you win\n\n🎯 Win by getting 5 in a row (horizontal, vertical, or diagonal)\n\n💰 Prizes are shared among all winners!', { reply_markup: keyboard });
        });

        // Admin: manual daily report trigger (optional date: YYYY-MM-DD)
        bot.command('daily_report', async (ctx) => {
            if (!(await isAdminByDB(ctx.from.id))) { return ctx.reply('Unauthorized'); }
            try {
                const parts = (ctx.message.text || '').trim().split(/\s+/);
                let target = null;
                if (parts[1]) {
                    const d = new Date(parts[1]);
                    if (!isNaN(d.getTime())) target = d;
                }
                // Build window [start, end) for target date; default yesterday
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                let start = new Date(todayMidnight);
                if (target) {
                    start = new Date(target);
                    start.setHours(0, 0, 0, 0);
                } else {
                    start.setDate(start.getDate() - 1);
                }
                const end = new Date(start);
                end.setDate(end.getDate() + 1);

                const message = await generateDailyReportMessage(start, end);
                await ctx.reply(message, { parse_mode: 'Markdown' });
            } catch (e) {
                console.error('daily_report command error:', e);
                await ctx.reply('❌ Failed to generate report.');
            }
        });

        // Admin: manual weekly report trigger
        bot.command('weekly_report', async (ctx) => {
            if (!(await isAdminByDB(ctx.from.id))) { return ctx.reply('Unauthorized'); }
            try {
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                const end = new Date(todayMidnight);
                const start = new Date(todayMidnight);
                start.setDate(start.getDate() - 7); // Last 7 days

                // Use the weekly stats function
                const stats = await getWeeklyStats();
                
                const startDateObj = new Date(stats.startDate);
                const endDateObj = new Date(stats.endDate);
                const formattedStartDate = startDateObj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                });
                const formattedEndDate = endDateObj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                });

                const appreciationMessages = [
                    "🎉 Outstanding week! Your platform is thriving! 🎉",
                    "🌟 Incredible performance this week! Keep it up! 🌟",
                    "💪 Amazing results! You're building something special! 💪",
                    "🚀 Phenomenal progress! The platform is growing strong! 🚀",
                    "✨ Exceptional achievements! Keep pushing forward! ✨",
                    "🏆 Congratulations on a fantastic week! 🏆"
                ];
                const randomAppreciation = appreciationMessages[Math.floor(Math.random() * appreciationMessages.length)];

                let adminWithdrawalsSection = '';
                if (stats.adminWithdrawals && stats.adminWithdrawals.length > 0) {
                    adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n';
                    for (const admin of stats.adminWithdrawals) {
                        adminWithdrawalsSection += `👤 *${admin.adminName}:*\n   💰 ETB ${admin.totalAmount.toLocaleString()}\n\n`;
                    }
                } else {
                    adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n   No withdrawals approved this week.\n\n';
                }

                const message = `📊 *Weekly Achievement Report*
${formattedStartDate} - ${formattedEndDate}

━━━━━━━━━━━━━━━━━━━━
📈 *This Week's Statistics:*
━━━━━━━━━━━━━━━━━━━━

🎮 *Total Games:* ${stats.totalGames.toLocaleString()}
👥 *Total Players:* ${stats.totalPlayers.toLocaleString()}
💰 *System Revenue:* ${stats.totalRevenue.toLocaleString()} ETB
🏆 *Total Prizes:* ${stats.totalPrizes.toLocaleString()} ETB
💳 *Total Deposits:* ${stats.totalDeposits.toLocaleString()} ETB
👤 *New Users:* ${stats.totalNewUsers.toLocaleString()}
⏳ *Pending Withdrawals:* ${stats.totalPendingWithdrawals} (${stats.totalPendingWithdrawalAmount.toLocaleString()} ETB)
${adminWithdrawalsSection}━━━━━━━━━━━━━━━━━━━━
${randomAppreciation}

📊 *Weekly Breakdown:*
• Games Played: ${stats.totalGames}
• Unique Players: ${stats.totalPlayers}
• Revenue Generated: ${stats.totalRevenue.toLocaleString()} ETB
• Prizes Distributed: ${stats.totalPrizes.toLocaleString()} ETB
• Deposits Received: ${stats.totalDeposits.toLocaleString()} ETB
• New Registrations: ${stats.totalNewUsers}
• Pending Withdrawals: ${stats.totalPendingWithdrawals} (${stats.totalPendingWithdrawalAmount.toLocaleString()} ETB)

Thank you for your dedication! 🙏`;

                await ctx.reply(message, { parse_mode: 'Markdown' });
            } catch (e) {
                console.error('weekly_report command error:', e);
                await ctx.reply('❌ Failed to generate weekly report.');
            }
        });


        bot.action('back_to_admin', async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            const adminText = '🛠️ Admin Panel';

            // Construct admin URL using query parameters instead of hash
            let adminUrl = 'https://fikirbingo.com?admin=true';
            if (WEBAPP_URL && WEBAPP_URL !== 'undefined') {
                const baseUrl = WEBAPP_URL.replace(/\/$/, '');
                adminUrl = `${baseUrl}?admin=true`;
            }

            const adminOpen = [{ text: '🌐 Open Admin Panel', web_app: { url: adminUrl } }];
            const keyboard = { reply_markup: { inline_keyboard: [adminOpen, [{ text: '📣 Broadcast', callback_data: 'admin_broadcast' }], [{ text: '📊 Daily Report', callback_data: 'admin_daily_report' }], [{ text: '📅 Weekly Report', callback_data: 'admin_weekly_report' }]] } };
            await ctx.editMessageText(adminText, keyboard).catch(() => ctx.reply(adminText, keyboard));
        });

        // Admin inline: generate daily report for yesterday
        bot.action('admin_daily_report', async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            try {
                // Yesterday window
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                const start = new Date(todayMidnight);
                start.setDate(start.getDate() - 1);
                const end = new Date(start);
                end.setDate(end.getDate() + 1);
                const message = await generateDailyReportMessage(start, end);
                await ctx.answerCbQuery().catch(() => { });
                await ctx.reply(message, { parse_mode: 'Markdown' });
            } catch (e) {
                console.error('admin_daily_report error:', e);
                await ctx.answerCbQuery('Failed to generate report', { show_alert: true }).catch(() => { });
            }
        });

        // Admin inline: generate weekly report
        bot.action('admin_weekly_report', async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            try {
                const todayMidnight = new Date();
                todayMidnight.setHours(0, 0, 0, 0);
                const end = new Date(todayMidnight);
                const start = new Date(todayMidnight);
                start.setDate(start.getDate() - 7);

                // Use the weekly stats function (need to access it from the closure)
                // We'll need to make getWeeklyStats accessible or duplicate the logic
                // For now, let's use the command handler logic
                await ctx.answerCbQuery('Generating weekly report...').catch(() => { });
                
                // Call the weekly report command handler logic
                const stats = await getWeeklyStats();
                
                const startDateObj = new Date(stats.startDate);
                const endDateObj = new Date(stats.endDate);
                const formattedStartDate = startDateObj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                });
                const formattedEndDate = endDateObj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                });

                const appreciationMessages = [
                    "🎉 Outstanding week! Your platform is thriving! 🎉",
                    "🌟 Incredible performance this week! Keep it up! 🌟",
                    "💪 Amazing results! You're building something special! 💪",
                    "🚀 Phenomenal progress! The platform is growing strong! 🚀",
                    "✨ Exceptional achievements! Keep pushing forward! ✨",
                    "🏆 Congratulations on a fantastic week! 🏆"
                ];
                const randomAppreciation = appreciationMessages[Math.floor(Math.random() * appreciationMessages.length)];

                let adminWithdrawalsSection = '';
                if (stats.adminWithdrawals && stats.adminWithdrawals.length > 0) {
                    adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n';
                    for (const admin of stats.adminWithdrawals) {
                        adminWithdrawalsSection += `👤 *${admin.adminName}:*\n   💰 ETB ${admin.totalAmount.toLocaleString()}\n\n`;
                    }
                } else {
                    adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n   No withdrawals approved this week.\n\n';
                }

                const message = `📊 *Weekly Achievement Report*
${formattedStartDate} - ${formattedEndDate}

━━━━━━━━━━━━━━━━━━━━
📈 *This Week's Statistics:*
━━━━━━━━━━━━━━━━━━━━

🎮 *Total Games:* ${stats.totalGames.toLocaleString()}
👥 *Total Players:* ${stats.totalPlayers.toLocaleString()}
💰 *System Revenue:* ${stats.totalRevenue.toLocaleString()} ETB
🏆 *Total Prizes:* ${stats.totalPrizes.toLocaleString()} ETB
💳 *Total Deposits:* ${stats.totalDeposits.toLocaleString()} ETB
👤 *New Users:* ${stats.totalNewUsers.toLocaleString()}
⏳ *Pending Withdrawals:* ${stats.totalPendingWithdrawals} (${stats.totalPendingWithdrawalAmount.toLocaleString()} ETB)
${adminWithdrawalsSection}━━━━━━━━━━━━━━━━━━━━
${randomAppreciation}

📊 *Weekly Breakdown:*
• Games Played: ${stats.totalGames}
• Unique Players: ${stats.totalPlayers}
• Revenue Generated: ${stats.totalRevenue.toLocaleString()} ETB
• Prizes Distributed: ${stats.totalPrizes.toLocaleString()} ETB
• Deposits Received: ${stats.totalDeposits.toLocaleString()} ETB
• New Registrations: ${stats.totalNewUsers}
• Pending Withdrawals: ${stats.totalPendingWithdrawals} (${stats.totalPendingWithdrawalAmount.toLocaleString()} ETB)

Thank you for your dedication! 🙏`;

                await ctx.reply(message, { parse_mode: 'Markdown' });
            } catch (e) {
                console.error('admin_weekly_report error:', e);
                await ctx.answerCbQuery('Failed to generate weekly report', { show_alert: true }).catch(() => { });
            }
        });


        const adminStates = new Map();
        async function getBroadcastTargets() {
            const dbUsers = await require('../models/User').find({}, { telegramId: 1 });
            const ids = (dbUsers || []).map(u => String(u.telegramId)).filter(Boolean);
            if (!ids.length) { throw new Error('NO_RECIPIENTS'); }
            return Array.from(new Set(ids));
        }
        async function sendToAll(ids, sendOne) {
            const results = await Promise.allSettled(ids.map(id => sendOne(id)));
            const success = results.filter(r => r.status === 'fulfilled').length;
            const failed = results.length - success;
            return { success, failed, total: results.length };
        }
        function buildBroadcastMarkup(caption) {
            const kb = { inline_keyboard: [] };
            if (isHttpsWebApp) { kb.inline_keyboard.push([{ text: 'Play-10', web_app: { url: webAppUrl + '?stake=10' } }]); }
            const base = kb.inline_keyboard.length ? { reply_markup: kb } : {};
            if (caption !== undefined) return { ...base, caption, parse_mode: 'HTML' };
            return { ...base, parse_mode: 'HTML' };
        }
        async function sendPendingMediaToAll(pending, caption) {
            const targets = await getBroadcastTargets();
            const options = buildBroadcastMarkup(caption);
            if (pending.kind === 'photo') return sendToAll(targets, async (id) => bot.telegram.sendPhoto(id, pending.fileId, options));
            if (pending.kind === 'video') return sendToAll(targets, async (id) => bot.telegram.sendVideo(id, pending.fileId, options));
            if (pending.kind === 'document') return sendToAll(targets, async (id) => bot.telegram.sendDocument(id, pending.fileId, options));
            if (pending.kind === 'animation') return sendToAll(targets, async (id) => bot.telegram.sendAnimation(id, pending.fileId, options));
            throw new Error('UNSUPPORTED_MEDIA');
        }

        bot.action('admin_broadcast', async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            adminStates.set(String(ctx.from.id), { mode: 'broadcast' });
            await ctx.answerCbQuery('');
            await ctx.reply('📣 Send the message to broadcast now (text, photo, video, document, etc.).', { reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'back_to_admin' }]] } });
        });

        async function isUserRegistered(userId) {
            const user = await UserService.getUserByTelegramId(userId);
            return !!(user && (user.isRegistered || user.phone));
        }

        async function requireRegistration(ctx) {
            const userId = String(ctx.from.id);
            const ok = await isUserRegistered(userId);
            if (ok) return true;
            try { await ctx.answerCbQuery('Registration required'); } catch { }
            const keyboard = { reply_markup: { keyboard: [[{ text: '📱 Share Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } };
            const photoPath = path.join(__dirname, '..', 'static', 'lb.png');
            const photo = fs.existsSync(photoPath) ? { source: fs.createReadStream(photoPath) } : (WEBAPP_URL || '').replace(/\/$/, '') + '/lb.png';
            await ctx.replyWithPhoto(photo, { caption: '📝 Please complete registration to continue.\n\n📱 Tap "Share Contact" below to provide your phone number.', reply_markup: keyboard.reply_markup });
            return false;
        }

        bot.action('play', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;

            if (isHttpsWebApp) {
                // Open web app directly
                ctx.answerCbQuery('🎮 Opening game...');
                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🎮 Play-10', web_app: { url: webAppUrl + '?stake=10' } }],
                            [{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]
                        ]
                    }
                };
                ctx.reply('🎮 Ready to play! Click the button below to start:', keyboard);
            } else {
                ctx.answerCbQuery('🎮 Opening game...');
                const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
                const note = '\n\n⚠️ Web App button hidden because Telegram requires HTTPS. Set WEBAPP_URL in .env to an https URL.';
                ctx.reply('🎮 To play Bingo, please use our web app:' + note, { reply_markup: keyboard });
            }
        });


        bot.action('balance', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            try {
                const telegramId = String(ctx.from.id);
                const userData = await UserService.getUserWithWallet(telegramId);
                if (!userData || !userData.wallet) { 
                    return ctx.reply('❌ Wallet not found. Please try again later.'); 
                }
                const w = userData.wallet;
                
                // Debug logging to verify wallet data matches frontend
                console.log('Bot balance check:', {
                    telegramId: telegramId,
                    userId: userData.user._id.toString(),
                    walletMain: w.main,
                    walletPlay: w.play,
                    walletBalance: w.balance,
                    walletCoins: w.coins
                });

                // Use actual wallet values - if main/play are null/undefined, fall back to balance
                const mainValue = (w.main !== null && w.main !== undefined) ? w.main : (w.balance ?? 0);
                const playValue = (w.play !== null && w.play !== undefined) ? w.play : 0;

                ctx.answerCbQuery('💵 Balance checked');
                const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
                if (isHttpsWebApp) keyboard.inline_keyboard.unshift([{ text: '🌐 Open Web App', web_app: { url: webAppUrl + '?stake=10' } }]);
                ctx.reply(`💵 Your Wallet Balance:\n\n💰 Main Wallet: ETB ${mainValue.toFixed(2)}\n🎮 Play Balance: ETB ${playValue.toFixed(2)}\n🪙 Coins: ${(w.coins ?? 0).toFixed(0)}`, { reply_markup: keyboard });
            } catch (error) {
                console.error('Balance check error:', error);
                ctx.reply('❌ Error checking balance. Please try again.');
            }
        });

        bot.action('deposit', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            ctx.answerCbQuery('💰 Deposit...');
            ctx.reply('Please select the bank option you wish to use for the top-up.\n\nእባክዎ ለማስገባት የሚፈልጉትን የባንክ አማራጭ ይምረጡ:', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📱 Telebirr', callback_data: 'deposit_telebirr' }]
                    ]
                }
            });
        });

        bot.action('support', (ctx) => {
            ctx.answerCbQuery('☎️ Support info...');
            ctx.reply('☎️ Contact Support:\n\n📞 For payment issues:\n@Funbingosupport1\n\n💬 For general support:\n@Funbingosupport1\n\n⏰ Support hours:\n24/7 available', { reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] } });
        });

        bot.action('instruction', (ctx) => {
            ctx.answerCbQuery('📖 Instructions...');
            const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
            if (isHttpsWebApp) keyboard.inline_keyboard.unshift([{ text: '🎮 Start Playing', web_app: { url: webAppUrl + '?stake=10' } }]);
            ctx.reply('📖 How to Play FUN Bingo:\n\n1️⃣ Select a bingo card\n2️⃣ Wait for numbers to be called\n3️⃣ Mark numbers on your card\n4️⃣ Call "BINGO!" when you win\n\n🎯 Win by getting 5 in a row (horizontal, vertical, or diagonal)\n\n💰 Prizes are shared among all winners!', { reply_markup: keyboard });
        });


        bot.action('withdraw', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            ctx.answerCbQuery('🤑 Withdraw info...');

            try {
                const userId = String(ctx.from.id);
                const userData = await UserService.getUserWithWallet(userId);
                if (!userData || !userData.wallet || !userData.user) {
                    return ctx.reply('❌ Wallet not found. Please try again later.');
                }

                const w = userData.wallet;
                const dbUserId = userData.user._id;

                // Check if user has deposit history
                const depositHistory = await Transaction.find({
                    userId: dbUserId,
                    type: 'deposit',
                    status: { $in: ['completed', 'pending'] }
                }).limit(1);

                const hasDepositHistory = depositHistory.length > 0;
                const keyboard = { inline_keyboard: [] };

                // If user has NO deposit history, check if they have 300 birr minimum
                if (!hasDepositHistory) {
                    if (w.main < 300) {
                        // Block withdrawal - show error message
                        keyboard.inline_keyboard.push([{ text: '❌ Insufficient Requirements', callback_data: 'back_to_menu' }]);
                        keyboard.inline_keyboard.push([{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]);

                        return ctx.reply(
                            `🤑 Withdraw Funds:\n\n💰 Main Wallet: ETB ${w.main.toFixed(2)}\n\n` +
                            `❌ ያለምንም ተቀመጭ ታሪክ (deposit history) ለማውጣት ቢያንስ 300 ብር የmain wallet ተቀማጭዎ መድረስ አለበት።\n` +
                            `በማንኛውም መጠን ማውጣት ለመጠየቅ እባክዎ መጀመሪያ ተቀማጭ ያድርጉ?\n` +
                            `ይህን የምናደርገው የጭዋታውን መድረክ ፍትሃዊ ለማድረግ ነው።\n\n` +
                            `💡 You need either:\n` +
                            `• Reach 300 birr in main wallet, OR\n` +
                            `• Make a deposit first to withdraw any amount`,
                            { reply_markup: keyboard }
                        );
                    }
                    // User has >= 300 birr but no deposit history - allow withdrawal
                }

                // Normal flow: user has deposit history OR has >= 300 birr with no deposit history
                if (w.main >= 50) {
                    keyboard.inline_keyboard.push([{ text: '💰 Request Withdrawal', callback_data: 'request_withdrawal' }]);
                } else {
                    keyboard.inline_keyboard.push([{ text: '❌ Insufficient Balance (Min: 50 ETB)', callback_data: 'back_to_menu' }]);
                }

                keyboard.inline_keyboard.push([{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]);

                ctx.reply(`🤑 Withdraw Funds:\n\n💰 Main Wallet: ETB ${w.main.toFixed(2)}\n\n💡 Withdrawal Options:\n• Minimum: ETB 50\n• Maximum: ETB 10,000\n• Processing: 24-48 hours\n\n📞 Contact support for assistance`, { reply_markup: keyboard });
            } catch (error) {
                console.error('Withdraw info error:', error);
                ctx.reply('❌ Error checking balance. Please try again.');
            }
        });

        bot.action('request_withdrawal', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            ctx.answerCbQuery('💰 Withdrawal request...');
            withdrawalStates.set(String(ctx.from.id), 'awaiting_amount');
            ctx.reply('💰 Enter withdrawal amount (ETB 50 - 10,000):\n\n💡 Example: 100\n\n🏦 You will choose transfer method after amount confirmation.');
        });

        // Withdrawal method selection handlers
        bot.action('withdraw_telebirr', (ctx) => {
            const userId = String(ctx.from.id);
            const state = withdrawalStates.get(userId);
            if (state && state.stage === 'awaiting_method') {
                withdrawalStates.set(userId, { stage: 'awaiting_number', amount: state.amount, method: 'Telebirr' });
                ctx.answerCbQuery('📱 Telebirr selected');
                ctx.reply('📱 Telebirr Withdrawal\n\n📱 Enter your Telebirr phone number:\n\n💡 Example: 0911234567 or +251911234567');
            }
        });

        bot.action('withdraw_commercial', (ctx) => {
            const userId = String(ctx.from.id);
            const state = withdrawalStates.get(userId);
            if (state && state.stage === 'awaiting_method') {
                withdrawalStates.set(userId, { stage: 'awaiting_number', amount: state.amount, method: 'Commercial Bank' });
                ctx.answerCbQuery('🏦 Commercial Bank selected');
                ctx.reply('🏦 Commercial Bank Withdrawal\n\n📋 Enter your Commercial Bank account number:\n\n💡 Example: 1000123456789');
            }
        });

        bot.action('withdraw_cbe', (ctx) => {
            const userId = String(ctx.from.id);
            const state = withdrawalStates.get(userId);
            if (state && state.stage === 'awaiting_method') {
                withdrawalStates.set(userId, { stage: 'awaiting_number', amount: state.amount, method: 'CBE Birr' });
                ctx.answerCbQuery('💳 CBE Birr selected');
                ctx.reply('💳 CBE Birr Withdrawal\n\n📱 Enter your CBE Birr phone number:\n\n💡 Example: 0911234567 or +251911234567');
            }
        });

        bot.action('withdraw_other', (ctx) => {
            const userId = String(ctx.from.id);
            const state = withdrawalStates.get(userId);
            if (state && state.stage === 'awaiting_method') {
                withdrawalStates.set(userId, { stage: 'awaiting_bank_name', amount: state.amount, method: 'Other Bank' });
                ctx.answerCbQuery('🏛️ Other Bank selected');
                ctx.reply('🏛️ Other Bank Withdrawal\n\n🏦 Enter your bank name:\n\n💡 Example: Awash Bank, Dashen Bank, etc.');
            }
        });

        // Admin withdrawal approval/denial handlers
        bot.action(/^approve_wd_(.+)$/, async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            const withdrawalId = ctx.match[1];

            try {
                // Get admin info
                const adminTelegramId = String(ctx.from.id);
                const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';

                // Get admin user from database
                let adminUser = null;
                let adminUserId = null;
                try {
                    adminUser = await User.findOne({ telegramId: adminTelegramId });
                    if (adminUser) {
                        adminUserId = adminUser._id;
                    }
                } catch (e) {
                    console.error('Error fetching admin user:', e);
                }

                // Get transaction details to show amount
                let transactionAmount = null;
                try {
                    const Transaction = require('../models/Transaction');
                    const transaction = await Transaction.findById(withdrawalId);
                    if (transaction) {
                        transactionAmount = transaction.amount;
                    }
                } catch (e) {
                    console.error('Error fetching transaction:', e);
                }

                const apiBase = process.env.API_BASE_URL || 'http://localhost:3001';
                const response = await fetch(`${apiBase}/admin/internal/withdrawals/${withdrawalId}/approve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        adminId: adminUserId,
                        adminTelegramId: adminTelegramId,
                        adminName: adminName
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    const amount = transactionAmount || result.transaction?.amount || null;
                    const adminNameDisplay = result.transaction?.adminName || adminName;
                    const amountDisplay = amount && typeof amount === 'number' ? amount.toLocaleString() : (amount || 'N/A');

                    await ctx.answerCbQuery('✅ Withdrawal approved');
                    await ctx.reply(`✅ Withdrawal has been approved and processed.\n\n💰 Amount: ETB ${amountDisplay}\n👤 Approved by: ${adminNameDisplay}`);

                    // Notify other admins about this action
                    try {
                        const transaction = await Transaction.findById(withdrawalId).populate('userId', 'firstName lastName phone telegramId');
                        const user = transaction.userId;
                        const userDisplay = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.phone || 'Unknown' : 'Unknown';
                        const destination = transaction.metadata?.destination || 'N/A';

                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Withdrawal Approved\n\n` +
                            `💰 Amount: ETB ${amountDisplay}\n` +
                            `👤 User: ${userDisplay}\n` +
                            `📱 Phone: ${user?.phone || 'N/A'}\n` +
                            `🏦 Destination: ${destination}\n` +
                            `✅ Approved by: ${adminNameDisplay}\n` +
                            `📋 Transaction ID: ${withdrawalId}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    } catch (notifyError) {
                        console.error('Error notifying other admins:', notifyError);
                    }
                } else {
                    await ctx.answerCbQuery('❌ Failed to approve');
                    await ctx.reply('❌ Failed to approve withdrawal. Please try again.');
                }
            } catch (error) {
                console.error('Approval error:', error);
                await ctx.answerCbQuery('❌ Error occurred');
                await ctx.reply('❌ Error processing approval. Please try again.');
            }
        });

        bot.action(/^deny_wd_(.+)$/, async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            const withdrawalId = ctx.match[1];

            try {
                // Get admin info
                const adminTelegramId = String(ctx.from.id);
                const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';

                const apiBase = process.env.API_BASE_URL || 'http://localhost:3001';
                const response = await fetch(`${apiBase}/admin/internal/withdrawals/${withdrawalId}/deny`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.ok) {
                    await ctx.answerCbQuery('❌ Withdrawal denied');
                    await ctx.reply('❌ Withdrawal has been denied.');

                    // Notify other admins about this action
                    try {
                        const transaction = await Transaction.findById(withdrawalId).populate('userId', 'firstName lastName phone telegramId');
                        const user = transaction.userId;
                        const userDisplay = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.phone || 'Unknown' : 'Unknown';
                        const destination = transaction.metadata?.destination || 'N/A';
                        const amount = transaction.amount || 0;

                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Withdrawal Denied\n\n` +
                            `💰 Amount: ETB ${amount.toLocaleString()}\n` +
                            `👤 User: ${userDisplay}\n` +
                            `📱 Phone: ${user?.phone || 'N/A'}\n` +
                            `🏦 Destination: ${destination}\n` +
                            `❌ Denied by: ${adminName}\n` +
                            `📋 Transaction ID: ${withdrawalId}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    } catch (notifyError) {
                        console.error('Error notifying other admins:', notifyError);
                    }
                } else {
                    await ctx.answerCbQuery('❌ Failed to deny');
                    await ctx.reply('❌ Failed to deny withdrawal. Please try again.');
                }
            } catch (error) {
                console.error('Denial error:', error);
                await ctx.answerCbQuery('❌ Error occurred');
                await ctx.reply('❌ Error processing denial. Please try again.');
            }
        });

        // Admin deposit approval/denial handlers
        bot.action(/^approve_dep_(.+)$/, async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            const verificationId = ctx.match[1];
            try {
                // Get admin info
                const adminTelegramId = String(ctx.from.id);
                const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';

                const apiBase = process.env.API_BASE_URL || 'http://localhost:3001';
                const response = await fetch(`${apiBase}/sms-forwarder/approve/${verificationId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ adminId: null })
                });
                if (response.ok) {
                    await ctx.answerCbQuery('✅ Deposit approved');
                    await ctx.reply('✅ Deposit has been approved and credited.');

                    // Notify other admins about this action
                    try {
                        const DepositVerification = require('../models/DepositVerification');
                        const verification = await DepositVerification.findById(verificationId)
                            .populate('userId', 'firstName lastName phone telegramId');
                        const user = verification.userId;
                        const userDisplay = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.phone || 'Unknown' : 'Unknown';
                        const amount = verification.amount || 0;

                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Deposit Approved\n\n` +
                            `💰 Amount: ETB ${amount.toLocaleString()}\n` +
                            `👤 User: ${userDisplay}\n` +
                            `📱 Phone: ${user?.phone || 'N/A'}\n` +
                            `✅ Approved by: ${adminName}\n` +
                            `📋 Verification ID: ${verificationId}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    } catch (notifyError) {
                        console.error('Error notifying other admins:', notifyError);
                    }
                } else {
                    const err = await response.json().catch(() => ({}));
                    await ctx.answerCbQuery('❌ Failed to approve');
                    await ctx.reply(`❌ Failed to approve deposit.${err?.error ? ` ${err.error}` : ''}`);
                }
            } catch (error) {
                console.error('Deposit approve error:', error);
                await ctx.answerCbQuery('❌ Error occurred');
                await ctx.reply('❌ Error processing deposit approval. Please try again.');
            }
        });

        bot.action(/^deny_dep_(.+)$/, async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            const verificationId = ctx.match[1];
            try {
                // Get admin info
                const adminTelegramId = String(ctx.from.id);
                const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';

                const apiBase = process.env.API_BASE_URL || 'http://localhost:3001';
                const response = await fetch(`${apiBase}/sms-forwarder/reject/${verificationId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ adminId: null, reason: 'Denied via Telegram' })
                });
                if (response.ok) {
                    await ctx.answerCbQuery('❌ Deposit denied');
                    await ctx.reply('❌ Deposit has been denied.');

                    // Notify other admins about this action
                    try {
                        const DepositVerification = require('../models/DepositVerification');
                        const verification = await DepositVerification.findById(verificationId)
                            .populate('userId', 'firstName lastName phone telegramId');
                        const user = verification.userId;
                        const userDisplay = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.phone || 'Unknown' : 'Unknown';
                        const amount = verification.amount || 0;
                        const reason = verification.rejectionReason || 'Denied via Telegram';

                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Deposit Denied\n\n` +
                            `💰 Amount: ETB ${amount.toLocaleString()}\n` +
                            `👤 User: ${userDisplay}\n` +
                            `📱 Phone: ${user?.phone || 'N/A'}\n` +
                            `❌ Denied by: ${adminName}\n` +
                            `📝 Reason: ${reason}\n` +
                            `📋 Verification ID: ${verificationId}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    } catch (notifyError) {
                        console.error('Error notifying other admins:', notifyError);
                    }
                } else {
                    const err = await response.json().catch(() => ({}));
                    await ctx.answerCbQuery('❌ Failed to deny');
                    await ctx.reply(`❌ Failed to deny deposit.${err?.error ? ` ${err.error}` : ''}`);
                }
            } catch (error) {
                console.error('Deposit deny error:', error);
                await ctx.answerCbQuery('❌ Error occurred');
                await ctx.reply('❌ Error processing deposit denial. Please try again.');
            }
        });

        bot.action('invite', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            ctx.answerCbQuery('🔗 Invite friends...');
            const inviteLink = `https://t.me/${ctx.botInfo.username}?start=invite_${ctx.from.id}`;
            const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
            keyboard.inline_keyboard.unshift([{ text: '📤 Share Link', url: `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=Join me in FUN Bingo!` }]);

            // Send image with caption
            const imagePath = path.join(__dirname, '../static/lb.png');
            try {
                await ctx.replyWithPhoto(
                    { source: imagePath },
                    {
                        caption: `🔗 Invite Friends to FUN Bingo!\n\n🎁 Get ETB 1 bonus to your Play Wallet for each friend who registers.\n\n👥 Share this link with your friends:\n\n${inviteLink}`,
                        reply_markup: keyboard
                    }
                );
            } catch (error) {
                console.error('Error sending invite image:', error);
                // Fallback to text message if image fails
                ctx.reply(`🔗 Invite Friends to FUN Bingo!\n\n🎁 Get ETB 1 bonus to your Play Wallet for each friend who registers.\n\n👥 Share this link with your friends:\n\n${inviteLink}`, { reply_markup: keyboard });
            }
        });

        bot.action('back_to_menu', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            ctx.answerCbQuery('🔙 Back to menu');
            const welcomeText = `👋 Welcome to FUN Bingo! Choose an Option below.`;
            const playBtn = isHttpsWebApp
                ? [{ text: '🎮 Play-10', web_app: { url: webAppUrl + '?stake=10' } }]
                : [{ text: '🎮 Play-10', callback_data: 'play' }];
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        playBtn,
                        [{ text: '💵 Check Balance', callback_data: 'balance' }, { text: '💰 Deposit', callback_data: 'deposit' }],
                        [{ text: '☎️ Contact Support', callback_data: 'support' }, { text: '📖 Instruction', callback_data: 'instruction' }],
                        [{ text: '🤑 Withdraw', callback_data: 'withdraw' }, { text: '🔗 Invite', callback_data: 'invite' }]
                    ]
                }
            };
            return ctx.editMessageText(welcomeText, keyboard);
        });

        // Handle Telebirr selection (without amount - amount will be parsed from receipt)
        bot.action('deposit_telebirr', (ctx) => {
            ctx.answerCbQuery('📱 Telebirr deposit...');
            // Using code block formatting to create a styled box effect
            const telebirrMessage = `የ Telebirr አካውንት
0994237676 - 

መመሪያ

\`\`\`
1. ከላይ ባለው የ Telebirr አካውንት ገንዘቡን ያስገቡ
2. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዝ አጭር የጹሁፍ መልክት(sms) ከ Telebirr ይደርሳችኋል
3. የደረሳችሁን አጭር የጹሁፍ መለክት(sms) ሙሉዉን ኮፒ(copy) በማረግ ከታሽ ባለው የቴሌግራም የጹሁፍ ማስገቢአው ላይ ፔስት(paste) በማረግ ይላኩት
\`\`\`

የሚያጋጥማቹ የክፍያ ችግር ካለ @Funbingosupport1  በዚ ሳፖርት ማዉራት ይችላሉ`;
            
            ctx.reply(telebirrMessage, { parse_mode: 'Markdown' });
        });

        // Keep the old handler for backward compatibility (if amount is provided in callback)
        bot.action(/^deposit_telebirr_(\d+(?:\.\d{1,2})?)$/, (ctx) => {
            const amount = ctx.match[1];
            ctx.answerCbQuery('📱 Telebirr deposit...');
            // Using code block formatting to create a styled box effect
            const telebirrMessage = `የ Telebirr አካውንት
0994237676 - 

መመሪያ

\`\`\`
1. ከላይ ባለው የ Telebirr አካውንት ገንዘቡን ያስገቡ
2. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዝ አጭር የጹሁፍ መልክት(sms) ከ Telebirr ይደርሳችኋል
3. የደረሳችሁን አጭር የጹሁፍ መለክት(sms) ሙሉዉን ኮፒ(copy) በማረግ ከታሽ ባለው የቴሌግራም የጹሁፍ ማስገቢአው ላይ ፔስት(paste) በማረግ ይላኩት
\`\`\`

የሚያጋጥማቹ የክፍያ ችግር ካለ @Funbingosupport1  በዚ ሳፖርት ማዉራት ይችላሉ`;
            
            ctx.reply(telebirrMessage, { parse_mode: 'Markdown' });
        });
        // Temporarily disabled - Commercial Bank payment method
        // bot.action(/^deposit_commercial_(\d+(?:\.\d{1,2})?)$/, (ctx) => {
        //     const amount = ctx.match[1];
        //     ctx.answerCbQuery('🏦 Commercial Bank deposit...');
        //     ctx.reply(`🏦 Commercial Bank Deposit ቅደም ተከተል:\n\n📋 Agent Details:\n👤 Name: Lealem Meseret\n🏦 Account: \`1000415847959\`\n🏛️ Bank: Commercial Bank of Ethiopia\n\n💡 Steps:\n1️⃣ በስልክዎ ወደ 889 የንግድ ባንክ አጭር ኮድ ይግቡ\n2️⃣ Transfer to account: \`1000415847959\`\n3️⃣ ከዛ ቦቱ ላይ ለማስቀመጥ የላኩትን መጠን እዚህ ያስገቡ እኩል መሆኑን አረጋግጡ!: ETB ${amount}\n4️⃣ Complete the transaction\n5️⃣ ከCBE የሚደርስዎትን የአጭር መልዕክት ኮፒ አድርገው ቦቱ ላይ ላኩ!\n Send the SMS receipt here\n\n✅ ሂሳብዎም ወዲያውኑ ይሞላል።\n Your wallet will be credited automatically!`, { reply_markup: { inline_keyboard: [[{ text: '📋 Copy Account', callback_data: 'copy_commercial' }], [{ text: '📱 ደረሰኝ ላክ', callback_data: 'send_receipt_commercial' }], [{ text: '🔙 Back to Deposit', callback_data: 'deposit' }]] } });
        // });
        // Temporarily disabled - CBE Birr payment method
        // bot.action(/^deposit_cbe_(\d+(?:\.\d{1,2})?)$/, (ctx) => {
        //     const amount = ctx.match[1];
        //     ctx.answerCbQuery('💳 CBE Birr deposit...');
        //     ctx.reply(`💳 CBE Birr Deposit ቅደም ተከተል:\n\n📋 Agent Details:\n👤 Name: Lealem Meseret\n💳 CBE Birr: \`0934551781\`\n🏦 Bank: Commercial Bank of Ethiopia\n\n💡 Steps:\n1️⃣ Open CBE Birr app ወይም አጭር ቁጥር 847 ይጠቀሙ\n2️⃣ Select "Send Money"\n3️⃣ Enter agent number: \`0934551781\`\n4️⃣ Enter amount: ETB ${amount}\n5️⃣ Send the transaction\n6️⃣ ከCBEBirr የሚደርስዎትን የአጭር መልዕክት ኮፒ አድርገው ቦቱ ላይ ላኩ!\n\n✅ ሂሳብዎም ወዲያውኑ ይሞላል። \n Your wallet will be credited automatically!`, { reply_markup: { inline_keyboard: [[{ text: '📋 Copy Number', callback_data: 'copy_cbe' }], [{ text: '📱 ደረሰኝ ላክላክ', callback_data: 'send_receipt_cbe' }], [{ text: '🔙 Back to Deposit', callback_data: 'deposit' }]] } });
        // });

        bot.action('send_receipt_telebirr', (ctx) => {
            const userId = String(ctx.from.id);
            depositStates.set(userId, 'awaiting_receipt');
            ctx.answerCbQuery('📱 Ready for Telebirr receipt...');
            ctx.reply('📱 Send your Telebirr transaction receipt here:\n\n💡 የደርስዎትን የአጭር መልዕክት ኮፒ አድርገው ቦቱ ላይ ላኩ!\n\n✅ Your wallet will be credited automatically!');
        });
        // Temporarily disabled - Commercial Bank receipt handler
        // bot.action('send_receipt_commercial', (ctx) => {
        //     const userId = String(ctx.from.id);
        //     depositStates.set(userId, 'awaiting_receipt');
        //     ctx.answerCbQuery('📱 Ready for Commercial Bank SMS...');
        //     ctx.reply('📱 Send your Commercial Bank SMS receipt here:\n\n💡 የደርስዎትን የአጭር መልዕክት ኮፒ አድርገው ቦቱ ላይ ላኩ!\n\n✅ Your wallet will be credited automatically!');
        // });
        // Temporarily disabled - CBE Birr receipt handler
        // bot.action('send_receipt_cbe', (ctx) => {
        //     const userId = String(ctx.from.id);
        //     depositStates.set(userId, 'awaiting_receipt');
        //     ctx.answerCbQuery('📱 Ready for CBE Birr receipt...');
        //     ctx.reply('📱 Send your CBE Birr transaction receipt here:\n\n💡 የደርስዎትን የአጭር መልዕክት ኮፒ አድርገው ቦቱ ላይ ላኩ! \n\n✅ Your wallet will be credited automatically!');
        // });

        // Copy button handlers
        bot.action('copy_telebirr', (ctx) => {
            ctx.answerCbQuery('📋 Telebirr number copied!');
            ctx.reply('📱 Telebirr Number:\n\n`0994237676`\n\n💡 Tap and hold to select, then copy!', { parse_mode: 'Markdown' });
        });
        // Temporarily disabled - Commercial Bank copy handler
        // bot.action('copy_commercial', (ctx) => {
        //     ctx.answerCbQuery('📋 Commercial Bank account copied!');
        //     ctx.reply('🏦 Commercial Bank Account:\n\n`1000415847959`\n\n💡 Tap and hold to select, then copy!', { parse_mode: 'Markdown' });
        // });
        // Temporarily disabled - CBE Birr copy handler
        // bot.action('copy_cbe', (ctx) => {
        //     ctx.answerCbQuery('📋 CBE Birr number copied!');
        //     ctx.reply('💳 CBE Birr Number:\n\n`0934551781`\n\n💡 Tap and hold to select, then copy!', { parse_mode: 'Markdown' });
        // });

        bot.on('contact', async (ctx) => {
            try {
                const userId = String(ctx.from.id);
                const contact = ctx.message.contact;
                try {
                    const existing = await UserService.getUserByTelegramId(userId);
                    if (existing && (existing.isRegistered || existing.phone)) {
                        await ctx.reply('✅ You are already registered with this account.');
                        await ctx.reply('🎮 You can now continue using the menu.', { reply_markup: { remove_keyboard: true } });
                        const playBtn = isHttpsWebApp
                            ? [{ text: '🎮 Play-10', web_app: { url: webAppUrl + '?stake=10' } }]
                            : [{ text: '🎮 Play-10', callback_data: 'play' }];
                        const keyboard = {
                            reply_markup: {
                                inline_keyboard: [
                                    playBtn,
                                    [{ text: '💵 Check Balance', callback_data: 'balance' }, { text: '💰 Deposit', callback_data: 'deposit' }],
                                    [{ text: '☎️ Contact Support', callback_data: 'support' }, { text: '📖 Instruction', callback_data: 'instruction' }],
                                    [{ text: '🤑 Withdraw', callback_data: 'withdraw' }, { text: '🔗 Invite', callback_data: 'invite' }]
                                ]
                            }
                        };
                        setTimeout(() => { ctx.reply('🎮 Choose an option:', keyboard); }, 800);
                        return;
                    }
                } catch {
                    // ignore
                }
                try {
                    let user = await UserService.getUserByTelegramId(userId);
                    if (!user) { user = await UserService.createOrUpdateUser(ctx.from); }
                    const result = await UserService.updateUserPhone(userId, contact.phone_number);
                    const isNewRegistration = result?.isNewRegistration;

                    const displayName =
                        (ctx.from?.username ? `@${ctx.from.username}` : '') ||
                        (contact.first_name || '').trim() ||
                        (ctx.from?.first_name || '').trim() ||
                        'User';

                    // Private welcome message to the registering user (no broadcast, no phone number)
                    if (isNewRegistration) {
                        await ctx.reply(
                            `${displayName} welcome to Fun Bingo and enjoy 🎁 Welcome Bonus: 10 ETB added to your Play Wallet!`,
                            { reply_markup: { remove_keyboard: true } }
                        );
                    } else {
                        await ctx.reply('✅ Registration completed!', { reply_markup: { remove_keyboard: true } });
                    }
                } catch (dbError) {
                    console.log('Database unavailable during contact update');
                    const displayName =
                        (ctx.from?.username ? `@${ctx.from.username}` : '') ||
                        (contact.first_name || '').trim() ||
                        (ctx.from?.first_name || '').trim() ||
                        'User';
                    ctx.reply(
                        `${displayName} welcome to Fun Bingo and enjoy 🎁 Welcome Bonus: 10 ETB added to your Play Wallet!`,
                        { reply_markup: { remove_keyboard: true } }
                    );
                }
            } catch (error) {
                console.error('Contact registration error:', error);
                ctx.reply('❌ Registration failed. Please try again.');
            }
            const playBtn = isHttpsWebApp
                ? [{ text: '🎮 Play-10', web_app: { url: webAppUrl + '?stake=10' } }]
                : [{ text: '🎮 Play-10', callback_data: 'play' }];
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        playBtn,
                        [{ text: '💵 Check Balance', callback_data: 'balance' }, { text: '💰 Deposit', callback_data: 'deposit' }],
                        [{ text: '☎️ Contact Support', callback_data: 'support' }, { text: '📖 Instruction', callback_data: 'instruction' }],
                        [{ text: '🤑 Withdraw', callback_data: 'withdraw' }, { text: '🔗 Invite', callback_data: 'invite' }]
                    ]
                }
            };
            setTimeout(() => { ctx.reply('🎮 Choose an option:', keyboard); }, 1000);
        });

        bot.on('text', async (ctx, next) => {
            try {
                const adminId = String(ctx.from.id);
                const state = adminStates.get(adminId);
                const isAdmin = await isAdminByDB(adminId);

                // Handle broadcast mode for text messages
                if (state && state.mode === 'broadcast' && isAdmin) {
                    adminStates.delete(adminId);
                    const adminTelegramId = String(ctx.from.id);
                    const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';
                    try {
                        const targets = await getBroadcastTargets();
                        const options = buildBroadcastMarkup(ctx.message.text);
                        const { success, failed, total } = await sendToAll(targets, async (id) => {
                            await bot.telegram.sendMessage(id, ctx.message.text, options);
                        });
                        await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                        // Notify other admins about broadcast
                        const messagePreview = ctx.message.text.length > 100
                            ? ctx.message.text.substring(0, 100) + '...'
                            : ctx.message.text;
                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Broadcast Sent\n\n` +
                            `📝 Message Preview: ${messagePreview}\n` +
                            `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                            `📣 Broadcast by: ${adminName}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    } catch (error) {
                        console.error('Broadcast error:', error);
                        await ctx.reply(`❌ Failed to broadcast: ${error.message || 'Unknown error'}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
                    }
                    return;
                }

                // Handle caption for media
                if (state && state.mode === 'await_caption_media' && isAdmin) {
                    adminStates.delete(adminId);
                    const adminTelegramId = String(ctx.from.id);
                    const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';
                    try {
                        const result = await sendPendingMediaToAll(state.pending, ctx.message.text || '');
                        const { success, failed, total } = result;
                        await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                        // Notify other admins about broadcast
                        const mediaType = state.pending?.kind || 'media';
                        const captionPreview = ctx.message.text ? (ctx.message.text.length > 100 ? ctx.message.text.substring(0, 100) + '...' : ctx.message.text) : 'No caption';
                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Broadcast Sent (${mediaType})\n\n` +
                            `📝 Caption: ${captionPreview}\n` +
                            `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                            `📣 Broadcast by: ${adminName}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    } catch {
                        await ctx.reply('❌ Failed to broadcast.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
                    }
                    return;
                }
            } catch (error) {
                console.error('Text handler error:', error);
            }
            return next();
        });

        // Track withdrawal states
        const withdrawalStates = new Map();

        // Track deposit states (awaiting receipt)
        const depositStates = new Map();

        bot.hears(/.*/, async (ctx) => {
            try {
                if (ctx.message.text.startsWith('/') || ctx.update.callback_query) return;
                const isAdminMsg = await isAdminByDB(ctx.from.id);
                if (!isAdminMsg) {
                    const ok = await isUserRegistered(String(ctx.from.id));
                    if (!ok) {
                        const keyboard = { reply_markup: { keyboard: [[{ text: '📱 Share Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } };
                        await ctx.reply('📝 Please complete registration to continue.\n\n📱 Tap "Share Contact" below to provide your phone number.', keyboard);
                        return;
                    }
                }
                const userId = String(ctx.from.id);
                const messageText = ctx.message.text || '';

                // Check if user is in withdrawal flow
                const withdrawalState = withdrawalStates.get(userId);
                if (withdrawalState === 'awaiting_amount') {
                    const amountMatch = messageText.match(/^(\d+(?:\.\d{1,2})?)$/);
                    if (amountMatch) {
                        const amount = Number(amountMatch[1]);
                        if (amount >= 50 && amount <= 10000) {
                            // Store amount and ask for transfer method
                            withdrawalStates.set(userId, { stage: 'awaiting_method', amount });
                            ctx.reply(`💰 Withdrawal Amount: ETB ${amount}\n\n🏦 Choose your preferred transfer method:`, {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '📱 Telebirr', callback_data: 'withdraw_telebirr' }],
                                        [{ text: '🏦 Commercial Bank', callback_data: 'withdraw_commercial' }],
                                        [{ text: '💳 CBE Birr', callback_data: 'withdraw_cbe' }],
                                        [{ text: '🏛️ Other Bank', callback_data: 'withdraw_other' }],
                                        [{ text: '❌ Cancel', callback_data: 'back_to_menu' }]
                                    ]
                                }
                            });
                            return;
                        } else {
                            ctx.reply('❌ Invalid amount. Please enter between ETB 50 - 10,000.');
                            return;
                        }
                    } else {
                        ctx.reply('❌ Please enter a valid amount (numbers only).');
                        return;
                    }
                }

                // Handle sequential withdrawal steps
                if (withdrawalState && withdrawalState.stage === 'awaiting_number') {
                    const number = messageText.trim();
                    if (number.length < 5) {
                        ctx.reply('❌ Please enter a valid number (at least 5 characters).');
                        return;
                    }

                    // Store number and ask for account holder name
                    withdrawalStates.set(userId, {
                        ...withdrawalState,
                        stage: 'awaiting_name',
                        number: number
                    });
                    ctx.reply(`✅ ${withdrawalState.method} Number: ${number}\n\n👤 የአካውንት ባለቤት ስም ያስገቡ\n Enter the account holder's full name:\n\n💡 Example: John Doe`);
                    return;
                }

                if (withdrawalState && withdrawalState.stage === 'awaiting_bank_name') {
                    const bankName = messageText.trim();
                    if (bankName.length < 3) {
                        ctx.reply('❌ Please enter a valid bank name (at least 3 characters).');
                        return;
                    }

                    // Store bank name and ask for account number
                    withdrawalStates.set(userId, {
                        ...withdrawalState,
                        stage: 'awaiting_number',
                        bankName: bankName
                    });
                    ctx.reply(`✅ Bank: ${bankName}\n\n📋 Enter your account number:\n\n💡 Example: 1000123456789`);
                    return;
                }

                if (withdrawalState && withdrawalState.stage === 'awaiting_name') {
                    const accountHolder = messageText.trim();
                    if (accountHolder.length < 2) {
                        ctx.reply('❌ Please enter a valid name (at least 2 characters).');
                        return;
                    }

                    // Build destination string
                    let destination;
                    if (withdrawalState.method === 'Other Bank') {
                        destination = `${withdrawalState.bankName}, ${withdrawalState.number}, ${accountHolder}`;
                    } else {
                        destination = `${withdrawalState.method}, ${withdrawalState.number}, ${accountHolder}`;
                    }

                    try {
                        // Get user and generate JWT token
                        const user = await UserService.getUserByTelegramId(userId);
                        if (!user) {
                            ctx.reply('❌ User not found. Please try again.');
                            return;
                        }

                        const token = generateUserToken(user._id);

                        // Create withdrawal request via API
                        const apiBase = process.env.API_BASE_URL || 'http://localhost:3001';
                        const response = await fetch(`${apiBase}/wallet/withdraw`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({
                                amount: withdrawalState.amount,
                                destination
                            })
                        });

                        if (response.ok) {
                            const result = await response.json();
                            withdrawalStates.delete(userId);

                            // Notify admin with user's wallet info
                            let walletLine = '';
                            try {
                                const userWithWallet = await UserService.getUserWithWallet(userId);
                                const w = userWithWallet && userWithWallet.wallet;
                                if (w) {
                                    walletLine = `\n👛 User Wallet:\n- Main: ETB ${Number(w.main || 0).toFixed(2)}\n- Play: ETB ${Number(w.play || 0).toFixed(2)}\n- Coins: ${Number(w.coins || 0).toFixed(0)}`;
                                }
                            } catch { }

                            const displayPhone = user.phone || user.telegramId || ctx.from.id;

                            const adminUsers = await require('../models/User').find({ role: 'admin' }, { telegramId: 1 });
                            for (const admin of adminUsers) {
                                try {
                                    await bot.telegram.sendMessage(
                                        admin.telegramId,
                                        `🆕 New Withdrawal Request\n\n👤 User: ${ctx.from.first_name} ${ctx.from.last_name || ''}\n📱 Phone: ${displayPhone}\n💰 Amount: ETB ${withdrawalState.amount}\n🏦 Destination: ${destination}\n📋 Transaction ID: ${result.transactionId}${walletLine}\n\n⏰ Process within 24-48 hours`,
                                        { reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_wd_${result.transactionId}` }, { text: '❌ Deny', callback_data: `deny_wd_${result.transactionId}` }]] } }
                                    );
                                } catch (e) { console.log('Failed to notify admin:', e?.message); }
                            }

                            ctx.reply(`✅ Withdrawal Request Submitted!\n\n💰 Amount: ETB ${withdrawalState.amount}\n🏦 Destination: ${destination}\n📋 Transaction ID: ${result.transactionId}\n\n⏰ Processing: 24-48 hours\n📞 Contact support for updates`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] } });
                        } else {
                            const error = await response.json();
                            let errorMsg = '❌ Withdrawal request failed.';
                            if (error.error === 'INSUFFICIENT_FUNDS') errorMsg = '❌ Insufficient balance in main wallet.';
                            else if (error.error === 'INVALID_AMOUNT') errorMsg = '❌ Invalid amount. Minimum is ETB 50, maximum is ETB 10,000.';
                            else if (error.error === 'DESTINATION_REQUIRED') errorMsg = '❌ Destination information is required.';
                            else if (error.error === 'USER_NOT_FOUND') errorMsg = '❌ User not found. Please try again.';
                            else if (error.error === 'NO_DEPOSIT_HISTORY_MIN_300') {
                                errorMsg = error.message || '❌  ያለምንም ተቀመጭ ታሪክ (deposit history) ለማውጣት ቢያንስ 300 ብር የmain wallet ተቀማጭዎ መድረስ አለበት። በማንኛውም መጠን ማውጣት ለመጠየቅ እባክዎ መጀመሪያ ተቀማጭ ያድርጉ? ይህን የምናደርገው የጭዋታውን መድረክ ፍትሃዊ ለማድረግ ነው። ';
                            }
                            else if (error.error === 'INTERNAL_ERROR') errorMsg = '❌ Internal server error. Please try again later.';

                            ctx.reply(errorMsg, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] } });
                        }
                    } catch (error) {
                        console.error('Withdrawal API error:', error);
                        ctx.reply('❌ Withdrawal request failed. Please try again or contact support.');
                    }
                    withdrawalStates.delete(userId);
                    return;
                }

                // Check if user is trying to enter amount (old flow - redirect to bank selection)
                const amountMatch = messageText.match(/^(\d+(?:\.\d{1,2})?)$/);
                if (amountMatch) {
                    const amount = Number(amountMatch[1]);
                    if (amount >= 50) {
                        // Redirect to bank selection (new flow)
                        ctx.reply('Please select the bank option you wish to use for the top-up.\n\nእባክዎ ለማስገባት የሚፈልጉትን የባንክ አማራጭ ይምረጡ:', {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📱 Telebirr', callback_data: 'deposit_telebirr' }],
                                    [{ text: '❌ Cancel', callback_data: 'back_to_menu' }]
                                ]
                            }
                        });
                        return;
                    } else {
                        return ctx.reply('❌ Minimum deposit amount is 50 Birr. Please enter a valid amount.');
                    }
                }
                // Check if user is in deposit receipt flow
                const depositState = depositStates.get(userId);
                let parsed = null;

                if (depositState === 'awaiting_receipt') {
                    // User is in deposit flow - process receipt
                    parsed = parseReceipt(messageText);
                    if (!parsed) {
                        // Log the message for debugging
                        console.log('❌ Failed to parse SMS receipt:', {
                            messagePreview: messageText.substring(0, 200),
                            messageLength: messageText.length,
                            userId: userId
                        });
                        // Close deposit session
                        depositStates.delete(userId);
                        return ctx.reply('❌ Could not detect amount in your message.\n\n💡 Please paste the full receipt from your payment method.\n\n📋 Make sure it contains the amount (minimum ETB 50).\n\n🔙 Session closed. Use /deposit to try again.', {
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] }
                        });
                    }
                } else {
                    // NOT in deposit flow - check if it looks like a receipt
                    parsed = parseReceipt(messageText);
                    if (parsed) {
                        // Looks like a receipt but deposit process is finished
                        // Show "unknown text" message
                        return ctx.reply('❓ Unknown text. What do you want?\n\n💡 If you want to make a deposit, use /deposit command.\n\n📋 Available commands:\n/deposit - Make a deposit\n/withdraw - Withdraw funds\n/balance - Check balance\n/play - Play game', {
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] }
                        });
                    }
                    // Not a receipt and not in deposit flow, continue normal flow
                    return;
                }

                // Log successful parsing for debugging
                console.log('✅ Parsed SMS receipt:', {
                    amount: parsed.amount,
                    hasRef: !!parsed.ref,
                    hasWhen: !!parsed.when,
                    type: parsed.type,
                    userId: userId
                });

                let user = await UserService.getUserByTelegramId(userId);
                if (!user) { user = await UserService.createOrUpdateUser(ctx.from); }

                // Send user SMS to dual verification system
                try {
                    const apiUrl = `${process.env.API_BASE_URL || 'http://localhost:3001'}/sms-forwarder/user-sms`;
                    console.log('📤 Sending SMS to API:', { apiUrl, userId: user._id, hasPhone: !!user.phone });

                    const response = await fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: user._id,
                            message: messageText,
                            phoneNumber: user.phone
                        })
                    });

                    const contentType = response.headers.get('content-type') || '';
                    if (!response.ok || !contentType.includes('application/json')) {
                        const errorText = await response.text();
                        console.error('❌ API non-JSON or error response:', {
                            status: response.status,
                            statusText: response.statusText,
                            contentType,
                            bodyPreview: errorText?.slice(0, 500)
                        });
                        throw new Error(`Bad API response (${response.status})`);
                    }

                    const result = await response.json();
                    console.log('📥 API response:', { success: result.success, verificationId: result.verificationId, isVerified: result.isVerified });

                    if (result.success) {
                        // Notify admins if auto-verification created
                        if (result.verificationId) {
                            try {
                                const adminUsers = await require('../models/User').find({ role: 'admin' }, { telegramId: 1 });
                                for (const admin of adminUsers) {
                                    try {
                                        await bot.telegram.sendMessage(
                                            admin.telegramId,
                                            `🆕 New Deposit Verification\n\n👤 User: ${ctx.from.first_name} ${ctx.from.last_name || ''}\n📱 Phone: ${user.phone || user.telegramId || ctx.from.id}\n💰 Amount: ETB ${parsed.amount?.toFixed(2) || 'N/A'}\n🔎 Reference: ${parsed.reference || 'N/A'}\n📋 Verification ID: ${result.verificationId}\n\n⏰ Review and process`,
                                            { reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_dep_${result.verificationId}` }, { text: '❌ Deny', callback_data: `deny_dep_${result.verificationId}` }]] } }
                                        );
                                    } catch (e) { }
                                }
                            } catch { }
                        } else {
                            // No verification created yet (no receiver match) – proactively notify admins
                            try {
                                const adminUsers = await require('../models/User').find({ role: 'admin' }, { telegramId: 1 });
                                for (const admin of adminUsers) {
                                    try {
                                        await bot.telegram.sendMessage(
                                            admin.telegramId,
                                            `📝 Pending Deposit Receipt (No Match Yet)\n\n👤 User: ${ctx.from.first_name} ${ctx.from.last_name || ''}\n📱 Phone: ${user.phone || user.telegramId || ctx.from.id}\n💰 Amount: ETB ${parsed.amount?.toFixed(2) || 'N/A'}\n🔎 Reference: ${parsed.reference || 'N/A'}\n\n⏳ Waiting for receiver SMS to auto-verify.`
                                        );
                                    } catch (e) { }
                                }
                            } catch { }
                        }

                        // Close deposit session
                        depositStates.delete(userId);

                        const statusText = result.isVerified ? 'verified' : 'pending review';
                        const nextStep = result.isVerified
                            ? '✅ Deposit matched and will be credited shortly.'
                            : '⏳ Awaiting admin approval. You will be notified when approved.';
                        return ctx.reply(`📱 SMS Received!\n\n✅ Your payment receipt has been received.\n\n💰 Amount: ETB ${parsed.amount.toFixed(2)}\n🔄 Status: ${statusText}\n\n${nextStep}`, {
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] }
                        });
                    } else {
                        throw new Error('Failed to process SMS');
                    }
                } catch (error) {
                    // Close deposit session on error
                    depositStates.delete(userId);

                    console.error('❌ Dual SMS verification error:', {
                        message: error.message,
                        stack: error.stack,
                        name: error.name,
                        userId: user?._id,
                        hasPhone: !!user?.phone
                    });
                    return ctx.reply('❌ Failed to process your SMS. Please try again or contact support.\n\n🔙 Session closed. Use /deposit to try again.', {
                        reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] }
                    });
                }
            } catch (error) {
                console.error('SMS deposit error:', error);
                ctx.reply('❌ Deposit failed. Please try again or contact support.');
            }
        });

        bot.on(['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'animation'], async (ctx) => {
            const adminId = String(ctx.from.id);
            const state = adminStates.get(adminId);
            if (!state || (state.mode !== 'broadcast' && state.mode !== 'await_caption_media')) return;
            const isAdmin = await isAdminByDB(adminId);
            if (!isAdmin) return;
            const adminTelegramId = String(ctx.from.id);
            const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';
            try {
                let targets = [];
                targets = await getBroadcastTargets();
                if (ctx.message.photo) {
                    const best = ctx.message.photo[ctx.message.photo.length - 1];
                    const fileId = best?.file_id;
                    const caption = ctx.message.caption || '';
                    if (!caption) {
                        adminStates.set(adminId, { mode: 'await_caption_media', pending: { kind: 'photo', fileId } });
                        await ctx.reply('✍️ Type caption for this image, or tap Skip.', { reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip', callback_data: 'skip_broadcast_caption' }]] } });
                    } else {
                        adminStates.delete(adminId);
                        const options = buildBroadcastMarkup(caption);
                        const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendPhoto(id, fileId, options); });
                        await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                        // Notify other admins
                        const captionPreview = caption.length > 100 ? caption.substring(0, 100) + '...' : caption;
                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Broadcast Sent (photo)\n\n` +
                            `📝 Caption: ${captionPreview || 'No caption'}\n` +
                            `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                            `📣 Broadcast by: ${adminName}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    }
                } else if (ctx.message.video) {
                    const fileId = ctx.message.video.file_id;
                    const caption = ctx.message.caption || '';
                    if (!caption) {
                        adminStates.set(adminId, { mode: 'await_caption_media', pending: { kind: 'video', fileId } });
                        await ctx.reply('✍️ Type caption for this video, or tap Skip.', { reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip', callback_data: 'skip_broadcast_caption' }]] } });
                    } else {
                        adminStates.delete(adminId);
                        const options = buildBroadcastMarkup(caption);
                        const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendVideo(id, fileId, options); });
                        await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                        // Notify other admins
                        const captionPreview = caption.length > 100 ? caption.substring(0, 100) + '...' : caption;
                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Broadcast Sent (video)\n\n` +
                            `📝 Caption: ${captionPreview || 'No caption'}\n` +
                            `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                            `📣 Broadcast by: ${adminName}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    }
                } else if (ctx.message.document) {
                    const fileId = ctx.message.document.file_id;
                    const caption = ctx.message.caption || '';
                    if (!caption) {
                        adminStates.set(adminId, { mode: 'await_caption_media', pending: { kind: 'document', fileId } });
                        await ctx.reply('✍️ Type caption for this document, or tap Skip.', { reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip', callback_data: 'skip_broadcast_caption' }]] } });
                    } else {
                        adminStates.delete(adminId);
                        const options = buildBroadcastMarkup(caption);
                        const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendDocument(id, fileId, options); });
                        await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                        // Notify other admins
                        const captionPreview = caption.length > 100 ? caption.substring(0, 100) + '...' : caption;
                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Broadcast Sent (document)\n\n` +
                            `📝 Caption: ${captionPreview || 'No caption'}\n` +
                            `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                            `📣 Broadcast by: ${adminName}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    }
                } else if (ctx.message.audio) {
                    const fileId = ctx.message.audio.file_id;
                    const options = buildBroadcastMarkup('');
                    const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendAudio(id, fileId, options); });
                    await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                    // Notify other admins
                    await notifyOtherAdmins(
                        adminTelegramId,
                        `👤 Admin Action: Broadcast Sent (audio)\n\n` +
                        `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                        `📣 Broadcast by: ${adminName}\n` +
                        `🕐 Time: ${new Date().toLocaleString()}`
                    );
                } else if (ctx.message.voice) {
                    const fileId = ctx.message.voice.file_id;
                    const options = buildBroadcastMarkup('');
                    const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendVoice(id, fileId, options); });
                    await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                    // Notify other admins
                    await notifyOtherAdmins(
                        adminTelegramId,
                        `👤 Admin Action: Broadcast Sent (voice)\n\n` +
                        `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                        `📣 Broadcast by: ${adminName}\n` +
                        `🕐 Time: ${new Date().toLocaleString()}`
                    );
                } else if (ctx.message.sticker) {
                    const fileId = ctx.message.sticker.file_id;
                    const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendSticker(id, fileId); });
                    await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                    // Notify other admins
                    await notifyOtherAdmins(
                        adminTelegramId,
                        `👤 Admin Action: Broadcast Sent (sticker)\n\n` +
                        `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                        `📣 Broadcast by: ${adminName}\n` +
                        `🕐 Time: ${new Date().toLocaleString()}`
                    );
                } else if (ctx.message.animation) {
                    const fileId = ctx.message.animation.file_id;
                    const caption = ctx.message.caption || '';
                    if (!caption) {
                        adminStates.set(adminId, { mode: 'await_caption_media', pending: { kind: 'animation', fileId } });
                        await ctx.reply('✍️ Type caption for this animation, or tap Skip.', { reply_markup: { inline_keyboard: [[{ text: '⏭️ Skip', callback_data: 'skip_broadcast_caption' }]] } });
                    } else {
                        adminStates.delete(adminId);
                        const options = buildBroadcastMarkup(caption);
                        const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendAnimation(id, fileId, options); });
                        await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                        // Notify other admins
                        const captionPreview = caption.length > 100 ? caption.substring(0, 100) + '...' : caption;
                        await notifyOtherAdmins(
                            adminTelegramId,
                            `👤 Admin Action: Broadcast Sent (animation)\n\n` +
                            `📝 Caption: ${captionPreview || 'No caption'}\n` +
                            `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                            `📣 Broadcast by: ${adminName}\n` +
                            `🕐 Time: ${new Date().toLocaleString()}`
                        );
                    }
                }
            } catch (e) {
                const msg = e && e.message === 'NO_RECIPIENTS' ? '❌ No recipients found in database.' : '❌ Failed to broadcast.';
                await ctx.reply(msg, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
            }
        });

        bot.action('skip_broadcast_caption', async (ctx) => {
            const adminId = String(ctx.from.id);
            const isAdmin = await isAdminByDB(adminId);
            if (!isAdmin) return;
            const state = adminStates.get(adminId);
            if (!state || state.mode !== 'await_caption_media') return;
            adminStates.delete(adminId);
            const adminTelegramId = String(ctx.from.id);
            const adminName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || ctx.from.username || 'Admin';
            try {
                const result = await sendPendingMediaToAll(state.pending, '');
                const { success, failed, total } = result;
                await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });

                // Notify other admins
                const mediaType = state.pending?.kind || 'media';
                await notifyOtherAdmins(
                    adminTelegramId,
                    `👤 Admin Action: Broadcast Sent (${mediaType})\n\n` +
                    `📝 Caption: No caption\n` +
                    `📊 Results: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}\n` +
                    `📣 Broadcast by: ${adminName}\n` +
                    `🕐 Time: ${new Date().toLocaleString()}`
                );
            } catch {
                await ctx.reply('❌ Failed to broadcast.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
            }
        });

        // Handle bot conflicts gracefully
        // Add global error handling
        bot.catch((err, ctx) => {
            console.error('Bot error:', err);
            if (ctx) {
                ctx.reply('❌ An error occurred. Please try again.').catch(() => { });
            }
        });

        bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => { });

        // Add retry logic for bot conflicts and keep-alive
        const startBot = async (retries = 3) => {
            try {
                const me = await bot.telegram.getMe();
                console.log(`🤖 Starting Telegram bot @${me.username}`);
                await bot.launch();
                console.log('✅ Telegram bot started with long polling');

                // Add keep-alive mechanism
                setInterval(async () => {
                    try {
                        await bot.telegram.getMe();
                        console.log('💓 Bot heartbeat - still alive');
                    } catch (err) {
                        console.error('💔 Bot heartbeat failed:', err.message);
                        // Try to restart the bot
                        try {
                            await bot.stop();
                            console.log('🔄 Restarting bot...');
                            await bot.launch();
                            console.log('✅ Bot restarted successfully');
                        } catch (restartErr) {
                            console.error('❌ Failed to restart bot:', restartErr);
                        }
                    }
                }, 300000); // Check every 5 minutes

            } catch (err) {
                if (err.code === 409 && retries > 0) {
                    console.log(`⚠️ Bot conflict detected, retrying in 10 seconds... (${retries} retries left)`);
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    return startBot(retries - 1);
                } else if (err.code === 409 && retries === 0) {
                    console.log('⚠️ Bot conflict persists after all retries. Bot may already be running elsewhere.');
                    console.log('⚠️ This is normal if you have multiple bot instances or the bot is already running.');
                    return;
                }
                console.error('❌ Failed to start Telegram bot:', err);
            }
        };

        startBot();

        // Daily Admin Achievement Notification
        setupDailyAdminNotifications(bot);

        // Add process error handlers
        process.on('uncaughtException', (err) => {
            console.error('Uncaught Exception:', err);
            // Don't exit, just log the error
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            // Don't exit, just log the error
        });

        process.once('SIGINT', () => {
            console.log('🛑 Received SIGINT, stopping bot...');
            bot.stop('SIGINT');
        });

        process.once('SIGTERM', () => {
            console.log('🛑 Received SIGTERM, stopping bot...');
            bot.stop('SIGTERM');
        });
    } catch { }
}

// Helper function to get weekly stats (accessible to both command handlers and notification system)
async function getWeeklyStats() {
    try {
        // Build last week's window (7 days ago to today)
        const todayLocalMidnight = new Date();
        todayLocalMidnight.setHours(0, 0, 0, 0);
        const end = new Date(todayLocalMidnight); // end is start of "today"
        const start = new Date(todayLocalMidnight);
        start.setDate(start.getDate() - 7); // 7 days ago

        console.log('📊 Fetching weekly stats for:', {
            start: start.toISOString(),
            end: end.toISOString()
        });

        // Get games from the week
        const weekGamesByFinished = await Game.find({
            finishedAt: { $gte: start, $lt: end },
            status: 'finished'
        }).lean();

        const weekGamesByCreated = await Game.find({
            finishedAt: { $exists: false },
            createdAt: { $gte: start, $lt: end },
            status: 'finished'
        }).lean();

        const gameMap = new Map();
        [...weekGamesByFinished, ...weekGamesByCreated].forEach(game => {
            if (!gameMap.has(game.gameId)) {
                gameMap.set(game.gameId, game);
            }
        });
        const weekGames = Array.from(gameMap.values());

        // Calculate statistics
        const totalGames = weekGames.length;
        
        const uniquePlayerIds = new Set();
        weekGames.forEach(game => {
            if (game.players && Array.isArray(game.players)) {
                game.players.forEach(player => {
                    if (player.userId) {
                        uniquePlayerIds.add(player.userId.toString());
                    }
                });
            }
        });
        const totalPlayers = uniquePlayerIds.size;

        const totalRevenue = weekGames.reduce((sum, game) => sum + (game.systemCut || 0), 0);
        const totalPrizes = weekGames.reduce((sum, game) => sum + (game.totalPrizes || 0), 0);

        const weekDeposits = await Transaction.find({
            type: 'deposit',
            createdAt: { $gte: start, $lt: end },
            status: { $ne: 'failed' }
        }).lean();
        const totalDeposits = weekDeposits.reduce((sum, t) => sum + (t.amount || 0), 0);

        const newUsers = await User.find({
            registrationDate: { $gte: start, $lt: end },
            isRegistered: true
        }).lean();
        const totalNewUsers = newUsers.length;

        const pendingWithdrawals = await Transaction.find({
            type: 'withdrawal',
            status: 'pending',
            createdAt: { $gte: start, $lt: end }
        }).lean();
        const totalPendingWithdrawals = pendingWithdrawals.length;
        const totalPendingWithdrawalAmount = pendingWithdrawals.reduce((sum, t) => sum + (t.amount || 0), 0);

        const weekWithdrawals = await Transaction.find({
            type: 'withdrawal',
            status: 'completed',
            $or: [
                { 'processedBy.processedAt': { $gte: start, $lt: end } },
                { 'processedBy.processedAt': null, updatedAt: { $gte: start, $lt: end } }
            ],
            'processedBy.adminId': { $exists: true, $ne: null }
        }).lean();

        const withdrawalsByAdmin = {};
        for (const withdrawal of weekWithdrawals) {
            if (withdrawal.processedBy && withdrawal.processedBy.adminId) {
                const adminId = withdrawal.processedBy.adminId.toString();
                if (!withdrawalsByAdmin[adminId]) {
                    withdrawalsByAdmin[adminId] = {
                        adminId: adminId,
                        adminName: withdrawal.processedBy.adminName || 'Admin',
                        adminTelegramId: withdrawal.processedBy.adminTelegramId,
                        totalAmount: 0
                    };
                }
                withdrawalsByAdmin[adminId].totalAmount += (withdrawal.amount || 0);
            }
        }

        const adminWithdrawals = Object.values(withdrawalsByAdmin)
            .sort((a, b) => b.totalAmount - a.totalAmount);

        return {
            totalGames,
            totalPlayers,
            totalRevenue,
            totalPrizes,
            totalDeposits,
            totalNewUsers,
            totalPendingWithdrawals,
            totalPendingWithdrawalAmount,
            adminWithdrawals,
            startDate: start.toISOString().split('T')[0],
            endDate: end.toISOString().split('T')[0]
        };
    } catch (error) {
        console.error('Error fetching weekly stats:', error);
        return {
            totalGames: 0,
            totalPlayers: 0,
            totalRevenue: 0,
            totalPrizes: 0,
            totalDeposits: 0,
            totalNewUsers: 0,
            totalPendingWithdrawals: 0,
            totalPendingWithdrawalAmount: 0,
            adminWithdrawals: [],
            startDate: new Date().toISOString().split('T')[0],
            endDate: new Date().toISOString().split('T')[0]
        };
    }
}

// Daily Admin Achievement Notification System
function setupDailyAdminNotifications(bot) {
    // Function to get all admin telegram IDs
    async function getAllAdminTelegramIds() {
        try {
            const admins = await User.find({
                role: { $in: ['admin', 'super_admin'] }
            }).select('telegramId').lean();

            return admins
                .map(admin => admin.telegramId)
                .filter(id => id && id.trim() !== '');
        } catch (error) {
            console.error('Error fetching admin telegram IDs:', error);
            return [];
        }
    }

    // Function to get daily statistics
    async function getDailyStats() {
        try {
            // Build yesterday's local-day window (assumes TZ is set to Africa/Addis_Ababa in env)
            const todayLocalMidnight = new Date();
            todayLocalMidnight.setHours(0, 0, 0, 0);
            const start = new Date(todayLocalMidnight); // start of local "today"
            start.setDate(start.getDate() - 1); // move to start of "yesterday"
            const end = new Date(todayLocalMidnight); // end is start of "today"

            console.log('📊 Fetching daily stats for:', {
                start: start.toISOString(),
                end: end.toISOString()
            });

            // Get today's games - check finishedAt first, fallback to createdAt
            // Games should have finishedAt set when they finish, but check both for reliability
            const todayGamesByFinished = await Game.find({
                finishedAt: { $gte: start, $lt: end },
                status: 'finished'
            }).lean();

            // Also check games that finished today but might use createdAt
            const todayGamesByCreated = await Game.find({
                finishedAt: { $exists: false },
                createdAt: { $gte: start, $lt: end },
                status: 'finished'
            }).lean();

            // Combine and deduplicate by gameId
            const gameMap = new Map();
            [...todayGamesByFinished, ...todayGamesByCreated].forEach(game => {
                if (!gameMap.has(game.gameId)) {
                    gameMap.set(game.gameId, game);
                }
            });
            const todayGames = Array.from(gameMap.values());

            console.log('📊 Found games:', todayGames.length);

            // Calculate total games
            const totalGames = todayGames.length;

            // Calculate total players (unique players across all games)
            const uniquePlayerIds = new Set();
            todayGames.forEach(game => {
                if (game.players && Array.isArray(game.players)) {
                    game.players.forEach(player => {
                        if (player.userId) {
                            uniquePlayerIds.add(player.userId.toString());
                        }
                    });
                }
            });
            const totalPlayers = uniquePlayerIds.size;

            // Calculate total system revenue (systemCut)
            const totalRevenue = todayGames.reduce((sum, game) => {
                return sum + (game.systemCut || 0);
            }, 0);

            // Calculate total prizes distributed
            const totalPrizes = todayGames.reduce((sum, game) => {
                return sum + (game.totalPrizes || 0);
            }, 0);

            console.log('📊 Total revenue:', totalRevenue);

            // Get today's deposits - use createdAt as the primary date field
            // Status defaults to 'completed' but we'll include all deposits created today
            const todayDeposits = await Transaction.find({
                type: 'deposit',
                createdAt: { $gte: start, $lt: end },
                status: { $ne: 'failed' } // Exclude failed deposits
            }).lean();

            console.log('📊 Found deposits:', todayDeposits.length);

            // Calculate total deposits
            const totalDeposits = todayDeposits.reduce((sum, transaction) => {
                return sum + (transaction.amount || 0);
            }, 0);

            // Get pending withdrawal requests
            const pendingWithdrawals = await Transaction.find({
                type: 'withdrawal',
                status: 'pending',
                createdAt: { $gte: start, $lt: end }
            }).lean();
            const totalPendingWithdrawals = pendingWithdrawals.length;
            const totalPendingWithdrawalAmount = pendingWithdrawals.reduce((sum, t) => sum + (t.amount || 0), 0);

            // Get new users registered
            const newUsers = await User.find({
                registrationDate: { $gte: start, $lt: end },
                isRegistered: true
            }).lean();
            const totalNewUsers = newUsers.length;

            // Get active users (users who played at least one game)
            const activeUsers = uniquePlayerIds.size; // Already calculated above

            // Get today's withdrawal approvals by admin
            const todayWithdrawals = await Transaction.find({
                type: 'withdrawal',
                status: 'completed',
                $or: [
                    { 'processedBy.processedAt': { $gte: start, $lt: end } },
                    // Fallback in case processedAt was not saved properly; use updatedAt window
                    { 'processedBy.processedAt': null, updatedAt: { $gte: start, $lt: end } }
                ],
                'processedBy.adminId': { $exists: true, $ne: null }
            }).lean();

            // Group withdrawals by admin
            const withdrawalsByAdmin = {};
            for (const withdrawal of todayWithdrawals) {
                if (withdrawal.processedBy && withdrawal.processedBy.adminId) {
                    const adminId = withdrawal.processedBy.adminId.toString();
                    if (!withdrawalsByAdmin[adminId]) {
                        withdrawalsByAdmin[adminId] = {
                            adminId: adminId,
                            adminName: withdrawal.processedBy.adminName || 'Admin',
                            adminTelegramId: withdrawal.processedBy.adminTelegramId,
                            totalAmount: 0
                        };
                    }
                    withdrawalsByAdmin[adminId].totalAmount += (withdrawal.amount || 0);
                }
            }

            // Convert to array and sort by amount (descending)
            const adminWithdrawals = Object.values(withdrawalsByAdmin)
                .sort((a, b) => b.totalAmount - a.totalAmount);

            return {
                totalGames,
                totalPlayers,
                totalRevenue,
                totalPrizes,
                totalDeposits,
                totalNewUsers,
                activeUsers,
                totalPendingWithdrawals,
                totalPendingWithdrawalAmount,
                adminWithdrawals,
                // Display the local date for the day being reported (yesterday)
                date: start.toISOString().split('T')[0] // Format: YYYY-MM-DD
            };
        } catch (error) {
            console.error('Error fetching daily stats:', error);
            return {
                totalGames: 0,
                totalPlayers: 0,
                totalRevenue: 0,
                totalPrizes: 0,
                totalDeposits: 0,
                totalNewUsers: 0,
                activeUsers: 0,
                totalPendingWithdrawals: 0,
                totalPendingWithdrawalAmount: 0,
                adminWithdrawals: [],
                date: new Date().toISOString().split('T')[0]
            };
        }
    }

    // Function to format and send daily notification
    async function sendDailyNotification() {
        try {
            console.log('📊 Preparing daily admin achievement notification...');

            // Get all admin telegram IDs
            const adminIds = await getAllAdminTelegramIds();
            if (adminIds.length === 0) {
                console.log('⚠️ No admin users found. Skipping daily notification.');
                return;
            }

            // Get daily statistics
            const stats = await getDailyStats();

            // Format date for display
            const dateObj = new Date(stats.date);
            const formattedDate = dateObj.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            // Create appreciation messages (rotating)
            const appreciationMessages = [
                "🎉 Great work today! Your platform continues to grow! 🎉",
                "🌟 Excellent performance! Keep up the amazing work! 🌟",
                "💪 Outstanding results! You're building something incredible! 💪",
                "🚀 Fantastic progress! The platform is thriving! 🚀",
                "✨ Impressive achievements! Keep pushing forward! ✨",
                "🏆 Congratulations on another successful day! 🏆"
            ];
            const randomAppreciation = appreciationMessages[Math.floor(Math.random() * appreciationMessages.length)];

            // Build admin withdrawals section
            let adminWithdrawalsSection = '';
            if (stats.adminWithdrawals && stats.adminWithdrawals.length > 0) {
                adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n';
                for (const admin of stats.adminWithdrawals) {
                    adminWithdrawalsSection += `👤 *${admin.adminName}:*\n   💰 ETB ${admin.totalAmount.toLocaleString()}\n\n`;
                }
            } else {
                adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n   No withdrawals approved today.\n\n';
            }

            // Format the message
            const message = `📊 *Daily Achievement Report*
${formattedDate}

━━━━━━━━━━━━━━━━━━━━
📈 *Today's Statistics:*
━━━━━━━━━━━━━━━━━━━━

🎮 *Total Games:* ${stats.totalGames.toLocaleString()}
👥 *Total Players:* ${stats.totalPlayers.toLocaleString()}
💰 *System Revenue:* ${stats.totalRevenue.toLocaleString()} ETB
🏆 *Total Prizes:* ${stats.totalPrizes.toLocaleString()} ETB
💳 *Total Deposits:* ${stats.totalDeposits.toLocaleString()} ETB
👤 *New Users:* ${stats.totalNewUsers.toLocaleString()}
🔄 *Active Users:* ${stats.activeUsers.toLocaleString()}
⏳ *Pending Withdrawals:* ${stats.totalPendingWithdrawals} (${stats.totalPendingWithdrawalAmount.toLocaleString()} ETB)
${adminWithdrawalsSection}━━━━━━━━━━━━━━━━━━━━
${randomAppreciation}

📊 *Breakdown:*
• Games Played: ${stats.totalGames}
• Unique Players: ${stats.totalPlayers}
• Revenue Generated: ${stats.totalRevenue.toLocaleString()} ETB
• Prizes Distributed: ${stats.totalPrizes.toLocaleString()} ETB
• Deposits Received: ${stats.totalDeposits.toLocaleString()} ETB
• New Registrations: ${stats.totalNewUsers}
• Active Players: ${stats.activeUsers}
• Pending Withdrawals: ${stats.totalPendingWithdrawals} (${stats.totalPendingWithdrawalAmount.toLocaleString()} ETB)

Thank you for your dedication! 🙏`;

            // Send message to all admins
            let successCount = 0;
            let failCount = 0;

            for (const telegramId of adminIds) {
                try {
                    await bot.telegram.sendMessage(telegramId, message, {
                        parse_mode: 'Markdown'
                    });
                    successCount++;
                    console.log(`✅ Daily notification sent to admin: ${telegramId}`);
                } catch (error) {
                    failCount++;
                    console.error(`❌ Failed to send notification to ${telegramId}:`, error.message);
                    // If user blocked the bot or chat not found, continue
                    if (error.code === 403 || error.code === 400) {
                        console.log(`   Skipping admin ${telegramId} (bot not started or blocked)`);
                    }
                }
            }

            console.log(`📊 Daily notification summary: ${successCount} sent, ${failCount} failed`);
        } catch (error) {
            console.error('❌ Error sending daily notification:', error);
        }
    }

    // Function to calculate milliseconds until next 9 AM
    function getMsUntil9AM() {
        const now = new Date();
        const next9AM = new Date(now);
        next9AM.setHours(9, 0, 0, 0); // Set to 9 AM today
        
        // If it's already past 9 AM today, schedule for tomorrow 9 AM
        if (now.getTime() >= next9AM.getTime()) {
            next9AM.setDate(next9AM.getDate() + 1);
        }
        
        return next9AM.getTime() - now.getTime();
    }


    // Function to format and send weekly notification
    async function sendWeeklyNotification() {
        try {
            console.log('📊 Preparing weekly admin achievement notification...');

            const adminIds = await getAllAdminTelegramIds();
            if (adminIds.length === 0) {
                console.log('⚠️ No admin users found. Skipping weekly notification.');
                return;
            }

            const stats = await getWeeklyStats();

            const startDateObj = new Date(stats.startDate);
            const endDateObj = new Date(stats.endDate);
            const formattedStartDate = startDateObj.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
            });
            const formattedEndDate = endDateObj.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            const appreciationMessages = [
                "🎉 Outstanding week! Your platform is thriving! 🎉",
                "🌟 Incredible performance this week! Keep it up! 🌟",
                "💪 Amazing results! You're building something special! 💪",
                "🚀 Phenomenal progress! The platform is growing strong! 🚀",
                "✨ Exceptional achievements! Keep pushing forward! ✨",
                "🏆 Congratulations on a fantastic week! 🏆"
            ];
            const randomAppreciation = appreciationMessages[Math.floor(Math.random() * appreciationMessages.length)];

            let adminWithdrawalsSection = '';
            if (stats.adminWithdrawals && stats.adminWithdrawals.length > 0) {
                adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n';
                for (const admin of stats.adminWithdrawals) {
                    adminWithdrawalsSection += `👤 *${admin.adminName}:*\n   💰 ETB ${admin.totalAmount.toLocaleString()}\n\n`;
                }
            } else {
                adminWithdrawalsSection = '\n━━━━━━━━━━━━━━━━━━━━\n💸 *Admin Withdrawal Approvals:*\n━━━━━━━━━━━━━━━━━━━━\n\n   No withdrawals approved this week.\n\n';
            }

            const message = `📊 *Weekly Achievement Report*
${formattedStartDate} - ${formattedEndDate}

━━━━━━━━━━━━━━━━━━━━
📈 *This Week's Statistics:*
━━━━━━━━━━━━━━━━━━━━

🎮 *Total Games:* ${stats.totalGames.toLocaleString()}
👥 *Total Players:* ${stats.totalPlayers.toLocaleString()}
💰 *System Revenue:* ${stats.totalRevenue.toLocaleString()} ETB
🏆 *Total Prizes:* ${stats.totalPrizes.toLocaleString()} ETB
💳 *Total Deposits:* ${stats.totalDeposits.toLocaleString()} ETB
👤 *New Users:* ${stats.totalNewUsers.toLocaleString()}
⏳ *Pending Withdrawals:* ${stats.totalPendingWithdrawals} (${stats.totalPendingWithdrawalAmount.toLocaleString()} ETB)
${adminWithdrawalsSection}━━━━━━━━━━━━━━━━━━━━
${randomAppreciation}

📊 *Weekly Breakdown:*
• Games Played: ${stats.totalGames}
• Unique Players: ${stats.totalPlayers}
• Revenue Generated: ${stats.totalRevenue.toLocaleString()} ETB
• Prizes Distributed: ${stats.totalPrizes.toLocaleString()} ETB
• Deposits Received: ${stats.totalDeposits.toLocaleString()} ETB
• New Registrations: ${stats.totalNewUsers}
• Pending Withdrawals: ${stats.totalPendingWithdrawals} (${stats.totalPendingWithdrawalAmount.toLocaleString()} ETB)

Thank you for your dedication! 🙏`;

            let successCount = 0;
            let failCount = 0;

            for (const telegramId of adminIds) {
                try {
                    await bot.telegram.sendMessage(telegramId, message, {
                        parse_mode: 'Markdown'
                    });
                    successCount++;
                    console.log(`✅ Weekly notification sent to admin: ${telegramId}`);
                } catch (error) {
                    failCount++;
                    console.error(`❌ Failed to send weekly notification to ${telegramId}:`, error.message);
                    if (error.code === 403 || error.code === 400) {
                        console.log(`   Skipping admin ${telegramId} (bot not started or blocked)`);
                    }
                }
            }

            console.log(`📊 Weekly notification summary: ${successCount} sent, ${failCount} failed`);
        } catch (error) {
            console.error('❌ Error sending weekly notification:', error);
        }
    }

    // Schedule daily notification
    function scheduleNextNotification() {
        const msUntil9AM = getMsUntil9AM();
        const oneDay = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

        console.log(`⏰ Next daily notification scheduled in ${Math.round(msUntil9AM / 1000 / 60)} minutes (at 9 AM)`);

        // Schedule first notification at 9 AM
        setTimeout(() => {
            sendDailyNotification();

            // Then schedule recurring daily notifications every 24 hours
            setInterval(() => {
                sendDailyNotification();
            }, oneDay);
        }, msUntil9AM);
    }

    // Schedule weekly notification (every Monday at 9 AM)
    function scheduleWeeklyNotification() {
        const now = new Date();
        const nextMonday = new Date(now);
        
        // Find next Monday
        const daysUntilMonday = (8 - now.getDay()) % 7; // 0 = Sunday, 1 = Monday, etc.
        if (daysUntilMonday === 0 && now.getHours() >= 9) {
            // If it's Monday and past 9 AM, schedule for next Monday
            nextMonday.setDate(now.getDate() + 7);
        } else {
            nextMonday.setDate(now.getDate() + (daysUntilMonday || 7));
        }
        
        nextMonday.setHours(9, 0, 0, 0);
        const msUntilMonday = nextMonday.getTime() - now.getTime();
        const oneWeek = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

        console.log(`⏰ Next weekly notification scheduled in ${Math.round(msUntilMonday / 1000 / 60 / 60)} hours (next Monday at 9 AM)`);

        setTimeout(() => {
            sendWeeklyNotification();

            // Then schedule recurring weekly notifications every 7 days
            setInterval(() => {
                sendWeeklyNotification();
            }, oneWeek);
        }, msUntilMonday);
    }

    // Start scheduling
    console.log('📅 Daily admin achievement notification system initialized');
    scheduleNextNotification();
    console.log('📅 Weekly admin achievement notification system initialized');
    scheduleWeeklyNotification();
}

module.exports = { startTelegramBot };

// Allow running this file directly via PM2/node
if (require.main === module) {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const WEBAPP_URL = process.env.WEBAPP_URL || 'https://fikirbingo.com';
    try {
        startTelegramBot({ BOT_TOKEN, WEBAPP_URL });
        if (typeof process.send === 'function') {
            process.send('ready');
        }
    } catch (e) {
        console.error('Bot launcher error:', e);
        process.exit(1);
    }
}
