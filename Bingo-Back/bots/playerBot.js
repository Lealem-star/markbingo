/**
 * BestBingo Player Bot
 *
 * An automated bot that plays the BestBingo game by:
 * 1. Authenticating to get a JWT token
 * 2. Connecting to WebSocket
 * 3. Joining a game room
 * 4. Selecting a card during registration
 * 5. Monitoring called numbers
 * 6. Auto-claim: on each `number_called`, if `checkBingo` matches the server rules,
 *    sends `bingo_claim` with `cardNumber` only (legacy path — matches server validation).
 *
 * Usage:
 *   node bots/playerBot.js
 *   Or: npm run bot:start
 * 
 * Environment variables:
 *   JWT_TOKEN - JWT authentication token (required)
 *   STAKE - Stake amount: 10, 25, 50, or 100 (default: 10)
 *   API_BASE - API base URL (default: http://localhost:3001)
 *   WS_BASE - WebSocket base URL (default: ws://localhost:3001)
 *   AUTO_CLAIM - if "false", do not send bingo_claim when a pattern is detected (default: true)
 */

require('dotenv').config();
const WebSocket = require('ws');
const https = require('https');
const http = require('http');

// Mirrors Bingo-Back/index.js `checkBingo` — same win rules as the server for all rounds.
function checkBingo(cartella, calledNumbers) {
    if (!cartella || !Array.isArray(cartella) || cartella.length !== 5) return false;
    if (!calledNumbers || !Array.isArray(calledNumbers)) return false;

    for (let i = 0; i < 5; i++) {
        const row = cartella[i];
        if (!row || !Array.isArray(row)) continue;
        if (row.every(num => num === 0 || calledNumbers.includes(num))) return true;
    }

    for (let j = 0; j < 5; j++) {
        if (cartella.every(row => row && Array.isArray(row) && (row[j] === 0 || calledNumbers.includes(row[j])))) {
            return true;
        }
    }

    if (cartella.every((row, i) => row && Array.isArray(row) && (row[i] === 0 || calledNumbers.includes(row[i])))) {
        return true;
    }
    if (cartella.every((row, i) => row && Array.isArray(row) && (row[4 - i] === 0 || calledNumbers.includes(row[4 - i])))) {
        return true;
    }

    const topLeft = cartella[0]?.[0];
    const topRight = cartella[0]?.[4];
    const bottomLeft = cartella[4]?.[0];
    const bottomRight = cartella[4]?.[4];
    if (
        (topLeft === 0 || calledNumbers.includes(topLeft)) &&
        (topRight === 0 || calledNumbers.includes(topRight)) &&
        (bottomLeft === 0 || calledNumbers.includes(bottomLeft)) &&
        (bottomRight === 0 || calledNumbers.includes(bottomRight))
    ) {
        return true;
    }

    return false;
}

/** POST JSON to URL and return { ok, status, data } (Node built-in, no fetch dependency) */
function postJson(url, body, extraHeaders = {}) {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    const bodyStr = JSON.stringify(body);
    const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf8'),
        ...extraHeaders
    };
    return new Promise((resolve, reject) => {
        const req = lib.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                    resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: raw ? JSON.parse(raw) : {} });
                } catch (e) {
                    reject(new Error('Invalid JSON response'));
                }
            });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

function base64UrlToJson(segment) {
    try {
        let s = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4 !== 0) s += '=';
        return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
    } catch (e) {
        return null;
    }
}

function getJwtExpMs(token) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const payload = base64UrlToJson(parts[1]);
    return payload && typeof payload.exp === 'number' ? payload.exp * 1000 : null;
}

class PlayerBot {
    constructor(config = {}) {
        this.apiBase = config.apiBase || process.env.API_BASE || 'http://localhost:3001';
        this.wsBase = config.wsBase || process.env.WS_BASE || 'ws://localhost:3001';
        this.stake = config.stake || parseInt(process.env.STAKE || '10');
        this.token = config.token || process.env.JWT_TOKEN;
        this.botSecret = process.env.PLAYER_BOT_SECRET || '';
        this.botTelegramId = process.env.BOT_TELEGRAM_ID || '';
        this.botFirstName = process.env.BOT_FIRST_NAME || process.env.BOT_NAME || 'Bot';
        this.botLastName = process.env.BOT_LAST_NAME || '';
        this.ws = null;
        this.selectionDelayMs = this.computeSelectionDelay();
        this.pendingSelectionTimeout = null;
        this.tokenRefreshTimeout = null;
        this.refreshInFlight = null;
        this.gameState = {
            phase: 'waiting',
            gameId: null,
            playersCount: 0,
            calledNumbers: [],
            myCard: null,
            myCardNumber: null,
            takenCards: [],
            isConnected: false
        };
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.stats = {
            gamesPlayed: 0,
            gamesWon: 0,
            totalWinnings: 0
        };
        this.claimSentForGame = false;
        this.autoClaim =
            String(process.env.AUTO_CLAIM || 'true').toLowerCase() !== 'false';
    }

