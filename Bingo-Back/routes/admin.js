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
            coins: 0,
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
        coins: walletDoc.coins || 0,
        balance: balanceValue,
        totalDeposited: walletDoc.totalDeposited || 0,
        lastDepositDate: walletDoc.lastDepositDate || null
    };
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        const coinsDelta = parseDelta(req.body?.coinsDelta, { allowFloat: false });
        const reason = (req.body?.reason || '').trim();

        if (mainDelta === null || playDelta === null || coinsDelta === null) {
            return res.status(400).json({ error: 'INVALID_AMOUNT' });
        }

        if (mainDelta === 0 && playDelta === 0 && coinsDelta === 0) {
            return res.status(400).json({ error: 'NO_CHANGES' });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }

        const updates = {};
        if (mainDelta !== 0) updates.main = mainDelta;
        if (playDelta !== 0) updates.play = playDelta;
        if (coinsDelta !== 0) updates.coins = coinsDelta;

        const result = await WalletService.updateBalance(user._id, updates);
        const walletAfter = await Wallet.findOne({ userId: user._id }).lean();

        const adminDetails = await getAdminDetails(req);

        const deltasSummary = [];
        if (mainDelta !== 0) deltasSummary.push(`main ${mainDelta > 0 ? '+' : ''}${mainDelta}`);
        if (playDelta !== 0) deltasSummary.push(`play ${playDelta > 0 ? '+' : ''}${playDelta}`);
        if (coinsDelta !== 0) deltasSummary.push(`coins ${coinsDelta > 0 ? '+' : ''}${coinsDelta}`);
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
        
        const games = await Game.find({ finishedAt: { $gte: start, $lte: end } }, { systemCut: 1, players: 1 }).lean();
        
        // Calculate total players (unique players across all games) - matching bot logic
        const uniquePlayerIds = new Set();
        games.forEach(game => {
            if (game.players && Array.isArray(game.players)) {
                game.players.forEach(player => {
                    // Handle both cases: player object with userId, or direct playerId
                    const playerId = player?.userId ? player.userId : player;
                    if (playerId) {
                        uniquePlayerIds.add(playerId.toString());
                    }
                });
            }
        });
        const totalPlayers = uniquePlayerIds.size;
        
        const systemCut = games.reduce((s, g) => s + (g.systemCut || 0), 0);
        res.json({ totalPlayers, systemCut });
    } catch { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
});

router.get('/stats/revenue/by-day', adminMiddleware, async (req, res) => {
    try {
        const days = Number(req.query.days || 7);
        const since = new Date(); since.setDate(since.getDate() - (days - 1)); since.setHours(0, 0, 0, 0);
        const games = await Game.find({ finishedAt: { $gte: since } }, { systemCut: 1, finishedAt: 1 }).lean();
        const byDay = {};
        for (const g of games) {
            const key = new Date(g.finishedAt).toISOString().slice(0, 10);
            byDay[key] = (byDay[key] || 0) + (g.systemCut || 0);
        }
        const list = Object.entries(byDay).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([day, revenue]) => ({ day, revenue }));
        res.json({ revenueByDay: list });
    } catch { res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' }); }
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
        }).sort({ finishedAt: -1 }).lean();

        const gameStats = games.map(game => ({
            gameId: game.gameId,
            stake: game.stake,
            playersCount: game.players ? game.players.length : 0,
            players: game.players ? game.players.map(p => p.userId?.toString()) : [],
            systemCut: game.systemCut || 0,
            totalPrizes: game.totalPrizes || 0,
            finishedAt: game.finishedAt,
            winnersCount: game.winners ? game.winners.length : 0
        }));

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
        const todayGames = await Game.find({
            finishedAt: { $gte: today, $lt: tomorrow },
            status: 'finished'
        }).lean();

        const todayStats = {
            totalGames: todayGames.length,
            totalPlayers: todayGames.reduce((sum, game) => sum + (game.players ? game.players.length : 0), 0),
            totalRevenue: todayGames.reduce((sum, game) => sum + (game.systemCut || 0), 0),
            totalPrizes: todayGames.reduce((sum, game) => sum + (game.totalPrizes || 0), 0)
        };

        // All time stats
        const allTimeGames = await Game.find({ status: 'finished' }).lean();
        const allTimeStats = {
            totalGames: allTimeGames.length,
            totalPlayers: allTimeGames.reduce((sum, game) => sum + (game.players ? game.players.length : 0), 0),
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
