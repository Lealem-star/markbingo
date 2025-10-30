const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const UserService = require('../services/userService');
const WalletService = require('../services/walletService');
const Game = require('../models/Game');

function startTelegramBot({ BOT_TOKEN, WEBAPP_URL }) {
    try {
        const { Telegraf } = require('telegraf');
        if (!BOT_TOKEN) {
            console.warn('⚠️ BOT_TOKEN not set. Telegram bot is disabled. Create a .env with BOT_TOKEN=...');
            return;
        }

        const bot = new Telegraf(BOT_TOKEN);
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
                    { command: 'balance', description: 'Balance' },
                    { command: 'support', description: 'Contact Support' },
                    { command: 'instruction', description: 'How to Play' }
                ]);

                if (isHttpsWebApp) {
                    await bot.telegram.setChatMenuButton({
                        menu_button: { type: 'web_app', text: 'Play', web_app: { url: webAppUrl } }
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
            if (typeof text !== 'string') return null;
            const patterns = [/ETB\s*([0-9]+(?:\.[0-9]{1,2})?)/i, /(\d+(?:\.\d{1,2})?)\s*ETB/i, /(\d+(?:\.\d{1,2})?)\s*ብር/i, /(\d+(?:\.\d{1,2})?)/i];
            let amount = null;
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match) {
                    amount = Number(match[1]);
                    if (amount >= 50) break;
                }
            }
            if (!amount || amount < 50) return null;
            const whenMatch = text.match(/on\s+([0-9]{2}\/[0-9]{2}\/[0-9]{4})\s+at\s+([0-9]{2}:[0-9]{2}:[0-9]{2})/i);
            const refMatch = text.match(/id=([A-Z0-9]+)/i) || text.match(/ref[:\s]*([A-Z0-9]+)/i);
            return { amount, when: whenMatch ? `${whenMatch[1]} ${whenMatch[2]}` : null, ref: refMatch ? refMatch[1] : null, type: text.toLowerCase().includes('telebirr') ? 'telebirr' : text.toLowerCase().includes('commercial') ? 'commercial' : text.toLowerCase().includes('cbe') ? 'cbe' : 'unknown' };
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
                                    `🎉 Great news! Someone joined Love Bingo using your invite link!`
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
                    const regText = '👋 Welcome to Love Bingo!\n\n📝 Please complete registration to continue.\n\n📱 Tap "Share Contact" below to provide your phone number.';
                    const photoPath = path.join(__dirname, '..', 'static', 'lb.png');
                    const photo = fs.existsSync(photoPath) ? { source: fs.createReadStream(photoPath) } : (WEBAPP_URL || '').replace(/\/$/, '') + '/lb.png';
                    return ctx.replyWithPhoto(photo, { caption: regText, reply_markup: regKeyboard.reply_markup });
                }
                const welcomeText = `👋 Welcome to Love Bingo! Choose an Option below.`;
                const keyboard = { reply_markup: { inline_keyboard: [[{ text: '🎮 Play', callback_data: 'play' }], [{ text: '💵 Check Balance', callback_data: 'balance' }, { text: '💰 Deposit', callback_data: 'deposit' }], [{ text: '☎️ Contact Support', callback_data: 'support' }, { text: '📖 Instruction', callback_data: 'instruction' }], [{ text: '🤑 Withdraw', callback_data: 'withdraw' }, { text: '🔗 Invite', callback_data: 'invite' }]] } };
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
            const keyboard = { reply_markup: { inline_keyboard: [adminOpen, [{ text: '📣 Broadcast', callback_data: 'admin_broadcast' }]] } };

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
                const User = require('../models/User');
                const user = await User.findOneAndUpdate({ telegramId: String(targetId) }, { $set: { role: 'admin' } }, { new: true });
                if (!user) return ctx.reply('User not found.');
                return ctx.reply(`✅ Promoted ${targetId} to admin.`);
            } catch { return ctx.reply('Failed to promote.'); }
        });

        bot.command('demote', async (ctx) => {
            if (!(await ensureAdmin(ctx))) return;
            const parts = (ctx.message.text || '').trim().split(/\s+/);
            const targetId = parts[1];
            if (!targetId) return ctx.reply('Usage: /demote <telegramId>');
            try {
                const User = require('../models/User');
                const user = await User.findOneAndUpdate({ telegramId: String(targetId) }, { $set: { role: 'user' } }, { new: true });
                if (!user) return ctx.reply('User not found.');
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
                    const regText = '👋 Welcome to Love Bingo!\n\n📝 Please complete registration to continue.\n\n📱 Tap "Share Contact" below to provide your phone number.';
                    return ctx.reply(regText, regKeyboard);
                }

                // Registered user - show web app button
                if (isHttpsWebApp) {
                    const keyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🎮 Open Game', web_app: { url: webAppUrl } }],
                                [{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]
                            ]
                        }
                    };
                    return ctx.reply('🎮 Ready to play Love Bingo!', keyboard);
                } else {
                    // Fallback if no HTTPS web app URL
                    const keyboard = { reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] } };
                    return ctx.reply('🎮 To play Love Bingo, please use our web app:\n\n' + webAppUrl, keyboard);
                }
            } catch {
                return ctx.reply('❌ Database unavailable. Please try again later.');
            }
        });

        bot.command('balance', async (ctx) => {
            try {
                const userId = String(ctx.from.id);
                const userData = await UserService.getUserWithWallet(userId);
                if (!userData || !userData.wallet) {
                    return ctx.reply('❌ Wallet not found. Please try again later.');
                }
                const w = userData.wallet;
                const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
                if (isHttpsWebApp) keyboard.inline_keyboard.unshift([{ text: '🌐 Open Web App', web_app: { url: webAppUrl } }]);
                ctx.reply(`💵 Your Wallet Balance:\n\n💰 Main Wallet: ETB ${w.main.toFixed(2)}\n🎮 Play Balance: ETB ${w.play.toFixed(2)}\n🪙 Coins: ${w.coins.toFixed(0)}`, { reply_markup: keyboard });
            } catch (error) {
                console.error('Balance check error:', error);
                ctx.reply('❌ Error checking balance. Please try again.');
            }
        });

        bot.command('deposit', async (ctx) => {
            ctx.reply('💰 Enter the amount you want to deposit, starting from 50 Birr.');
        });

        bot.command('support', (ctx) => {
            ctx.reply('☎️ Contact Support:\n\n📞 For payment issues:\n@haset_life\n@Ipsychic\n\n💬 For general support:\n@haset_life\n@Ipsychic\n\n⏰ Support hours:\n24/7 available', { reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] } });
        });

        bot.command('instruction', (ctx) => {
            const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
            if (isHttpsWebApp) keyboard.inline_keyboard.unshift([{ text: '🎮 Start Playing', web_app: { url: webAppUrl } }]);
            ctx.reply('📖 How to Play Love Bingo:\n\n1️⃣ Select a bingo card\n2️⃣ Wait for numbers to be called\n3️⃣ Mark numbers on your card\n4️⃣ Call "BINGO!" when you win\n\n🎯 Win by getting 5 in a row (horizontal, vertical, or diagonal)\n\n💰 Prizes are shared among all winners!', { reply_markup: keyboard });
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
            const keyboard = { reply_markup: { inline_keyboard: [adminOpen, [{ text: '📣 Broadcast', callback_data: 'admin_broadcast' }]] } };
            await ctx.editMessageText(adminText, keyboard).catch(() => ctx.reply(adminText, keyboard));
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
            if (isHttpsWebApp) { kb.inline_keyboard.push([{ text: 'Play', web_app: { url: webAppUrl } }]); }
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
                            [{ text: '🎮 Play', web_app: { url: webAppUrl } }],
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
                const userId = String(ctx.from.id);
                const userData = await UserService.getUserWithWallet(userId);
                if (!userData || !userData.wallet) { return ctx.reply('❌ Wallet not found. Please try again later.'); }
                const w = userData.wallet;
                ctx.answerCbQuery('💵 Balance checked');
                const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
                if (isHttpsWebApp) keyboard.inline_keyboard.unshift([{ text: '🌐 Open Web App', web_app: { url: webAppUrl } }]);
                ctx.reply(`💵 Your Wallet Balance:\n\n💰 Main Wallet: ETB ${w.main.toFixed(2)}\n🎮 Play Balance: ETB ${w.play.toFixed(2)}\n🪙 Coins: ${w.coins.toFixed(0)}`, { reply_markup: keyboard });
            } catch (error) {
                console.error('Balance check error:', error);
                ctx.reply('❌ Error checking balance. Please try again.');
            }
        });

        bot.action('deposit', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            ctx.answerCbQuery('💰 Deposit amount...');
            ctx.reply('💰 Enter the amount you want to deposit, starting from 50 Birr.');
        });

        bot.action('support', (ctx) => {
            ctx.answerCbQuery('☎️ Support info...');
            ctx.reply('☎️ Contact Support:\n\n📞 For payment issues:\n@haset_life\n@Ipsychic\n\n💬 For general support:\n@haset_life\n@Ipsychic\n\n⏰ Support hours:\n24/7 available', { reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] } });
        });

        bot.action('instruction', (ctx) => {
            ctx.answerCbQuery('📖 Instructions...');
            const keyboard = { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] };
            if (isHttpsWebApp) keyboard.inline_keyboard.unshift([{ text: '🎮 Start Playing', web_app: { url: webAppUrl } }]);
            ctx.reply('📖 How to Play Love Bingo:\n\n1️⃣ Select a bingo card\n2️⃣ Wait for numbers to be called\n3️⃣ Mark numbers on your card\n4️⃣ Call "BINGO!" when you win\n\n🎯 Win by getting 5 in a row (horizontal, vertical, or diagonal)\n\n💰 Prizes are shared among all winners!', { reply_markup: keyboard });
        });


        bot.action('withdraw', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            ctx.answerCbQuery('🤑 Withdraw info...');

            try {
                const userId = String(ctx.from.id);
                const userData = await UserService.getUserWithWallet(userId);
                if (!userData || !userData.wallet) {
                    return ctx.reply('❌ Wallet not found. Please try again later.');
                }

                const w = userData.wallet;
                const keyboard = { inline_keyboard: [] };

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
                const apiBase = process.env.API_URL || 'http://localhost:3001';
                const response = await fetch(`${apiBase}/admin/internal/withdrawals/${withdrawalId}/approve`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.ok) {
                    await ctx.answerCbQuery('✅ Withdrawal approved');
                    await ctx.reply('✅ Withdrawal has been approved and processed.');
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
                const apiBase = process.env.API_URL || 'http://localhost:3001';
                const response = await fetch(`${apiBase}/admin/internal/withdrawals/${withdrawalId}/deny`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.ok) {
                    await ctx.answerCbQuery('❌ Withdrawal denied');
                    await ctx.reply('❌ Withdrawal has been denied.');
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
                const apiBase = process.env.API_URL || 'http://localhost:3001';
                const response = await fetch(`${apiBase}/sms-forwarder/approve/${verificationId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ adminId: null })
                });
                if (response.ok) {
                    await ctx.answerCbQuery('✅ Deposit approved');
                    await ctx.reply('✅ Deposit has been approved and credited.');
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
                const apiBase = process.env.API_URL || 'http://localhost:3001';
                const response = await fetch(`${apiBase}/sms-forwarder/reject/${verificationId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ adminId: null, reason: 'Denied via Telegram' })
                });
                if (response.ok) {
                    await ctx.answerCbQuery('❌ Deposit denied');
                    await ctx.reply('❌ Deposit has been denied.');
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
            keyboard.inline_keyboard.unshift([{ text: '📤 Share Link', url: `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=Join me in Love Bingo!` }]);

            // Send image with caption
            const imagePath = path.join(__dirname, '../static/lb.png');
            try {
                await ctx.replyWithPhoto(
                    { source: imagePath },
                    {
                        caption: `🔗 Invite Friends to Love Bingo!\n\n👥 Share this link with your friends:\n\n${inviteLink}`,
                        reply_markup: keyboard
                    }
                );
            } catch (error) {
                console.error('Error sending invite image:', error);
                // Fallback to text message if image fails
                ctx.reply(`🔗 Invite Friends to Love Bingo!\n\n👥 Share this link with your friends:\n\n${inviteLink}`, { reply_markup: keyboard });
            }
        });

        bot.action('back_to_menu', async (ctx) => {
            if (!(await requireRegistration(ctx))) return;
            ctx.answerCbQuery('🔙 Back to menu');
            const welcomeText = `👋 Welcome to Love Bingo! Choose an Option below.`;
            const keyboard = { reply_markup: { inline_keyboard: [[{ text: '🎮 Play', callback_data: 'play' }], [{ text: '💵 Check Balance', callback_data: 'balance' }, { text: '💰 Deposit', callback_data: 'deposit' }], [{ text: '☎️ Contact Support', callback_data: 'support' }, { text: '📖 Instruction', callback_data: 'instruction' }], [{ text: '🤑 Withdraw', callback_data: 'withdraw' }, { text: '🔗 Invite', callback_data: 'invite' }]] } };
            return ctx.editMessageText(welcomeText, keyboard);
        });

        bot.action(/^deposit_telebirr_(\d+(?:\.\d{1,2})?)$/, (ctx) => {
            const amount = ctx.match[1];
            ctx.answerCbQuery('📱 Telebirr deposit...');
            ctx.reply(`📱 Telebirr Deposit Instructions:\n\n📋 Agent Details:\n👤 Name: Meseret Tebabal\n📱 Telebirr: \`0934551781\`\n\n💡 Steps:\n1️⃣ Open your Telebirr app\n2️⃣ Select "Send Money"\n3️⃣ Enter agent number: \`0934551781\`\n4️⃣ Enter amount: ETB ${amount}\n5️⃣ Send the transaction\n6️⃣ Paste the receipt here\n\n✅ Your wallet will be credited automatically!`, { reply_markup: { inline_keyboard: [[{ text: '📋 Copy Number', callback_data: 'copy_telebirr' }], [{ text: '📱 Send Receipt', callback_data: 'send_receipt_telebirr' }], [{ text: '🔙 Back to Deposit', callback_data: 'deposit' }]] } });
        });
        bot.action(/^deposit_commercial_(\d+(?:\.\d{1,2})?)$/, (ctx) => {
            const amount = ctx.match[1];
            ctx.answerCbQuery('🏦 Commercial Bank deposit...');
            ctx.reply(`🏦 Commercial Bank Deposit Instructions:\n\n📋 Agent Details:\n👤 Name: Lealem Meseret\n🏦 Account: \`1000415847959\`\n🏛️ Bank: Commercial Bank of Ethiopia\n\n💡 Steps:\n1️⃣ Go to Commercial Bank\n2️⃣ Transfer to account: \`1000415847959\`\n3️⃣ Enter amount: ETB ${amount}\n4️⃣ Complete the transaction\n5️⃣ Send the SMS receipt here\n\n✅ Your wallet will be credited automatically!`, { reply_markup: { inline_keyboard: [[{ text: '📋 Copy Account', callback_data: 'copy_commercial' }], [{ text: '📱 Send SMS Receipt', callback_data: 'send_receipt_commercial' }], [{ text: '🔙 Back to Deposit', callback_data: 'deposit' }]] } });
        });
        bot.action(/^deposit_cbe_(\d+(?:\.\d{1,2})?)$/, (ctx) => {
            const amount = ctx.match[1];
            ctx.answerCbQuery('💳 CBE Birr deposit...');
            ctx.reply(`💳 CBE Birr Deposit Instructions:\n\n📋 Agent Details:\n👤 Name: Lealem Meseret\n💳 CBE Birr: \`0934551781\`\n🏦 Bank: Commercial Bank of Ethiopia\n\n💡 Steps:\n1️⃣ Open CBE Birr app\n2️⃣ Select "Send Money"\n3️⃣ Enter agent number: \`0934551781\`\n4️⃣ Enter amount: ETB ${amount}\n5️⃣ Send the transaction\n6️⃣ Paste the receipt here\n\n✅ Your wallet will be credited automatically!`, { reply_markup: { inline_keyboard: [[{ text: '📋 Copy Number', callback_data: 'copy_cbe' }], [{ text: '📱 Send Receipt', callback_data: 'send_receipt_cbe' }], [{ text: '🔙 Back to Deposit', callback_data: 'deposit' }]] } });
        });

        bot.action('send_receipt_telebirr', (ctx) => { ctx.answerCbQuery('📱 Ready for Telebirr receipt...'); ctx.reply('📱 Send your Telebirr transaction receipt here:\n\n💡 Just paste the full receipt message you received from Telebirr.\n\n✅ Your wallet will be credited automatically!'); });
        bot.action('send_receipt_commercial', (ctx) => { ctx.answerCbQuery('📱 Ready for Commercial Bank SMS...'); ctx.reply('📱 Send your Commercial Bank SMS receipt here:\n\n💡 Just paste the full SMS message you received from the bank.\n\n✅ Your wallet will be credited automatically!'); });
        bot.action('send_receipt_cbe', (ctx) => { ctx.answerCbQuery('📱 Ready for CBE Birr receipt...'); ctx.reply('📱 Send your CBE Birr transaction receipt here:\n\n💡 Just paste the full receipt message you received from CBE Birr.\n\n✅ Your wallet will be credited automatically!'); });

        // Copy button handlers
        bot.action('copy_telebirr', (ctx) => {
            ctx.answerCbQuery('📋 Telebirr number copied!');
            ctx.reply('📱 Telebirr Number:\n\n`0934551781`\n\n💡 Tap and hold to select, then copy!', { parse_mode: 'Markdown' });
        });
        bot.action('copy_commercial', (ctx) => {
            ctx.answerCbQuery('📋 Commercial Bank account copied!');
            ctx.reply('🏦 Commercial Bank Account:\n\n`1000415847959`\n\n💡 Tap and hold to select, then copy!', { parse_mode: 'Markdown' });
        });
        bot.action('copy_cbe', (ctx) => {
            ctx.answerCbQuery('📋 CBE Birr number copied!');
            ctx.reply('💳 CBE Birr Number:\n\n`0934551781`\n\n💡 Tap and hold to select, then copy!', { parse_mode: 'Markdown' });
        });

        bot.on('contact', async (ctx) => {
            try {
                const userId = String(ctx.from.id);
                const contact = ctx.message.contact;
                try {
                    const existing = await UserService.getUserByTelegramId(userId);
                    if (existing && (existing.isRegistered || existing.phone)) {
                        await ctx.reply('✅ You are already registered with this account.');
                        await ctx.reply('🎮 You can now continue using the menu.', { reply_markup: { remove_keyboard: true } });
                        const keyboard = { reply_markup: { inline_keyboard: [[{ text: '🎮 Play', callback_data: 'play' }], [{ text: '💵 Check Balance', callback_data: 'balance' }, { text: '💰 Deposit', callback_data: 'deposit' }], [{ text: '☎️ Contact Support', callback_data: 'support' }, { text: '📖 Instruction', callback_data: 'instruction' }], [{ text: '🤑 Withdraw', callback_data: 'withdraw' }, { text: '🔗 Invite', callback_data: 'invite' }]] } };
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

                    // Build registration message
                    const fullName = (contact.first_name || '') + (contact.last_name ? ' ' + contact.last_name : '');
                    let phoneDisplay = contact.phone_number;
                    // Format phone with + if international format
                    if (phoneDisplay && !phoneDisplay.startsWith('+')) {
                        if (phoneDisplay.startsWith('251')) {
                            phoneDisplay = '+' + phoneDisplay;
                        }
                    }

                    let message = `✅ Registration completed!\n\n📱 Phone: ${phoneDisplay}\n👤 Name: ${fullName}`;

                    if (isNewRegistration) {
                        message += `\n\n🎁 Welcome Bonus: You've been awarded 10 birr in your play wallet!\n\n🎮 You can now start playing!`;
                    } else {
                        message += `\n\n🎮 You can now start playing!`;
                    }

                    ctx.reply(message, { reply_markup: { remove_keyboard: true } });
                } catch (dbError) {
                    console.log('Database unavailable during contact update');
                    ctx.reply('✅ Registration completed!\n\n📱 Phone: ' + contact.phone_number + '\n👤 Name: ' + (contact.first_name || '') + ' ' + (contact.last_name || '') + '\n\n🎮 You can now start playing!', { reply_markup: { remove_keyboard: true } });
                }
            } catch (error) {
                console.error('Contact registration error:', error);
                ctx.reply('❌ Registration failed. Please try again.');
            }
            const keyboard = { reply_markup: { inline_keyboard: [[{ text: '🎮 Play', callback_data: 'play' }], [{ text: '💵 Check Balance', callback_data: 'balance' }, { text: '💰 Deposit', callback_data: 'deposit' }], [{ text: '☎️ Contact Support', callback_data: 'support' }, { text: '📖 Instruction', callback_data: 'instruction' }], [{ text: '🤑 Withdraw', callback_data: 'withdraw' }, { text: '🔗 Invite', callback_data: 'invite' }]] } };
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
                    try {
                        const targets = await getBroadcastTargets();
                        const options = buildBroadcastMarkup(ctx.message.text);
                        const { success, failed, total } = await sendToAll(targets, async (id) => {
                            await bot.telegram.sendMessage(id, ctx.message.text, options);
                        });
                        await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
                    } catch (error) {
                        console.error('Broadcast error:', error);
                        await ctx.reply(`❌ Failed to broadcast: ${error.message || 'Unknown error'}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
                    }
                    return;
                }

                // Handle caption for media
                if (state && state.mode === 'await_caption_media' && isAdmin) {
                    adminStates.delete(adminId);
                    try {
                        const result = await sendPendingMediaToAll(state.pending, ctx.message.text || '');
                        const { success, failed, total } = result;
                        await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
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
                    ctx.reply(`✅ ${withdrawalState.method} Number: ${number}\n\n👤 Enter the account holder's full name:\n\n💡 Example: John Doe`);
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
                        const apiBase = process.env.API_URL || 'http://localhost:3001';
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

                const amountMatch = messageText.match(/^(\d+(?:\.\d{1,2})?)$/);
                if (amountMatch) {
                    const amount = Number(amountMatch[1]);
                    if (amount >= 50) {
                        ctx.reply('💡 You can only deposit money using the options below.\n\n📋 Transfer Methods:\n1️⃣ From Telebirr to Agent Telebirr only\n2️⃣ From Commercial Bank to Agent Commercial Bank only\n3️⃣ From CBE Birr to Agent CBE Birr only\n\n🏦 Choose your preferred payment option:', { reply_markup: { inline_keyboard: [[{ text: '📱 Telebirr', callback_data: `deposit_telebirr_${amount}` }], [{ text: '🏦 Commercial Bank', callback_data: `deposit_commercial_${amount}` }], [{ text: '💳 CBE Birr', callback_data: `deposit_cbe_${amount}` }], [{ text: '❌ Cancel', callback_data: 'back_to_menu' }]] } });
                        return;
                    } else {
                        return ctx.reply('❌ Minimum deposit amount is 50 Birr. Please enter a valid amount.');
                    }
                }
                const parsed = parseReceipt(messageText);
                if (!parsed) { return ctx.reply('❌ Could not detect amount in your message.\n\n💡 Please paste the full receipt from your payment method.\n\n📋 Make sure it contains the amount (minimum ETB 50).'); }

                let user = await UserService.getUserByTelegramId(userId);
                if (!user) { user = await UserService.createOrUpdateUser(ctx.from); }

                // Send user SMS to dual verification system
                try {
                    const response = await fetch(`${process.env.API_BASE_URL || 'http://localhost:3001'}/sms-forwarder/user-sms`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: user._id,
                            message: messageText,
                            phoneNumber: user.phone
                        })
                    });

                    const result = await response.json();

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
                        }

                        return ctx.reply(`📱 SMS Received!\n\n✅ Your payment receipt has been received and is being verified.\n\n💰 Amount: ETB ${parsed.amount.toFixed(2)}\n🔄 Status: verified\n\n⏳ now you can play the game by backing to menu!`, {
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'back_to_menu' }]] }
                        });
                    } else {
                        throw new Error('Failed to process SMS');
                    }
                } catch (error) {
                    console.error('Dual SMS verification error:', error);
                    return ctx.reply('❌ Failed to process your SMS. Please try again or contact support.');
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
                    }
                } else if (ctx.message.audio) {
                    const fileId = ctx.message.audio.file_id;
                    const options = buildBroadcastMarkup('');
                    const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendAudio(id, fileId, options); });
                    await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
                } else if (ctx.message.voice) {
                    const fileId = ctx.message.voice.file_id;
                    const options = buildBroadcastMarkup('');
                    const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendVoice(id, fileId, options); });
                    await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
                } else if (ctx.message.sticker) {
                    const fileId = ctx.message.sticker.file_id;
                    const { success, failed, total } = await sendToAll(targets, async (id) => { await bot.telegram.sendSticker(id, fileId); });
                    await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
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
            try {
                const result = await sendPendingMediaToAll(state.pending, '');
                const { success, failed, total } = result;
                await ctx.reply(`📣 Broadcast result: ✅ ${success} / ${total} delivered${failed ? `, ❌ ${failed} failed` : ''}.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'back_to_admin' }]] } });
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

module.exports = { startTelegramBot };