    /**
     * Compute a deterministic per-bot delay (1s-2s) based on token
     */
    computeSelectionDelay() {
        const base = 1000; // minimum 1s delay
        if (!this.token) {
            return base + Math.floor(Math.random() * 1000);
        }
        const hash = this.token.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
        return base + (hash % 1000); // 1000ms - 1999ms
    }

    clearSelectionTimeout() {
        if (this.pendingSelectionTimeout) {
            clearTimeout(this.pendingSelectionTimeout);
            this.pendingSelectionTimeout = null;
        }
    }

    scheduleCardSelection(extraDelay = 0) {
        this.clearSelectionTimeout();
        if (this.gameState.phase !== 'registration' || this.gameState.myCardNumber) {
            return;
        }
        const jitter = Math.floor(Math.random() * 400); // add small randomness
        const delay = this.selectionDelayMs + extraDelay + jitter;
        this.pendingSelectionTimeout = setTimeout(() => {
            this.pendingSelectionTimeout = null;
            if (this.gameState.phase === 'registration' && !this.gameState.myCardNumber) {
                this.selectRandomCard();
            }
        }, delay);
    }

    /**
     * Authenticate and get JWT token using Telegram initData
     */
    async authenticateWithTelegram(telegramInitData) {
        try {
            const response = await fetch(`${this.apiBase}/api/auth/telegram/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData: telegramInitData })
            });
            const data = await response.json();
            this.token = data.token || data.sessionId;
            console.log('✅ Authenticated via Telegram');
            return this.token;
        } catch (error) {
            console.error('❌ Telegram authentication failed:', error.message);
            throw error;
        }
    }

    /**
     * Set token directly
     */
    setToken(token) {
        this.token = token;
        this.selectionDelayMs = this.computeSelectionDelay();
        this.scheduleBackgroundTokenRefresh();
    }

    clearTokenRefreshTimeout() {
        if (this.tokenRefreshTimeout) {
            clearTimeout(this.tokenRefreshTimeout);
            this.tokenRefreshTimeout = null;
        }
    }

    scheduleBackgroundTokenRefresh() {
        this.clearTokenRefreshTimeout();
        const expMs = getJwtExpMs(this.token);
        if (!expMs) return;

        // Refresh token 30 minutes before it expires
        const refreshAtMs = expMs - (30 * 60 * 1000);
        const delay = refreshAtMs - Date.now();
        if (delay <= 1000) {
            // If already close/expired, do it soon
            this.tokenRefreshTimeout = setTimeout(() => this.refreshTokenIfPossible().catch(() => {}), 2000);
            return;
        }

        this.tokenRefreshTimeout = setTimeout(() => {
            this.refreshTokenIfPossible().catch(() => {});
        }, delay);
    }

    async refreshTokenIfPossible() {
        if (!this.botSecret || !this.botTelegramId) {
            return null;
        }
        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }

        this.refreshInFlight = (async () => {
            const { ok, status, data } = await postJson(
                `${this.apiBase}/api/auth/bot/token`,
                {
                    telegramId: this.botTelegramId,
                    firstName: this.botFirstName,
                    lastName: this.botLastName
                },
                { 'x-bot-secret': this.botSecret }
            );

            if (!ok || !data.token) {
                const msg = data?.error || `HTTP_${status}`;
                throw new Error(`Bot token refresh failed: ${msg}`);
            }

            this.setToken(data.token);
            console.log('✅ Refreshed bot JWT token');
            return data.token;
        })();

        try {
            return await this.refreshInFlight;
        } finally {
            this.refreshInFlight = null;
        }
    }

    async ensureValidToken() {
        // If we already have a token with plenty of time, keep it.
        const expMs = getJwtExpMs(this.token);
        if (this.token && expMs && expMs - Date.now() > (10 * 60 * 1000)) {
            return this.token;
        }
        // If token has no exp (old), or is near-expiry, refresh via secret if available.
        // Important: if refresh fails (DB/API temporarily down), fall back to existing token.
        try {
            const refreshed = await this.refreshTokenIfPossible();
            if (refreshed) return refreshed;
        } catch (e) {
            console.warn('⚠️  Bot token refresh failed, using existing JWT_TOKEN if available:', e.message);
        }

        if (!this.token) {
            throw new Error('No authentication token. Provide JWT_TOKEN or set PLAYER_BOT_SECRET + BOT_TELEGRAM_ID.');
        }
        return this.token;
    }

    /**
     * Connect to WebSocket server
     */
    connect() {
        if (!this.token) {
            throw new Error('No authentication token. Set JWT_TOKEN or enable auto-refresh (PLAYER_BOT_SECRET + BOT_TELEGRAM_ID).');
        }

        const wsUrl = `${this.wsBase}/ws?token=${this.token}&stake=${this.stake}`;
        console.log(`🔌 Connecting to WebSocket (stake: ${this.stake})...`);

        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log('✅ WebSocket connected');
            this.gameState.isConnected = true;
            this.reconnectAttempts = 0;
            this.joinRoom();
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                this.handleMessage(message);
            } catch (error) {
                console.error('❌ Error parsing WebSocket message:', error);
            }
        });

        this.ws.on('close', (code, reason) => {
            console.log(`🔌 WebSocket closed: ${code} - ${reason}`);
            this.gameState.isConnected = false;

            if (code === 1008) {
                console.error('❌ Authentication failed - attempting token refresh and reconnect');
                setTimeout(() => {
                    this.handleAuthFailureReconnect().catch((e) => {
                        console.error('❌ Token refresh failed:', e.message);
                    });
                }, 250);
                return;
            }

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
                console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.connectWithFreshToken().catch(() => {}), delay);
            }
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
        });
    }

    async handleAuthFailureReconnect() {
        try {
            await this.refreshTokenIfPossible();
        } catch (e) {
            console.warn('⚠️  Token refresh failed after 1008 close:', e.message);
        }
        // Reset reconnect attempts after fresh token
        this.reconnectAttempts = 0;
        await this.connectWithFreshToken();
    }

    async connectWithFreshToken() {
        await this.ensureValidToken();
        // Close old socket if still around
        if (this.ws) {
            try { this.ws.terminate(); } catch (e) { /* ignore */ }
            this.ws = null;
        }
        this.connect();
    }

    /**
     * Send message to WebSocket server
     */
    send(type, payload = {}) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = JSON.stringify({ type, payload });
            this.ws.send(message);
            console.log(`📤 Sent: ${type}`, payload);
            return true;
        } else {
            console.warn(`⚠️  Cannot send ${type} - WebSocket not open`);
            return false;
        }
    }

    /**
     * Join a game room
     */
    joinRoom() {
        this.send('join_room', { stake: this.stake });
    }

    /**
     * Select a card during registration
     */
    selectCard(cardNumber) {
        if (this.gameState.phase !== 'registration') {
            console.warn('⚠️  Cannot select card - not in registration phase');
            return false;
        }

        if (this.gameState.takenCards.includes(cardNumber)) {
            console.warn(`⚠️  Card ${cardNumber} is already taken`);
            return false;
        }

        console.log(`🎴 Selecting card ${cardNumber}`);
        return this.send('select_card', { cardNumber });
    }

    /**
     * Select a random available card
     */
    selectRandomCard() {
        if (this.gameState.phase !== 'registration') {
            console.warn('⚠️  Cannot select card - not in registration phase');
            return false;
        }

        const availableCards = Array.from({ length: 400 }, (_, i) => i + 1)
            .filter(card => !this.gameState.takenCards.includes(card));

        if (availableCards.length === 0) {
            console.warn('⚠️  No available cards, will retry when registration updates');
            this.scheduleCardSelection(500);
            return false;
        }

        const randomCard = availableCards[Math.floor(Math.random() * availableCards.length)];
        return this.selectCard(randomCard);
    }

    /**
     * Claim bingo when winning pattern is detected
     */
    claimBingo() {
        if (!this.autoClaim) {
            return false;
        }
        if (this.gameState.phase !== 'running') {
            console.warn('⚠️  Cannot claim bingo - game not running');
            return false;
        }
        if (this.claimSentForGame) {
            return true;
        }

        console.log('🎉 AUTO-CLAIM: sending bingo_claim');
        // Legacy payload: cardNumber only. Server then validates with checkBingo vs calledNumbers.
        // Do NOT send markedNumbers with all cells — server requires every mark to be already called.
        const sent = this.send('bingo_claim', {
            cardNumber: this.gameState.myCardNumber
        });
        if (sent) this.claimSentForGame = true;
        return sent;
    }

    /**
     * True when the card has any standard winning pattern vs called numbers (matches server checkBingo).
     */
    checkForWin() {
        if (!this.gameState.myCard || this.gameState.calledNumbers.length === 0) {
            return false;
        }
        if (!checkBingo(this.gameState.myCard, this.gameState.calledNumbers)) {
            return false;
        }
        console.log('✅ Winning pattern — can claim');
        return true;
    }

    /**
     * Handle incoming WebSocket messages
     */
    handleMessage(message) {
        const { type, payload } = message;

        // Log important events
        if (['game_started', 'game_finished', 'number_called', 'bingo_accepted'].includes(type)) {
            console.log(`📥 ${type}`, payload ? JSON.stringify(payload).substring(0, 150) : '');
        }

        switch (type) {
            case 'snapshot': {
                this.gameState.phase = payload.phase || this.gameState.phase;
                this.gameState.gameId = payload.gameId || this.gameState.gameId;
                this.gameState.playersCount = payload.playersCount || 0;
                const snapCalled = payload.calledNumbers || payload.called || [];
                this.gameState.calledNumbers = Array.isArray(snapCalled) ? [...snapCalled] : [];
                this.gameState.takenCards = payload.takenCards || [];

                const sel = payload.yourSelections;
                if (Array.isArray(sel) && sel.length > 0) {
                    this.gameState.myCardNumber = sel[0];
                } else if (payload.yourSelection != null) {
                    this.gameState.myCardNumber = payload.yourSelection;
                }

                if (this.gameState.phase === 'running' && Array.isArray(payload.cards) && payload.cards.length > 0) {
                    this.gameState.myCard = payload.cards[0].card || null;
                    if (payload.cards[0].cardNumber != null) {
                        this.gameState.myCardNumber = payload.cards[0].cardNumber;
                    }
                }

                if (this.gameState.phase === 'registration' && !this.gameState.myCardNumber) {
                    this.scheduleCardSelection();
                }

                // Rejoin mid-game: if we already have bingo on snapshot, claim immediately
                if (this.gameState.phase === 'running' && this.checkForWin()) {
                    this.claimBingo();
                }
                break;
            }

            case 'registration_open':
                this.gameState.phase = 'registration';
                this.gameState.gameId = payload.gameId;
                this.gameState.playersCount = payload.playersCount || 0;
                this.gameState.takenCards = payload.takenCards || [];
                this.gameState.myCardNumber = null;
                this.gameState.myCard = null;
                this.gameState.calledNumbers = [];

                console.log(`📋 Registration open for game ${payload.gameId} (${payload.playersCount} players)`);
                // Ensure we're still connected and ready to select
                if (this.gameState.isConnected) {
                    this.scheduleCardSelection();
                } else {
                    console.warn('⚠️  Not connected, cannot select card');
                }
                break;

            case 'selection_confirmed':
                this.gameState.myCardNumber = payload.cardNumber;
                this.gameState.playersCount = payload.playersCount || 0;
                console.log(`✅ Card ${payload.cardNumber} selected! Players: ${payload.playersCount}, Prize Pool: ${payload.prizePool || 0}`);
                this.clearSelectionTimeout();
                break;

            case 'bingo_rejected':
                if (
                    payload &&
                    (payload.reason === 'invalid_claim' ||
                        payload.reason === 'invalid_marked_numbers')
                ) {
                    this.claimSentForGame = false;
                }
                console.warn('⚠️  Bingo rejected:', payload && payload.reason);
                break;

            case 'selection_rejected':
                console.warn('⚠️  Card selection rejected:', payload.reason);
                if (payload.reason === 'TAKEN') {
                    // Update taken cards list if provided
                    if (payload.takenCards) {
                        this.gameState.takenCards = payload.takenCards;
                    }
                    this.scheduleCardSelection(300); // retry soon with stagger
                } else if (payload.reason === 'NOT_IN_REGISTRATION') {
                    console.log('⏳ Waiting for registration to open...');
                    this.clearSelectionTimeout();
                }
                break;

            case 'game_started':
                this.gameState.phase = 'running';
                this.gameState.gameId = payload.gameId;
                this.gameState.playersCount = payload.playersCount || 0;
                // Backend sends cards as array: [{ cardNumber, card }]. Keep compatibility with legacy payload.card.
                if (Array.isArray(payload.cards) && payload.cards.length > 0) {
                    this.gameState.myCard = payload.cards[0].card || null;
                    this.gameState.myCardNumber = payload.cards[0].cardNumber || null;
                } else {
                    this.gameState.myCard = payload.card || null;
                    this.gameState.myCardNumber = payload.cardNumber || this.gameState.myCardNumber || null;
                }
                this.gameState.calledNumbers = payload.calledNumbers || [];
                this.stats.gamesPlayed++;
                this.claimSentForGame = false;

                console.log(`🎮 Game ${payload.gameId} started!`);
                console.log(`   Card: ${this.gameState.myCardNumber}, Players: ${payload.playersCount}, Prize Pool: ${payload.prizePool || 0}`);
                this.clearSelectionTimeout();
                break;

            case 'number_called':
                const newNumber = payload.number;
                if (!this.gameState.calledNumbers.includes(newNumber)) {
                    this.gameState.calledNumbers.push(newNumber);
                }
                process.stdout.write(`🔢 ${newNumber} `);

                if (this.autoClaim && this.checkForWin()) {
                    this.claimBingo();
                }
                break;

            case 'game_finished':
                this.gameState.phase = 'announce';
                this.claimSentForGame = false;
                console.log('\n🏁 Game finished!');
                if (payload.winners && payload.winners.length > 0) {
                    const isWinner = payload.winners.some(w =>
                        String(w.userId) === String(this.gameState.myCardNumber) ||
                        w.cartelaNumber === this.gameState.myCardNumber
                    );
                    if (isWinner) {
                        this.stats.gamesWon++;
                        console.log('🏆 YOU WON!');
                    }
                    console.log('🏆 Winners:', payload.winners.map(w => w.name || `User ${w.userId}`));
                }
                console.log(`📊 Stats: ${this.stats.gamesPlayed} played, ${this.stats.gamesWon} won`);

                // Reset state for next game
                this.gameState.myCardNumber = null;
                this.gameState.myCard = null;
                this.gameState.calledNumbers = [];
                this.gameState.takenCards = [];
                this.clearSelectionTimeout();

                // Wait for next registration to open - the server will send registration_open
                console.log('⏳ Waiting for next registration to open...');
                break;

            case 'game_cancelled':
                console.log(`❌ Game cancelled: ${payload.reason}`);
                this.gameState.phase = 'registration';
                this.gameState.gameId = null;
                this.gameState.playersCount = 0;
                this.clearSelectionTimeout();
                break;

            case 'players_update':
                this.gameState.playersCount = payload.playersCount || 0;
                break;

            case 'registration_update':
                this.gameState.takenCards = payload.takenCards || [];
                if (this.gameState.phase === 'registration' && !this.gameState.myCardNumber) {
                    this.scheduleCardSelection(200);
                }
                break;

            case 'error':
                console.error('❌ Server error:', payload);
                break;

            default:
                // Silently ignore unhandled messages
                break;
        }
    }

    /**
     * Disconnect from WebSocket
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.gameState.isConnected = false;
        console.log('👋 Disconnected from WebSocket');
    }

    /**
     * Get current game state
     */
    getState() {
        return { ...this.gameState };
    }

    /**
     * Get statistics
     */
    getStats() {
        return { ...this.stats };
    }
}

// Main execution
async function main() {
    console.log('🤖 BestBingo Player Bot Starting...\n');

    const bot = new PlayerBot({
        stake: parseInt(process.env.STAKE || '10'),
        apiBase: process.env.API_BASE || 'http://localhost:3001',
        wsBase: process.env.WS_BASE || 'ws://localhost:3001'
    });

    // Connect to WebSocket
    try {
        await bot.connectWithFreshToken();
    } catch (error) {
        console.error('❌ Failed to start bot:', error.message);
        process.exit(1);
    }

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down bot...');
        bot.disconnect();
        console.log(`📊 Final stats: ${JSON.stringify(bot.getStats())}`);
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n👋 Shutting down bot...');
        bot.disconnect();
        process.exit(0);
    });
}

// Run if executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = PlayerBot;

