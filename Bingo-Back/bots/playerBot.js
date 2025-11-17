/**
 * Love Bingo Player Bot
 * 
 * An automated bot that plays the Love Bingo game by:
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

class PlayerBot {
    constructor(config = {}) {
        this.apiBase = config.apiBase || process.env.API_BASE || 'http://localhost:3001';
        this.wsBase = config.wsBase || process.env.WS_BASE || 'ws://localhost:3001';
        this.stake = config.stake || parseInt(process.env.STAKE || '10');
        this.token = config.token || process.env.JWT_TOKEN;
        this.ws = null;
        this.selectionDelayMs = this.computeSelectionDelay();
        this.pendingSelectionTimeout = null;
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
    }

    /**
     * Connect to WebSocket server
     */
    connect() {
        if (!this.token) {
            throw new Error('No authentication token. Set JWT_TOKEN environment variable or call setToken().');
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

            if (code !== 1008 && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
                console.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.connect(), delay);
            } else if (code === 1008) {
                console.error('❌ Authentication failed - token may be expired');
            }
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error.message);
        });
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

        const availableCards = Array.from({ length: 100 }, (_, i) => i + 1)
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
                this.scheduleCardSelection();
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
                this.clearSelectionTimeout();
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
    console.log('🤖 Love Bingo Player Bot Starting...\n');

    const bot = new PlayerBot({
        stake: parseInt(process.env.STAKE || '10'),
        apiBase: process.env.API_BASE || 'http://localhost:3001',
        wsBase: process.env.WS_BASE || 'ws://localhost:3001'
    });

    // Check for authentication token
    if (!bot.token) {
        console.error('❌ No JWT_TOKEN found in environment variables.');
        console.error('   Set JWT_TOKEN environment variable or add it to .env file');
        console.error('   Example: JWT_TOKEN="your_token_here" STAKE="10" node bots/playerBot.js');
        process.exit(1);
    }

    // Connect to WebSocket
    try {
        bot.connect();
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

