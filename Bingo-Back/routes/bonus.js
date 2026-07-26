const express = require('express');
const BonusService = require('../services/bonusService');
const { authMiddleware } = require('./auth');

const router = express.Router();

router.get('/active', authMiddleware, async (req, res) => {
    try {
        const match = await BonusService.getActiveMatch(req.userId);
        res.json({ match });
    } catch (error) {
        console.error('Bonus active error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

router.get('/history', authMiddleware, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
        const history = await BonusService.getHistory(limit);
        res.json({ history });
    } catch (error) {
        console.error('Bonus history error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

router.post('/predict', authMiddleware, async (req, res) => {
    try {
        const { matchId, score1, score2 } = req.body || {};
        if (!matchId) {
            return res.status(400).json({ error: 'MATCH_ID_REQUIRED' });
        }

        const result = await BonusService.submitPrediction(
            req.userId,
            matchId,
            score1,
            score2
        );

        res.json(result);
    } catch (error) {
        const code = error.message;
        const clientErrors = {
            MATCH_NOT_FOUND: 404,
            MATCH_NOT_OPEN: 400,
            MATCH_CLOSED: 400,
            ALREADY_PREDICTED: 409,
            INVALID_SCORE: 400,
            INSUFFICIENT_FUNDS: 402
        };

        if (error.message === 'INSUFFICIENT_FUNDS') {
            return res.status(402).json({ error: 'INSUFFICIENT_FUNDS' });
        }

        if (clientErrors[code]) {
            return res.status(clientErrors[code]).json({ error: code });
        }

        console.error('Bonus predict error:', error);
        res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
});

module.exports = router;
