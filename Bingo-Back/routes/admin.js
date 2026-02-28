const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Transaction = require('../models/Transaction');
const Game = require('../models/Game');
const Post = require('../models/Post');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletService = require('../services/walletService');
const InviteService = require('../services/inviteService');
const { authMiddleware } = require('./auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const uploadDir = path.join(__dirname, '..', 'uploads');
            console.log('Upload directory:', uploadDir);

            if (!fs.existsSync(uploadDir)) {
                console.log('Creating upload directory:', uploadDir);
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            // Check if directory is writable
            fs.access(uploadDir, fs.constants.W_OK, (err) => {
                if (err) {
                    console.error('Upload directory is not writable:', err);
                    cb(new Error('Upload directory is not writable'));
                } else {
                    console.log('Upload directory is writable');
                    cb(null, uploadDir);
                }
            });
        } catch (error) {
            console.error('Error setting up upload directory:', error);
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
        console.log('Generated filename:', filename);
        cb(null, filename);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only images and videos are allowed'));
        }
    }
});

// Admin middleware
function adminMiddleware(req, res, next) {
    console.log('Admin middleware check:', {
        method: req.method,
        path: req.path,
        headers: {
            authorization: req.headers.authorization ? 'Present' : 'Missing',
            'x-session': req.headers['x-session'] ? 'Present' : 'Missing'
        }
    });

    // For now, we'll use the same auth middleware
    // In production, you might want to add additional admin role checks
    return authMiddleware(req, res, (err) => {
        if (err) {
            console.error('Admin middleware auth error:', err);
            return res.status(401).json({ error: 'UNAUTHORIZED' });
        }

        console.log('Admin middleware passed, userId:', req.userId);
        next();
    });
}

