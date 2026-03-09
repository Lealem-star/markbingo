/**
 * Mark Bingo Player Bot
 *
 * An automated bot that plays the Mark Bingo game by:
 * 1. Authenticating to get a JWT token
 * 2. Connecting to WebSocket
 * 3. Joining a game room
 * 4. Selecting a card during registration
 * 5. Monitoring called numbers
 * 6. Detecting winning patterns and claiming bingo
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
 */

require('dotenv').config();
const WebSocket = require('ws');
const fetch = require('node-fetch');

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
            const res = await fetch(`${this.apiBase}/api/auth/bot/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-bot-secret': this.botSecret
                },
                body: JSON.stringify({
                    telegramId: this.botTelegramId,
                    firstName: this.botFirstName,
                    lastName: this.botLastName
                })
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.token) {
                const msg = data?.error || `HTTP_${res.status}`;
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
        if (this.gameState.phase !== 'running') {
            console.warn('⚠️  Cannot claim bingo - game not running');
            return false;
        }

        console.log('🎉 CLAIMING BINGO!');
        return this.send('bingo_claim', {});
    }

    /**
     * Check if the bot has a winning pattern
     */
    checkForWin() {
        if (!this.gameState.myCard || this.gameState.calledNumbers.length === 0) {
            return false;
        }

        const card = this.gameState.myCard;
        const called = this.gameState.calledNumbers;

        // Check rows
        for (let i = 0; i < 5; i++) {
            if (card[i].every(num => num === 0 || called.includes(num))) {
                console.log(`✅ Winning row ${i + 1}!`);
                return true;
            }
        }

        // Check columns
        for (let j = 0; j < 5; j++) {
            if (card.every(row => row[j] === 0 || called.includes(row[j]))) {
                console.log(`✅ Winning column ${j + 1}!`);
                return true;
            }
        }

        // Check main diagonal (top-left to bottom-right)
        if (card.every((row, i) => row[i] === 0 || called.includes(row[i]))) {
            console.log('✅ Winning main diagonal!');
            return true;
        }

        // Check anti-diagonal (top-right to bottom-left)
        if (card.every((row, i) => row[4 - i] === 0 || called.includes(row[4 - i]))) {
            console.log('✅ Winning anti-diagonal!');
            return true;
        }

        return false;
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
            case 'snapshot':
                this.gameState.phase = payload.phase || this.gameState.phase;
                this.gameState.gameId = payload.gameId || this.gameState.gameId;
                this.gameState.playersCount = payload.playersCount || 0;
                this.gameState.calledNumbers = payload.calledNumbers || [];
                this.gameState.takenCards = payload.takenCards || [];
                this.gameState.myCardNumber = payload.yourSelection;

                if (this.gameState.phase === 'registration' && !this.gameState.myCardNumber) {
                    this.scheduleCardSelection();
                }
                break;

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
                this.gameState.myCard = payload.card;
                this.gameState.myCardNumber = payload.cardNumber;
                this.gameState.calledNumbers = payload.calledNumbers || [];
                this.stats.gamesPlayed++;

                console.log(`🎮 Game ${payload.gameId} started!`);
                console.log(`   Card: ${payload.cardNumber}, Players: ${payload.playersCount}, Prize Pool: ${payload.prizePool || 0}`);
                this.clearSelectionTimeout();
                break;

            case 'number_called':
                const newNumber = payload.number;
                if (!this.gameState.calledNumbers.includes(newNumber)) {
                    this.gameState.calledNumbers.push(newNumber);
                }
                process.stdout.write(`🔢 ${newNumber} `);

                if (this.checkForWin()) {
                    this.claimBingo();
                }
                break;

            case 'game_finished':
                this.gameState.phase = 'announce';
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
    console.log('🤖 Mark Bingo Player Bot Starting...\n');

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

