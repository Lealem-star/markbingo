const express = require('express');
const UserService = require('../services/userService');
const WalletService = require('../services/walletService');
const InviteService = require('../services/inviteService');
const Game = require('../models/Game');
const { authMiddleware } = require('./auth');

const router = express.Router();

// GET /user/profile
router.get('/profile', authMiddleware, async (req, res) => {
    try {
        // req.userId comes from JWT 'sub' which is Mongo _id
        let userData = await UserService.getUserWithWalletById(req.userId);

        // If user exists but wallet was never created (older accounts), create it on the fly
        if (!userData) {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }
        if (!userData.wallet) {
            await UserService.createWallet(req.userId);
            userData = await UserService.getUserWithWalletById(req.userId);
        }

        // Get game statistics using Mongo ObjectId
        const dbUserId = userData.user._id;
        const games = await Game.find({
            $or: [
                { 'players.userId': dbUserId },
                { 'winners.userId': dbUserId }
            ]
        }).sort({ createdAt: -1 });

        const totalGames = games.length;
        const gamesWon = games.filter(game =>
            game.winners.some(winner => String(winner.userId) === String(dbUserId))
        ).length;

        res.json({
            user: {
                firstName: userData.user.firstName,
                lastName: userData.user.lastName,
                phone: userData.user.phone,
                isRegistered: userData.user.isRegistered,
                role: userData.user.role || 'user', // Add role field
                totalGamesPlayed: totalGames,
                totalGamesWon: gamesWon,
                registrationDate: userData.user.createdAt
            },
            wallet: {
                balance: userData.wallet?.balance ?? 0,
                coins: userData.wallet?.coins ?? 0,
                gamesWon: userData.wallet?.gamesWon ?? 0,
                main: userData.wallet?.main ?? userData.wallet?.balance ?? 0,
                play: userData.wallet?.play ?? userData.wallet?.balance ?? 0,
                creditAvailable: userData.wallet?.creditAvailable ?? 0,
                creditUsed: userData.wallet?.creditUsed ?? 0,
                creditOutstanding: userData.wallet?.creditOutstanding ?? 0
            }
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// GET /user/summary
router.get('/summary', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId; // Mongo _id
        const userData = await UserService.getUserWithWalletById(userId);

        if (!userData) {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }

        // Get game statistics
        const games = await Game.find({
            $or: [
                { 'players.userId': userId },
                { 'winners.userId': userId }
            ]
        }).sort({ createdAt: -1 });

        const totalGames = games.length;
        const gamesWon = games.filter(game =>
            game.winners.some(winner => winner.userId === userId)
        ).length;

        res.json({
            totalGames,
            gamesWon,
            winRate: totalGames > 0 ? (gamesWon / totalGames * 100).toFixed(1) : 0,
            wallet: userData.wallet
        });
    } catch (error) {
        console.error('User summary error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// GET /user/transactions
router.get('/transactions', authMiddleware, async (req, res) => {
    try {
        const dbUserId = req.userId; // Mongo _id
        const user = await UserService.getUserById(dbUserId);
        if (!user) {
            return res.status(404).json({ error: 'USER_NOT_FOUND' });
        }
        const transactions = await WalletService.getTransactionHistory(user._id);
        res.json({ transactions });
    } catch (error) {
        console.error('Transaction history error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// GET /user/games
router.get('/games', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const games = await Game.find({
            $or: [
                { 'players.userId': userId },
                { 'winners.userId': userId }
            ]
        }).sort({ createdAt: -1 }).limit(50);

        const gameData = games.map(game => {
            const userPlayer = game.players.find(p => p.userId === userId);
            const userWinner = game.winners.find(w => w.userId === userId);

            return {
                id: game._id,
                gameId: game.gameId,
                stake: game.stake,
                status: game.status,
                finishedAt: game.finishedAt,
                userResult: {
                    participated: !!userPlayer,
                    won: !!userWinner,
                    prize: userWinner ? userWinner.prize : 0
                }
            };
        });

        res.json({ games: gameData });
    } catch (error) {
        console.error('Game history error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// GET /user/invite-stats
router.get('/invite-stats', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const inviteStats = await InviteService.getInviteStats(userId);
        res.json(inviteStats);
    } catch (error) {
        console.error('Invite stats error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// POST /user/generate-invite-code
router.post('/generate-invite-code', authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const inviteCode = await InviteService.generateInviteCode(userId);
        res.json({ inviteCode });
    } catch (error) {
        console.error('Generate invite code error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

// POST /user/track-invite
router.post('/track-invite', authMiddleware, async (req, res) => {
    try {
        const { inviterId, inviteeId } = req.body;

        if (!inviterId || !inviteeId) {
            return res.status(400).json({ error: 'Missing inviterId or inviteeId' });
        }

        const result = await InviteService.trackInvite(inviterId, inviteeId);
        res.json({ success: true, result });
    } catch (error) {
        console.error('Track invite error:', error);
        res.status(500).json({ error: error.message || 'INTERNAL_SERVER_ERROR' });
    }
});

// GET /user/validate-invite/:code
router.get('/validate-invite/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const validation = await InviteService.validateInviteCode(code);
        res.json(validation);
    } catch (error) {
        console.error('Validate invite code error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

module.exports = router;
