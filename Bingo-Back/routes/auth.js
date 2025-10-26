const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UserService = require('../services/userService');
const WalletService = require('../services/walletService');

const router = express.Router();

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_change_this';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

// Telegram initData verification
function verifyTelegramInitData(initData) {
    if (!initData || !BOT_TOKEN) return null;
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        params.delete('hash');
        const data = Array.from(params.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
        const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const myHash = crypto.createHmac('sha256', secret).update(data).digest('hex');
        if (myHash !== hash) return null;
        const userJson = params.get('user');
        return userJson ? JSON.parse(userJson) : null;
    } catch (e) {
        return null;
    }
}

// Auth middleware
function authMiddleware(req, res, next) {
    try {
        const auth = req.headers['authorization'] || '';
        const sidHeader = req.headers['x-session'] || '';
        let token = '';
        const parts = auth.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
            token = parts[1];
        } else if (typeof sidHeader === 'string' && sidHeader) {
            token = sidHeader;
        }
        if (token) {
            const payload = jwt.verify(token, JWT_SECRET);
            req.userId = String(payload.sub);
            return next();
        }
        return res.status(401).json({ error: 'UNAUTHORIZED' });
    } catch (e) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
    }
}

// POST /auth/telegram-auth - Simple Telegram web app auth
router.post('/telegram-auth', async (req, res) => {
    try {
        const { telegramUser, stake } = req.body;

        if (!telegramUser || !telegramUser.id) {
            return res.status(400).json({ success: false, error: 'Invalid Telegram user data' });
        }

        // Create or update user
        const user = await UserService.createOrUpdateUser(telegramUser);

        // Ensure user has a wallet
        const wallet = await WalletService.getWallet(user._id);
        if (!wallet) {
            await WalletService.createWallet(user._id);
        }

        // Generate JWT token
        const token = jwt.sign(
            { sub: user._id.toString() },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: { id: user._id, telegramId: user.telegramId },
            stake: stake ? parseInt(stake) : null
        });
    } catch (error) {
        console.error('Telegram auth error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /auth/telegram/verify
router.post('/telegram/verify', async (req, res) => {
    try {
        console.log('🔐 /auth/telegram/verify called', {
            hasBody: !!req.body,
            hasInitData: !!req.body?.initData,
            initDataLength: req.body?.initData?.length,
            BOT_TOKEN_SET: !!BOT_TOKEN,
            JWT_SECRET_SET: !!JWT_SECRET
        });

        const { initData } = req.body;
        let user = null;
        let userId = null;

        if (initData) {
            // Telegram verification
            const telegramUser = verifyTelegramInitData(initData);
            console.log('🔐 Telegram verification result:', {
                hasTelegramUser: !!telegramUser,
                telegramId: telegramUser?.id
            });
            
            if (!telegramUser) {
                console.error('❌ INVALID_TELEGRAM_DATA - verification failed');
                return res.status(400).json({ error: 'INVALID_TELEGRAM_DATA' });
            }
            userId = String(telegramUser.id);
            console.log('Telegram User Verification:', {
                telegramId: userId,
                telegramUser: telegramUser
            });

            user = await UserService.getUserByTelegramId(userId);
            console.log('Existing User Lookup:', {
                telegramId: userId,
                foundUser: !!user,
                userId: user?._id?.toString()
            });

            if (!user) {
                console.log('Creating new user for telegramId:', userId);
                user = await UserService.createOrUpdateUser(telegramUser);
                console.log('New User Created:', {
                    telegramId: userId,
                    createdUser: !!user,
                    userId: user?._id?.toString()
                });
            }
            // Ensure user has a wallet
            if (user) {
                const wallet = await WalletService.getWallet(user._id);
                if (!wallet) {
                    await WalletService.createWallet(user._id);
                }
            }
        } else {
            return res.status(400).json({ error: 'MISSING_TELEGRAM_DATA' });
        }

        if (!user) {
            return res.status(500).json({ error: 'USER_CREATION_FAILED' });
        }

        // Debug logging to identify the issue
        console.log('JWT Creation Debug:', {
            userId: user._id ? user._id.toString() : 'NO_ID',
            telegramId: user.telegramId || userId,
            userObject: user,
            hasObjectId: !!user._id
        });

        // Ensure we have a valid user._id (MongoDB ObjectId)
        if (!user._id) {
            console.error('User object missing _id field:', user);
            return res.status(500).json({ error: 'INVALID_USER_OBJECT' });
        }

        // Issue JWT - use user._id as sub for consistency
        const token = jwt.sign({ sub: user._id.toString(), iat: Math.floor(Date.now() / 1000) }, JWT_SECRET, { expiresIn: '7d' });

        console.log('JWT Token Created:', {
            sub: user._id.toString(),
            tokenPreview: token.substring(0, 50) + '...'
        });

        const response = {
            token,
            sessionId: token,
            user: {
                id: user._id.toString(),
                telegramId: user.telegramId || userId,
                name: user.firstName,
                phone: user.phone,
                firstName: user.firstName,
                lastName: user.lastName,
                isRegistered: user.isRegistered
            }
        };

        console.log('✅ Sending auth response:', {
            hasToken: !!response.token,
            hasSessionId: !!response.sessionId,
            userId: response.user.id,
            username: response.user.name
        });

        res.json(response);
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

module.exports = { router, authMiddleware };