function sanitizeWallet(walletDoc) {
    if (!walletDoc) {
        return {
            main: 0,
            play: 0,
            balance: 0,
            totalDeposited: 0,
            lastDepositDate: null
        };
    }

    const balanceValue = walletDoc.balance != null
        ? walletDoc.balance
        : (walletDoc.main || 0) + (walletDoc.play || 0);

    return {
        main: walletDoc.main || 0,
        play: walletDoc.play || 0,
        balance: balanceValue,
        totalDeposited: walletDoc.totalDeposited || 0,
        lastDepositDate: walletDoc.lastDepositDate || null
    };
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Shared bot-detection helpers (keep bot logic consistent across all stats)
function isBotTelegramId(telegramId) {
    if (!telegramId) {
        return false;
    }

    const idStr = String(telegramId);
    const num = parseInt(idStr, 10);

    // Bots have telegramId in range 9000000000-9000000020 (9 billion range, 20 bots)
    // or contain "bot_user_" pattern
    const inBotRange = !Number.isNaN(num) && num >= 9000000000 && num <= 9000000020;
    return inBotRange || idStr.includes('bot_user_');
}

function getHumanPlayerIds(players) {
    const humanIds = [];

    if (!Array.isArray(players)) {
        return humanIds;
    }

    players.forEach((p) => {
        if (!p || !p.userId) {
            return;
        }

        const user = p.userId;
        const telegramId = user.telegramId;

        if (!isBotTelegramId(telegramId)) {
            const id = user._id ? String(user._id) : null;
            if (id) {
                humanIds.push(id);
            }
        }
    });

    return humanIds;
}

async function getAdminDetails(req) {
    let adminId = null;
    let adminTelegramId = null;
    let adminName = 'Admin';

    if (!req.userId) {
        return {
            adminId,
            adminTelegramId,
            adminName,
            processedAt: new Date()
        };
    }

    try {
        const adminUser = await User.findById(req.userId);
        if (adminUser) {
            adminId = adminUser._id;
            adminTelegramId = adminUser.telegramId || null;
            adminName = `${adminUser.firstName || ''} ${adminUser.lastName || ''}`.trim() || adminUser.username || 'Admin';
        }
    } catch (error) {
        console.error('Error fetching admin user:', error);
    }

    return {
        adminId,
        adminTelegramId,
        adminName,
        processedAt: new Date()
    };
}

// GET /admin/users/search
router.get('/users/search', adminMiddleware, async (req, res) => {
    try {
        const rawQuery = (req.query.query || '').trim();

        if (!rawQuery) {
            return res.status(400).json({ error: 'QUERY_REQUIRED' });
        }

        const escapedQuery = escapeRegExp(rawQuery);
        const regex = new RegExp(escapedQuery, 'i');
        const conditions = [
            { firstName: regex },
            { lastName: regex },
            { username: regex },
            { phone: regex }
        ];

        if (/^\d+$/.test(rawQuery)) {
            conditions.push({ telegramId: regex });
        }

        const users = await User.find({ $or: conditions })
            .sort({ lastActive: -1 })
            .limit(20)
            .lean();

        if (users.length === 0) {
            return res.json({ users: [] });
        }

        const userIds = users.map((user) => user._id);
        const wallets = await Wallet.find({ userId: { $in: userIds } }).lean();
        const walletMap = new Map(wallets.map((wallet) => [String(wallet.userId), sanitizeWallet(wallet)]));

        const results = users.map((user) => ({
            id: String(user._id),
            telegramId: user.telegramId,
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
            phone: user.phone,
            isRegistered: user.isRegistered,
            role: user.role || 'user',
            lastActive: user.lastActive,
            totalInvites: user.totalInvites || 0,
            inviteRewards: user.inviteRewards || 0,
            wallet: walletMap.get(String(user._id)) || sanitizeWallet(null)
        }));

        res.json({ users: results });
    } catch (error) {
        console.error('Admin user search error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// POST /admin/users/:id/wallet-adjust
router.post('/users/:id/wallet-adjust', adminMiddleware, async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ error: 'USER_ID_REQUIRED' });
    }

    const parseDelta = (value, { allowFloat = true } = {}) => {
        if (value === undefined || value === null || value === '') {
            return 0;
        }
        const num = Number(value);
        if (!Number.isFinite(num)) {
            return null;
        }
        if (!allowFloat) {
            return Math.trunc(num);
        }
        return num;
    };

    try {
        const mainDelta = parseDelta(req.body?.mainDelta);
        const playDelta = parseDelta(req.body?.playDelta);
        const reason = (req.body?.reason || '').trim();

        if (mainDelta === null || playDelta === null) {
            return res.status(400).json({ error: 'INVALID_AMOUNT' });
        }

        if (mainDelta === 0 && playDelta === 0) {
            return res.status(400).json({ error: 'NO_CHANGES' });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }

        const updates = {};
        if (mainDelta !== 0) updates.main = mainDelta;
        if (playDelta !== 0) updates.play = playDelta;

        const result = await WalletService.updateBalance(user._id, updates);
        const walletAfter = await Wallet.findOne({ userId: user._id }).lean();

        const adminDetails = await getAdminDetails(req);

        const deltasSummary = [];
        if (mainDelta !== 0) deltasSummary.push(`main ${mainDelta > 0 ? '+' : ''}${mainDelta}`);
        if (playDelta !== 0) deltasSummary.push(`play ${playDelta > 0 ? '+' : ''}${playDelta}`);
        const summaryText = deltasSummary.join(', ') || 'No changes';

        const transaction = new Transaction({
            userId: user._id,
            type: 'admin_adjustment',
            amount: (mainDelta || 0) + (playDelta || 0),
            description: `Admin adjustment (${summaryText})${reason ? ` - ${reason}` : ''}`,
            status: 'completed',
            balanceBefore: result.balanceBefore,
            balanceAfter: result.balanceAfter,
            processedBy: adminDetails
        });
        await transaction.save();

        res.json({
            success: true,
            wallet: sanitizeWallet(walletAfter),
            transactionId: String(transaction._id)
        });
    } catch (error) {
        console.error('Admin wallet adjustment error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// POST /admin/withdrawals/:id/approve
router.post('/withdrawals/:id/approve', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const transaction = await Transaction.findById(id);

        if (!transaction) {
            return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
        }

        if (transaction.type !== 'withdrawal' || transaction.status !== 'pending') {
            return res.status(400).json({ error: 'INVALID_TRANSACTION_STATUS' });
        }

        // Deduct from user's main wallet
        const result = await WalletService.processWithdrawalApproval(transaction.userId, transaction.amount);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        // Get admin info from request (set by adminMiddleware)
        let adminId = null;
        let adminTelegramId = null;
        let adminName = 'Admin';

        if (req.userId) {
            try {
                const User = require('../models/User');
                const adminUser = await User.findById(req.userId);
                if (adminUser) {
                    adminId = adminUser._id;
                    adminTelegramId = adminUser.telegramId;
                    adminName = `${adminUser.firstName || ''} ${adminUser.lastName || ''}`.trim() || adminUser.username || 'Admin';
                }
            } catch (e) {
                console.error('Error fetching admin user:', e);
            }
        }

        // Update transaction status and track admin info
        transaction.status = 'completed';
        // Set processedBy with processedAt (this is where the approval date is stored)
        if (adminId) {
            transaction.processedBy = {
                adminId: adminId,
                adminTelegramId: adminTelegramId,
                adminName: adminName,
                processedAt: new Date()
            };
        }
        await transaction.save();

        try {
            const NotificationService = require('../services/notificationService');
            await NotificationService.notifyWithdrawalApproved(transaction.userId, transaction.amount);
        } catch (_) { }

        res.json({
            success: true,
            message: 'Withdrawal approved successfully',
            transaction: {
                amount: transaction.amount,
                adminName: adminName
            }
        });
    } catch (error) {
        console.error('Withdrawal approval error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// POST /admin/withdrawals/:id/deny
router.post('/withdrawals/:id/deny', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const transaction = await Transaction.findById(id);

        if (!transaction) {
            return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
        }

        if (transaction.type !== 'withdrawal' || transaction.status !== 'pending') {
            return res.status(400).json({ error: 'INVALID_TRANSACTION_STATUS' });
        }

        // Update transaction status
        transaction.status = 'cancelled';
        transaction.processedAt = new Date();
        await transaction.save();

        try {
            const NotificationService = require('../services/notificationService');
            await NotificationService.notifyWithdrawalApproved(transaction.userId, transaction.amount);
        } catch (_) { }

        res.json({
            success: true,
            message: 'Withdrawal denied successfully'
        });
    } catch (error) {
        console.error('Withdrawal denial error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// Internal admin endpoints (no auth required for bot calls)
// POST /admin/internal/withdrawals/:id/approve
router.post('/internal/withdrawals/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { adminId, adminTelegramId, adminName } = req.body;
        const transaction = await Transaction.findById(id);

        if (!transaction) {
            return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
        }

        if (transaction.type !== 'withdrawal' || transaction.status !== 'pending') {
            return res.status(400).json({ error: 'INVALID_TRANSACTION_STATUS' });
        }

        // Deduct from user's main wallet
        const result = await WalletService.processWithdrawalApproval(transaction.userId, transaction.amount);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        // Update transaction status and track admin info
        transaction.status = 'completed';
        // Set processedBy with processedAt (this is where the approval date is stored)
        if (adminId) {
            transaction.processedBy = { 
                adminId, 
                adminTelegramId, 
                adminName, 
                processedAt: new Date() 
            };
        }
        await transaction.save();

        res.json({
            success: true,
            message: 'Withdrawal approved successfully',
            transaction: {
                amount: transaction.amount,
                adminName: adminName || 'Admin'
            }
        });
    } catch (error) {
        console.error('Internal withdrawal approval error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// POST /admin/internal/withdrawals/:id/deny
router.post('/internal/withdrawals/:id/deny', async (req, res) => {
    try {
        const { id } = req.params;
        const transaction = await Transaction.findById(id);

        if (!transaction) {
            return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
        }

        if (transaction.type !== 'withdrawal' || transaction.status !== 'pending') {
            return res.status(400).json({ error: 'INVALID_TRANSACTION_STATUS' });
        }

        // Update transaction status
        transaction.status = 'cancelled';
        transaction.processedAt = new Date();
        await transaction.save();

        res.json({
            success: true,
            message: 'Withdrawal denied successfully'
        });
    } catch (error) {
        console.error('Internal withdrawal denial error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// GET /admin/withdrawals
router.get('/withdrawals', adminMiddleware, async (req, res) => {
    try {
        const withdrawals = await Transaction.find({
            type: 'withdrawal',
            status: 'pending'
        }).sort({ createdAt: -1 });

        res.json({ withdrawals });
    } catch (error) {
        console.error('Withdrawals fetch error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// --- Admin Posts ---
router.get('/posts', adminMiddleware, async (req, res) => {
    try {
        const posts = await Post.find({}).sort({ createdAt: -1 }).lean();
        res.json({ posts });
    } catch (e) { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
});

router.post('/posts', adminMiddleware, (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            console.error('Multer error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ error: 'FILE_TOO_LARGE' });
            }
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                return res.status(400).json({ error: 'UNEXPECTED_FILE_FIELD' });
            }
            return res.status(400).json({ error: 'FILE_UPLOAD_ERROR', details: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        console.log('File upload request received:', {
            body: req.body,
            file: req.file ? {
                filename: req.file.filename,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            } : 'No file'
        });

        const { kind, caption, active } = req.body || {};

        if (!kind) {
            console.log('Missing kind field');
            return res.status(400).json({ error: 'INVALID_INPUT' });
        }

        let url = '';
        let filename = '';

        if (req.file) {
            // File upload
            filename = req.file.filename;
            url = `/uploads/${filename}`;
            console.log('File processed:', { filename, url });
        } else {
            console.log('No file uploaded');
            return res.status(400).json({ error: 'NO_FILE_UPLOADED' });
        }

        // Convert active string to boolean
        const isActive = active === 'true' || active === true;

        const post = await Post.create({
            kind,
            url,
            filename,
            caption: caption || '',
            active: isActive
        });

        console.log('Post created successfully:', post);
        res.json({ success: true, post });
    } catch (e) {
        console.error('Post creation error:', e);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

router.patch('/posts/:id', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const update = {};
        ['kind', 'url', 'caption', 'active'].forEach(k => { if (k in req.body) update[k] = req.body[k]; });
        const post = await Post.findByIdAndUpdate(id, { $set: update }, { new: true });
        if (!post) return res.status(404).json({ error: 'NOT_FOUND' });
        res.json({ success: true, post });
    } catch (e) { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
});

router.delete('/posts/:id', adminMiddleware, async (req, res) => {
    try { await Post.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
});

// --- Admin Balance (withdraw/deposit overviews) ---
router.get('/balances/withdrawals', adminMiddleware, async (req, res) => {
    try {
        const { status = 'pending' } = req.query;
        const withdrawals = await Transaction.find({ type: 'withdrawal', status })
            .sort({ createdAt: -1 })
            .populate('userId', 'firstName lastName phone telegramId')
            .lean();
        res.json({ withdrawals });
    } catch { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
});

router.get('/balances/deposits', adminMiddleware, async (req, res) => {
    try {
        const { from, to } = req.query;
        const q = { type: 'deposit' };
        if (from || to) { q.createdAt = {}; if (from) q.createdAt.$gte = new Date(from); if (to) q.createdAt.$lte = new Date(to); }
        const deposits = await Transaction.find(q)
            .sort({ createdAt: -1 })
            .populate('userId', 'firstName lastName phone telegramId')
            .lean();
        res.json({ deposits });
    } catch { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
});

// --- Admin Balance Management ---
router.post('/balances/deposits/:id/approve', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const transaction = await Transaction.findById(id);

        if (!transaction) {
            return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
        }

        if (transaction.type !== 'deposit' || transaction.status !== 'pending') {
            return res.status(400).json({ error: 'INVALID_TRANSACTION_STATUS' });
        }

        // Add to user's main wallet
        const result = await WalletService.processDepositApproval(transaction.userId, transaction.amount);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        // Update transaction status
        transaction.status = 'completed';
        transaction.processedAt = new Date();
        await transaction.save();

        res.json({
            success: true,
            message: 'Deposit approved successfully'
        });
    } catch (error) {
        console.error('Deposit approval error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

router.post('/balances/deposits/:id/deny', adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const transaction = await Transaction.findById(id);

        if (!transaction) {
            return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
        }

        if (transaction.type !== 'deposit' || transaction.status !== 'pending') {
            return res.status(400).json({ error: 'INVALID_TRANSACTION_STATUS' });
        }

        // Update transaction status
        transaction.status = 'cancelled';
        transaction.processedAt = new Date();
        await transaction.save();

        try {
            const NotificationService = require('../services/notificationService');
            await NotificationService.notifyDepositDenied(transaction.userId, transaction.amount, transaction._id, req.body?.reason);
        } catch (_) { }

        res.json({
            success: true,
            message: 'Deposit denied successfully'
        });
    } catch (error) {
        console.error('Deposit denial error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// --- Admin Statistics ---
router.get('/stats/today', adminMiddleware, async (req, res) => {
    try {
        // Use server timezone (Africa/Addis_Ababa) for consistent "today" calculation
        // Server TZ is set in ecosystem.config.js, so new Date() uses local timezone
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        
        const games = await Game.find(
            { finishedAt: { $gte: start, $lte: end } },
            { systemCut: 1, players: 1, winners: 1 }
        )
            .populate('players.userId winners.userId', 'telegramId')
            .lean();
        
        // Calculate total players (unique real users) and system revenue,
        // excluding games that only have bot players.
        // Also track how many games (with at least one real user) were won by bots.
        const uniquePlayerIds = new Set();
        let systemCut = 0;
        let botGamesWonFromRealGames = 0;

        games.forEach((game) => {
            const humanIds = getHumanPlayerIds(game.players);

            // Skip games that have only bots (no real players at all)
            if (humanIds.length === 0) {
                return;
            }

            humanIds.forEach((id) => uniquePlayerIds.add(id));
            systemCut += game.systemCut || 0;

            // For games that have at least one real player, count games where any bot won
            if (Array.isArray(game.winners) && game.winners.length > 0) {
                let hasBotWinner = false;
                game.winners.forEach((winner) => {
                    const user = winner?.userId;
                    if (!user) {
                        return;
                    }
                    if (isBotTelegramId(user.telegramId)) {
                        hasBotWinner = true;
                    }
                });
                if (hasBotWinner) {
                    botGamesWonFromRealGames += 1;
                }
            }
        });

        const totalPlayers = uniquePlayerIds.size;
        // Keep the existing response field name so the frontend continues to work,
        // but now it represents "number of games won by bots (with real users)".
        res.json({ totalPlayers, systemCut, botWinningsFromRealGames: botGamesWonFromRealGames });
    } catch { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
});

router.get('/stats/revenue/by-day', adminMiddleware, async (req, res) => {
    try {
        const days = Number(req.query.days || 7);
        const since = new Date(); since.setDate(since.getDate() - (days - 1)); since.setHours(0, 0, 0, 0);
        const games = await Game.find(
            { finishedAt: { $gte: since } },
            { systemCut: 1, finishedAt: 1, players: 1 }
        )
            .populate('players.userId', 'telegramId')
            .lean();
        const byDay = {};
        for (const g of games) {
            const humanIds = getHumanPlayerIds(g.players);
            // Ignore bot-only games in revenue stats
            if (humanIds.length === 0) {
                continue;
            }

            const key = new Date(g.finishedAt).toISOString().slice(0, 10);
            byDay[key] = (byDay[key] || 0) + (g.systemCut || 0);
        }
        const list = Object.entries(byDay).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([day, revenue]) => ({ day, revenue }));
        res.json({ revenueByDay: list });
    } catch { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
});

// Daily aggregated stats for admin table (games + finance), server-local day (Africa/Addis_Ababa)
router.get('/stats/daily', adminMiddleware, async (req, res) => {
    try {
        const days = Math.max(1, Math.min(60, Number(req.query.days || 14)));

        // Start at local midnight "days-1" days ago
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const since = new Date(startOfToday);
        since.setDate(since.getDate() - (days - 1));

        const dayKeyLocal = (dt) => {
            if (!dt) return null;
            const d = new Date(dt);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        // Games (real-user only)
        const games = await Game.find(
            { finishedAt: { $gte: since }, status: 'finished' },
            { stake: 1, systemCut: 1, finishedAt: 1, players: 1, winners: 1 }
        )
            .populate('players.userId winners.userId', 'telegramId')
            .lean();

        const byDay = new Map();
        const ensureDay = (key) => {
            if (!byDay.has(key)) {
                byDay.set(key, {
                    day: key,
                    totalGames: 0,
                    uniquePlayerIds: new Set(),
                    systemRevenue: 0,
                    stakes: new Set(),
                    botGamesWon: 0,
                    totalDeposits: 0,
                    totalWithdrawals: 0
                });
            }
            return byDay.get(key);
        };

        for (const g of games) {
            const humanIds = getHumanPlayerIds(g.players);
            if (humanIds.length === 0) continue; // skip bot-only games

            const key = dayKeyLocal(g.finishedAt);
            if (!key) continue;
            const row = ensureDay(key);

            row.totalGames += 1;
            row.systemRevenue += (g.systemCut || 0);
            row.stakes.add(g.stake || 0);
            humanIds.forEach((id) => row.uniquePlayerIds.add(id));

            // Bot game win: count game if any winner is a bot
            if (Array.isArray(g.winners) && g.winners.length > 0) {
                let hasBotWinner = false;
                g.winners.forEach((w) => {
                    const user = w?.userId;
                    if (user && isBotTelegramId(user.telegramId)) {
                        hasBotWinner = true;
                    }
                });
                if (hasBotWinner) row.botGamesWon += 1;
            }
        }

        // Deposits (completed, grouped by createdAt local day)
        const deposits = await Transaction.find(
            { type: 'deposit', status: 'completed', createdAt: { $gte: since } },
            { amount: 1, createdAt: 1 }
        ).lean();
        for (const d of deposits) {
            const key = dayKeyLocal(d.createdAt);
            if (!key) continue;
            const row = ensureDay(key);
            row.totalDeposits += Number(d.amount) || 0;
        }

        // Withdrawals (completed approvals, grouped by processed date local day)
        const withdrawals = await Transaction.find(
            {
                type: 'withdrawal',
                status: 'completed',
                'processedBy.adminId': { $exists: true, $ne: null },
                $or: [
                    { 'processedBy.processedAt': { $gte: since } },
                    { 'processedBy.processedAt': null, updatedAt: { $gte: since } }
                ]
            },
            { amount: 1, processedAt: 1, updatedAt: 1, processedBy: 1 }
        ).lean();

        for (const w of withdrawals) {
            const processedDate = w.processedBy?.processedAt || w.processedAt || w.updatedAt;
            const key = dayKeyLocal(processedDate);
            if (!key) continue;
            const row = ensureDay(key);
            row.totalWithdrawals += Number(w.amount) || 0;
        }

        // Build response list for last N days, descending (today → past)
        const list = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(startOfToday);
            d.setDate(d.getDate() - i);
            const key = dayKeyLocal(d);
            const row = byDay.get(key);
            if (!row) {
                list.push({
                    day: key,
                    stakes: [],
                    stakesDisplay: 'N/A',
                    totalGames: 0,
                    totalPlayers: 0,
                    systemRevenue: 0,
                    botGamesWon: 0,
                    totalDeposits: 0,
                    totalWithdrawals: 0
                });
            } else {
                const stakes = Array.from(row.stakes).filter((s) => s > 0).sort((a, b) => a - b);
                list.push({
                    day: key,
                    stakes,
                    stakesDisplay: stakes.length ? stakes.map((s) => `ETB ${s}`).join(', ') : 'N/A',
                    totalGames: row.totalGames,
                    totalPlayers: row.uniquePlayerIds.size,
                    systemRevenue: row.systemRevenue,
                    botGamesWon: row.botGamesWon,
                    totalDeposits: row.totalDeposits,
                    totalWithdrawals: row.totalWithdrawals
                });
            }
        }

        res.json({ days: list });
    } catch (error) {
        console.error('Daily stats error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// Game history for last N days (for AdminStats page). Uses game.stake, total pool, who won (Bot/Real/Both), real cost = (botPlayers * stake) - botWonAmount, net = systemCut - real cost.
router.get('/stats/game-history', adminMiddleware, async (req, res) => {
    try {
        const days = Math.max(1, Math.min(14, Number(req.query.days || 2)));
        const since = new Date();
        since.setDate(since.getDate() - days);
        since.setHours(0, 0, 0, 0);

        const games = await Game.find({
            finishedAt: { $gte: since },
            status: 'finished'
        })
            .sort({ finishedAt: -1 })
            .populate('players.userId', 'telegramId')
            .populate('winners.userId', 'telegramId')
            .lean();

        const list = [];
        for (const g of games) {
            const humanIds = getHumanPlayerIds(g.players);
            if (humanIds.length === 0) continue;

            const stake = g.stake || 0;
            let botPlayers = 0;
            let realPlayers = 0;
            (g.players || []).forEach((p) => {
                if (!p || !p.userId) return;
                const tid = p.userId.telegramId;
                if (isBotTelegramId(tid)) botPlayers += 1;
                else realPlayers += 1;
            });

            let botWonAmount = 0;
            let hasBotWinner = false;
            let hasRealWinner = false;
            let winnersPrizeSum = 0;
            (g.winners || []).forEach((w) => {
                if (!w || !w.userId) return;
                const tid = w.userId.telegramId;
                const prize = w.prize || 0;
                winnersPrizeSum += prize;
                if (isBotTelegramId(tid)) {
                    botWonAmount += prize;
                    hasBotWinner = true;
                } else {
                    hasRealWinner = true;
                }
            });

            let whoWon = 'Real';
            if (hasBotWinner && hasRealWinner) whoWon = 'Both';
            else if (hasBotWinner) whoWon = 'Bot';

            const realCost = Math.max(0, (botPlayers * stake) - botWonAmount);
            const netRevenue = (g.systemCut || 0) - realCost;

            const totalPrizes =
                typeof g.totalPrizes === 'number' && g.totalPrizes > 0 ? g.totalPrizes : winnersPrizeSum;

            list.push({
                gameId: g.gameId,
                totalPlayers: (g.players || []).length,
                prizePool: totalPrizes,
                systemRevenue: g.systemCut || 0,
                botPlayers,
                realPlayers,
                whoWon,
                netRevenue,
                finishedAt: g.finishedAt,
                stake
            });
        }

        res.json({ games: list });
    } catch (error) {
        console.error('Game history error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// --- Additional Admin Endpoints ---
router.get('/stats/games', adminMiddleware, async (req, res) => {
    try {
        const { days = 7 } = req.query;
        const since = new Date();
        since.setDate(since.getDate() - Number(days));
        since.setHours(0, 0, 0, 0);

        const games = await Game.find({
            finishedAt: { $gte: since },
            status: 'finished'
        })
            .sort({ finishedAt: -1 })
            .populate('players.userId', 'telegramId')
            .lean();

        const gameStats = games
            .map((game) => {
                const humanIds = getHumanPlayerIds(game.players);

                // Skip games that only have bot players
                if (humanIds.length === 0) {
                    return null;
                }

                return {
                    gameId: game.gameId,
                    stake: game.stake,
                    playersCount: humanIds.length,
                    players: humanIds,
                    systemCut: game.systemCut || 0,
                    totalPrizes: game.totalPrizes || 0,
                    finishedAt: game.finishedAt,
                    winnersCount: game.winners ? game.winners.length : 0
                };
            })
            .filter(Boolean);

        res.json({ games: gameStats });
    } catch (error) {
        console.error('Games stats error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

router.get('/stats/overview', adminMiddleware, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Today's stats
        const todayGamesRaw = await Game.find({
            finishedAt: { $gte: today, $lt: tomorrow },
            status: 'finished'
        })
            .populate('players.userId', 'telegramId')
            .lean();

        const todayGames = todayGamesRaw.filter((game) => getHumanPlayerIds(game.players).length > 0);

        const todayStats = {
            totalGames: todayGames.length,
            totalPlayers: todayGames.reduce((sum, game) => {
                return sum + getHumanPlayerIds(game.players).length;
            }, 0),
            totalRevenue: todayGames.reduce((sum, game) => sum + (game.systemCut || 0), 0),
            totalPrizes: todayGames.reduce((sum, game) => sum + (game.totalPrizes || 0), 0)
        };

        // All time stats
        const allTimeGamesRaw = await Game.find({ status: 'finished' })
            .populate('players.userId', 'telegramId')
            .lean();

        const allTimeGames = allTimeGamesRaw.filter((game) => getHumanPlayerIds(game.players).length > 0);
        const allTimeStats = {
            totalGames: allTimeGames.length,
            totalPlayers: allTimeGames.reduce((sum, game) => {
                return sum + getHumanPlayerIds(game.players).length;
            }, 0),
            totalRevenue: allTimeGames.reduce((sum, game) => sum + (game.systemCut || 0), 0),
            totalPrizes: allTimeGames.reduce((sum, game) => sum + (game.totalPrizes || 0), 0)
        };

        res.json({
            today: todayStats,
            allTime: allTimeStats
        });
    } catch (error) {
        console.error('Overview stats error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// --- Admin Invite Statistics ---
router.get('/stats/invites', adminMiddleware, async (req, res) => {
    try {
        const inviteStats = await InviteService.getGlobalInviteStats();
        res.json(inviteStats);
    } catch (error) {
        console.error('Invite stats error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// --- Admin Wallet Statistics ---
router.get('/stats/wallets/total-main', adminMiddleware, async (req, res) => {
    try {
        // Get all wallets with populated user data to check for bots
        const wallets = await Wallet.find({})
            .populate('userId', 'telegramId')
            .lean();
        
        let totalMain = 0;
        let botCount = 0;
        let botTotal = 0;
        let userCount = 0;
        
        // Filter out bot wallets and sum only real user wallets
        wallets.forEach((wallet) => {
            // Skip if wallet has no user data
            if (!wallet.userId || !wallet.userId.telegramId) {
                return;
            }
            
            const telegramId = String(wallet.userId.telegramId);
            // Check if this is a bot user
            // Bots have telegramId in range 9000000000-9000000020 (9 billion range, 20 bots)
            // or contain "bot_user_" pattern
            const telegramIdNum = parseInt(telegramId, 10);
            const isBot = (!isNaN(telegramIdNum) && telegramIdNum >= 9000000000 && telegramIdNum <= 9000000020) 
                || telegramId.includes('bot_user_');
            
            if (isBot) {
                botCount++;
                botTotal += (wallet.main || 0);
            } else {
                userCount++;
                totalMain += (wallet.main || 0);
            }
        });
        
        // Debug logging
        console.log('Total Main Wallet Stats:', {
            totalWallets: wallets.length,
            botWallets: botCount,
            botTotal: botTotal.toFixed(2),
            userWallets: userCount,
            userTotal: totalMain.toFixed(2)
        });
        
        res.json({ totalMain });
    } catch (error) {
        console.error('Total main wallet stats error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

router.get('/stats/wallets/total-play', adminMiddleware, async (req, res) => {
    try {
        // Get all wallets with populated user data to check for bots
        const wallets = await Wallet.find({})
            .populate('userId', 'telegramId')
            .lean();
        
        let totalPlay = 0;
        let botCount = 0;
        let botTotal = 0;
        let userCount = 0;
        
        // Filter out bot wallets and sum only real user wallets
        wallets.forEach((wallet) => {
            // Skip if wallet has no user data
            if (!wallet.userId || !wallet.userId.telegramId) {
                return;
            }
            
            const telegramId = String(wallet.userId.telegramId);
            // Check if this is a bot user
            // Bots have telegramId in range 9000000000-9000000020 (9 billion range, 20 bots)
            // or contain "bot_user_" pattern
            const telegramIdNum = parseInt(telegramId, 10);
            const isBot = (!isNaN(telegramIdNum) && telegramIdNum >= 9000000000 && telegramIdNum <= 9000000020) 
                || telegramId.includes('bot_user_');
            
            if (isBot) {
                botCount++;
                botTotal += (wallet.play || 0);
            } else {
                userCount++;
                totalPlay += (wallet.play || 0);
            }
        });
        
        // Debug logging
        console.log('Total Play Wallet Stats:', {
            totalWallets: wallets.length,
            botWallets: botCount,
            botTotal: botTotal.toFixed(2),
            userWallets: userCount,
            userTotal: totalPlay.toFixed(2)
        });
        
        res.json({ totalPlay });
    } catch (error) {
        console.error('Error calculating total play wallet:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

module.exports = router;
