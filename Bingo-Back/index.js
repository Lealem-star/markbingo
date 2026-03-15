// Wrap startup in try-catch to catch any errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

try {
console.log('🚀 Starting application...');
process.stdout.write('🚀 Starting application...\n');
process.stderr.write('🚀 Starting application...\n');

console.log('Step 1: Loading express...');
const express = require('express');
console.log('✅ Express loaded');
process.stderr.write('✅ Express loaded\n');

console.log('Step 2: Loading cors...');
const cors = require('cors');
console.log('✅ CORS loaded');
process.stderr.write('✅ CORS loaded\n');

console.log('Step 3: Loading dotenv...');
require('dotenv').config();
console.log('✅ Environment loaded');
process.stderr.write('✅ Environment loaded\n');

const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
console.log('✅ Core modules loaded');

const connectDB = require('./config/database');
console.log('✅ Database module loaded');

const UserService = require('./services/userService');
const WalletService = require('./services/walletService');
const User = require('./models/User');
const Game = require('./models/Game');
const jwt = require('jsonwebtoken');
const BingoCards = require('./data/cartellas');
console.log('✅ Services and models loaded');

// Import routes
console.log('📦 Loading routes...');
const { router: authRoutes, authMiddleware } = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const generalRoutes = require('./routes/general');
const smsForwarderRoutes = require('./routes/smsForwarder');
const smsWebhookRoutes = require('./routes/smsWebhook');
console.log('✅ Routes loaded');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const WEBAPP_URL = process.env.WEBAPP_URL || '';

// Middleware - CORS: allow frontend origins (production + local dev) so browser requests succeed
const allowedOrigins = [
    'https://markbingo.com',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000'
];
if (process.env.FRONTEND_ORIGIN) {
    allowedOrigins.push(process.env.FRONTEND_ORIGIN);
}
app.use(cors({
    origin(origin, cb) {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-session', 'X-Session']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log('🌐 Incoming request:', {
        method: req.method,
        path: req.path,
        query: req.query,
        hasBody: !!req.body,
        timestamp: new Date().toISOString()
    });
    next();
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// JWT secret - ensure consistency
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_key_here_change_this';

// Debug JWT secret on startup
console.log('JWT Secret Debug:', {
    hasEnvSecret: !!process.env.JWT_SECRET,
    secretLength: JWT_SECRET.length,
    secretPreview: JWT_SECRET.substring(0, 10) + '...'
});

// Health check endpoint to keep service alive
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Use routes
app.use('/auth', authRoutes); // Keep for backward compatibility
app.use('/api/auth', authRoutes); // Mount under /api/auth to match frontend apiFetch behavior
app.use('/wallet', walletRoutes); // Keep for backward compatibility
app.use('/api/wallet', walletRoutes); // Mount under /api/wallet to match frontend apiFetch behavior
app.use('/user', userRoutes); // Keep for backward compatibility
app.use('/api/user', userRoutes); // Mount under /api/user to match frontend apiFetch behavior
app.use('/api/admin', adminRoutes); // Mount under /api/admin to match frontend apiFetch behavior
app.use('/admin', adminRoutes); // Also mount at /admin for backward compatibility
app.use('/sms-forwarder', smsForwarderRoutes);
app.use('/sms-webhook', smsWebhookRoutes);

// General routes (cartellas, public endpoints) - mount at both / and /api
app.use('/', generalRoutes);
app.use('/api', generalRoutes);

// Initialize database connection
connectDB().catch((error) => {
    console.error('⚠️  MongoDB connection failed:', error.message);
    // Don't exit - let the server start even if DB connection fails initially
    // It will retry on actual database operations
});

// WebSocket server at /ws
const wss = new WebSocketServer({ noServer: true });

// --- Simple in-memory rooms with auto-cycling phases ---
const stakes = [10];
// Multi-room per stake: stake -> [room, room, ...]
const rooms = new Map();

function getRoomsForStake(stake) {
    if (!rooms.has(stake)) rooms.set(stake, []);
    return rooms.get(stake);
}

function countSelectedCartelas(room) {
    return Array.from(room.userCardSelections.values()).reduce((sum, arr) => sum + (arr?.length || 0), 0);
}

function countSelectedPlayers(room) {
    return room?.selectedPlayers?.size || 0;
}

function getJoinableRoomForStake(stake) {
    const list = getRoomsForStake(stake);
    const totalCards = BingoCards.cards.length;
    // Prefer registration rooms with available cards
    return list.find(r => r.phase === 'registration' && r.takenCards.size < totalCards) || null;
}

// Find user's active game room (where they have cards in a running game)
function getActiveGameRoomForUser(userId, stake) {
    const list = getRoomsForStake(stake);
    return list.find(r => {
        // Check if room is running and user has cards
        if (r.phase !== 'running') return false;
        const userCartellas = r.cartellas.get(userId);
        return userCartellas instanceof Map && userCartellas.size > 0;
    }) || null;
}

// Clean up empty finished rooms (rooms in announce phase with no players)
function cleanupEmptyRooms(stake) {
    const list = getRoomsForStake(stake);
    const now = Date.now();
    const cleaned = list.filter(room => {
        // Keep rooms that:
        // 1. Have players
        // 2. Are in registration or running phase
        // 3. Are in announce phase but just finished (less than 10 seconds ago)
        if (room.players.size > 0) return true;
        if (room.phase === 'registration' || room.phase === 'running') return true;
        if (room.phase === 'announce') {
            // Keep announce rooms for 10 seconds after game ends
            const timeSinceAnnounce = now - (room.gameEndTime || 0);
            return timeSinceAnnounce < 10000;
        }
        return false;
    });
    
    const removed = list.length - cleaned.length;
    if (removed > 0) {
        rooms.set(stake, cleaned);
        console.log(`🧹 Cleaned up ${removed} empty room(s) for stake ${stake}`);
    }
}

function makeRoom(stake) {
    const room = {
        id: `room_${stake}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        stake,
        phase: 'registration', // registration, running, announce
        currentGameId: null, // Will be set when registration starts
        players: new Map(), // userId -> { ws, cartella, name }
        selectedPlayers: new Set(), // userIds who have successfully bet
        calledNumbers: [],
        cartellas: new Map(), // userId -> cartella
        winners: [],
        takenCards: new Set(), // numbers chosen during registration (1-100)
        userCardSelections: new Map(), // userId -> [cardNumber] (max 1)
        // Prevent duplicate announce/payout and manage call timer lifecycle
        announceProcessed: false,
        callTimerId: null,
        announceTimerId: null,
        startTime: Date.now(),
        registrationEndTime: Date.now() + 30000, // 30 seconds from now
        gameEndTime: null,
        onJoin: async (ws) => {
            console.log('Room onJoin called:', { userId: ws.userId, roomStake: room.stake, roomPhase: room.phase });

            room.players.set(ws.userId, { ws, cartella: null, name: 'Player' });
            ws.room = room;

            const getUserSelections = (userId) => room.userCardSelections.get(userId) || [];
            const selectedCount = countSelectedCartelas(room);
            const selectedPlayersCount = countSelectedPlayers(room);
            const snapshot = {
                phase: room.phase,
                gameId: room.currentGameId,
                playersCount: selectedPlayersCount,
                calledNumbers: room.calledNumbers,
                called: room.calledNumbers,
                stake: room.stake,
                takenCards: Array.from(room.takenCards),
                yourSelections: getUserSelections(ws.userId),
                nextStartAt: room.registrationEndTime || room.gameEndTime || null,
                prizePool: room.phase === 'running'
                    ? (selectedCount * room.stake) - Math.floor(selectedCount * room.stake * 0.2)
                    : 0
            };

            // If room is running and user has cards, include the cards array in snapshot
            if (room.phase === 'running') {
                const userSelections = getUserSelections(ws.userId);
                if (userSelections.length > 0) {
                    snapshot.cards = userSelections.map(cardNumber => ({
                        cardNumber,
                        card: getPredefinedCartella(cardNumber)
                    }));
                    console.log('Including cards in snapshot for running game:', {
                        userId: ws.userId,
                        gameId: room.currentGameId,
                        cardsCount: snapshot.cards.length,
                        cardNumbers: userSelections
                    });
                }
            }

            console.log('Sending snapshot to user:', { userId: ws.userId, snapshot });
            // IMPORTANT: snapshot contains user-specific fields (yourSelections), so send only to this ws.
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'snapshot', payload: snapshot }));
            }
        },
        onLeave: (ws) => {
            // Always remove from live connection list
            room.players.delete(ws.userId);

            if (room.phase === 'registration') {
                // During registration, free up their selections so others can take the cards
                room.selectedPlayers.delete(ws.userId);
                room.cartellas.delete(ws.userId);
                const prevSelections = room.userCardSelections.get(ws.userId) || [];
                prevSelections.forEach((n) => room.takenCards.delete(n));
                room.userCardSelections.delete(ws.userId);

                const selectedCount = countSelectedCartelas(room);
                const selectedPlayersCount = countSelectedPlayers(room);
                const currentPrizePool = Math.floor(selectedCount * room.stake * 0.8);
                broadcast('players_update', { playersCount: selectedPlayersCount, prizePool: currentPrizePool }, room);
                broadcast('registration_update', { takenCards: Array.from(room.takenCards) }, room);
            } else {
                // During running/announce: DO NOT change selections, takenCards, or prize math.
                // This ensures pot and prizePool stay based on the original number of cartelas,
                // and leaving players do not affect the jackpot or get refunded.
                console.log('Player left during non-registration phase; keeping selections and prize pool intact:', {
                    userId: ws.userId,
                    phase: room.phase,
                    gameId: room.currentGameId
                });
            }
        }
    };
    return room;
}

function broadcast(type, payload, targetRoom = null) {
    const message = JSON.stringify({ type, payload });
    if (targetRoom) {
        // Broadcast to specific room
        targetRoom.players.forEach(({ ws }) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(message);
            }
        });
    } else {
        // Broadcast to all rooms (fallback)
        rooms.forEach(room => {
            room.players.forEach(({ ws }) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(message);
                }
            });
        });
    }
}

async function startRegistration(room) {
    console.log('startRegistration called for room:', room.stake);
    room.phase = 'registration';
    room.registrationEndTime = Date.now() + 30000; // 30 seconds
    room.startTime = Date.now();
    room.announceProcessed = false;
    // Clear any pending number-calling timer when restarting registration
    if (room.callTimerId) {
        clearTimeout(room.callTimerId);
        room.callTimerId = null;
    }
    room.takenCards.clear();
    room.userCardSelections.clear();
    room.selectedPlayers.clear(); // Clear previous selections

    // Generate a more unique gameId with random component and process ID
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    const processId = process.pid ? String(process.pid).slice(-2) : '00';
    room.currentGameId = `LB${String(timestamp).slice(-4)}${String(random).padStart(4, '0')}${processId}`;
    console.log('Registration started with gameId:', room.currentGameId);

    // Don't create game record in database yet - only create when game actually starts with players
    console.log(`Game registration started for ${room.currentGameId} - will create database record only if players join`);

    broadcast('registration_open', {
        gameId: room.currentGameId,
        stake: room.stake,
        playersCount: 0, // Start with 0, will update as players join
        duration: 30000, // 30 seconds
        endsAt: room.registrationEndTime,
        availableCards: Array.from({ length: BingoCards.cards.length }, (_, i) => i + 1), // Generate available cards based on actual card count
        takenCards: [],
    }, room);

    // Proactively fund bots when registration opens
    (async () => {
        for (const [userId, player] of room.players) {
            try {
                const isBot = await WalletService.isBotUser(userId);
                if (isBot) {
                    await WalletService.autoFundBot(userId, room.stake);
                }
            } catch (error) {
                console.error(`Error auto-funding bot ${userId} during registration:`, error.message);
            }
        }
    })();

    setTimeout(async () => {
        if (room.phase === 'registration') {
            // Decide whether to start, extend, or restart registration.
            // IMPORTANT: only broadcast registration_closed when we will actually start the game.
            startGame(room);
        }
    }, 30000); // 30 seconds
}

function startGame(room) {
    const selectedCount = Array.from(room.userCardSelections.values()).reduce((sum, arr) => sum + (arr?.length || 0), 0);
    const selectedPlayersCount = room.selectedPlayers ? room.selectedPlayers.size : 0;

    if (selectedPlayersCount === 0) {
        // No players, start new registration immediately
        console.log(`No players joined game ${room.currentGameId} - skipping database creation and starting new registration`);
        startRegistration(room);
        return;
    }

    if (selectedPlayersCount < 2) {
        // Not enough players yet to start a game – extend registration until we have at least 2 players.
        console.log(`Only ${selectedPlayersCount} player(s) joined game ${room.currentGameId}. Extending registration by 30 seconds.`);

        // Keep existing selections/takenCards and just extend the timer
        room.phase = 'registration';
        room.registrationEndTime = Date.now() + 30000; // extend by 30 seconds
        room.startTime = Date.now();

        const currentPrizePool = Math.floor(selectedCount * room.stake * 0.8);

        // Notify clients that registration has been extended for this game
        broadcast('registration_extended', {
            gameId: room.currentGameId,
            stake: room.stake,
            playersCount: selectedPlayersCount,
            duration: 30000,
            endsAt: room.registrationEndTime,
            takenCards: Array.from(room.takenCards),
            prizePool: currentPrizePool
        }, room);

        // Schedule another check after the extended period.
        // This will keep extending every 30s until there are 0 or 2+ selections.
        setTimeout(() => {
            if (room.phase === 'registration' && room.currentGameId) {
                startGame(room);
            }
        }, 30000);
        return;
    }

    // We have enough players to start. Tell clients registration is closed so they can move to "starting".
    broadcast('registration_closed', { gameId: room.currentGameId }, room);

    // Process stake sources per player and build pot from paying players only
    let payingUsers = [];
    // Loan/credit play removed: only main/play wallet balances are supported

    console.log(`Starting game ${room.currentGameId}: ${selectedCount} selections`);
    console.log('Room players:', Array.from(room.players.keys()));
    console.log('Selected players:', Array.from(room.selectedPlayers));

    // Debug player tracking
    room.selectedPlayers.forEach(userId => {
        const hasPlayer = room.players.has(userId);
        const hasWs = room.players.get(userId)?.ws;
        console.log('Player tracking:', { userId, hasPlayer, hasWs: !!hasWs });
    });

    // Calculate pot based on selected cartelas (before any deductions)
    const pot = selectedCount * room.stake;
    const systemCut = Math.floor(pot * 0.2);
    const prizePool = pot - systemCut;

    // Process wallet deductions for all selected players (fire and forget)
    const players = [];
    (async () => {
        for (const userId of room.selectedPlayers) {
            try {
                const selections = room.userCardSelections.get(userId) || [];
                for (const cartelaNumber of selections) {
                    const result = await WalletService.processGameBet(userId, room.stake, room.currentGameId);
                    if (result && result.wallet) {
                        players.push({
                            userId,
                            cartelaNumber,
                            joinedAt: new Date()
                        });
                        payingUsers.push(userId);
                        console.log(`Stake deducted for user ${userId} (cartela ${cartelaNumber}) from ${result.source}`);

                        // Send wallet update to the player (after each deduction)
                        const playerObj = room.players.get(userId);
                        const ws = playerObj && playerObj.ws;
                        if (ws && ws.readyState === ws.OPEN) {
                            const wallet = await WalletService.getWallet(userId);
                            ws.send(JSON.stringify({
                                type: 'wallet_update',
                                payload: {
                                    main: wallet.main,
                                    play: wallet.play,
                                    source: result.source
                                }
                            }));
                        }
                    }
                }
            } catch (error) {
                if (String(error.message) === 'INSUFFICIENT_FUNDS') {
                    // Check if user is a bot and auto-fund if needed
                    const isBot = await WalletService.isBotUser(userId);
                    if (isBot) {
                        try {
                            console.log(`🤖 Bot ${userId} has insufficient funds, auto-funding...`);
                            await WalletService.autoFundBot(userId, room.stake);
                            
                            // Retry processing for all selected cartelas after funding
                            const selections = room.userCardSelections.get(userId) || [];
                            for (const cartelaNumber of selections) {
                                const result = await WalletService.processGameBet(userId, room.stake, room.currentGameId);
                                if (result && result.wallet) {
                                    players.push({
                                        userId,
                                        cartelaNumber,
                                        joinedAt: new Date()
                                    });
                                    payingUsers.push(userId);
                                    console.log(`✅ Bot ${userId} auto-funded and stake deducted (cartela ${cartelaNumber}) from ${result.source}`);

                                    // Send wallet update to the bot
                                    const playerObj = room.players.get(userId);
                                    const ws = playerObj && playerObj.ws;
                                    if (ws && ws.readyState === ws.OPEN) {
                                        const wallet = await WalletService.getWallet(userId);
                                        ws.send(JSON.stringify({
                                            type: 'wallet_update',
                                            payload: {
                                                main: wallet.main,
                                                play: wallet.play,
                                                source: result.source
                                            }
                                        }));
                                    }
                                }
                            }
                        } catch (fundError) {
                            console.error(`❌ Failed to auto-fund bot ${userId}:`, fundError.message);
                            // Remove bot if auto-funding fails
                            room.selectedPlayers.delete(userId);
                        }
                    }
                } else {
                    console.error(`Failed to deduct stake for user ${userId}:`, error);
                    room.selectedPlayers.delete(userId);
                }
            }
        }

        // Persist game start metadata
        try {
            await Game.findOneAndUpdate(
                { gameId: room.currentGameId },
                {
                    players: players,
                    pot: pot,
                    systemCut: systemCut,
                    prizePool: prizePool,
                    status: 'running',
                    startedAt: new Date()
                }
            );
        } catch (error) {
            console.error('Error updating game record:', error);
        }

        // Build and send per-user game_started payload (supports up to 2 cartelas per user)
        room.selectedPlayers.forEach(userId => {
            const player = room.players.get(userId);
            if (player && player.ws) {
                const selections = room.userCardSelections.get(userId) || [];
                const cards = selections.map(cardNumber => ({
                    cardNumber,
                    card: getPredefinedCartella(cardNumber)
                }));
                const message = JSON.stringify({
                    type: 'game_started',
                    payload: {
                        gameId: room.currentGameId,
                        stake: room.stake,
                        playersCount: selectedPlayersCount,
                        pot: pot,
                        prizePool: prizePool,
                        calledNumbers: room.calledNumbers,
                        called: room.calledNumbers,
                        cards
                    }
                });
                if (player.ws.readyState === player.ws.OPEN) {
                    player.ws.send(message);
                }
            }
        });
    })();

    // (persisting handled above after payments)

    room.phase = 'running';
    room.calledNumbers = [];
    room.winners = [];
    room.gameEndTime = Date.now() + 300000; // 5 minutes max

    // Create game record in database now that game is actually starting with players
    (async () => {
        try {
            const gamePlayers = [];
            Array.from(room.selectedPlayers).forEach(userId => {
                const selections = room.userCardSelections.get(userId) || [];
                selections.forEach(cartelaNumber => {
                    const cardData = getPredefinedCartella(cartelaNumber);
                    gamePlayers.push({
                        userId,
                        cartelaNumber,
                        cardData
                    });
                });
            });

            const game = new Game({
                gameId: room.currentGameId,
                stake: room.stake,
                players: gamePlayers,
                status: 'running',
                registrationEndsAt: new Date(room.registrationEndTime),
                pot: pot,
                systemCut: systemCut,
                prizePool: prizePool,
                startedAt: new Date()
            });
            await game.save();
            console.log(`Game ${room.currentGameId} created in database with ${gamePlayers.length} cartelas`);
        } catch (error) {
            console.error('Error creating game record in database:', error);
        }
    })();

    // Assign predefined cartellas based on selected card numbers (supports multiple per user)
    room.selectedPlayers.forEach(userId => {
        const selections = room.userCardSelections.get(userId) || [];
        const byNumber = new Map();
        selections.forEach(selectedCardNumber => {
            byNumber.set(selectedCardNumber, getPredefinedCartella(selectedCardNumber));
        });
        room.cartellas.set(userId, byNumber);
        const player = room.players.get(userId);
        if (player) {
            player.cartella = byNumber;
        }
    });

    // Send individual game_started messages to each player with their specific cards
    room.selectedPlayers.forEach(userId => {
        const player = room.players.get(userId);
        if (player && player.ws) {
            const cartellasMap = room.cartellas.get(userId);
            const selections = room.userCardSelections.get(userId) || [];
            
            // Convert Map to array format expected by frontend: [{ cardNumber, card }]
            const cards = [];
            if (cartellasMap instanceof Map) {
                cartellasMap.forEach((cartella, cartelaNumber) => {
                    cards.push({
                        cardNumber: cartelaNumber,
                        card: cartella
                    });
                });
            } else if (Array.isArray(selections)) {
                // Fallback: if cartellasMap is not a Map, try to get cards from selections
                selections.forEach(cardNumber => {
                    const cartella = getPredefinedCartella(cardNumber);
                    if (cartella) {
                        cards.push({
                            cardNumber: cardNumber,
                            card: cartella
                        });
                    }
                });
            }
            
            console.log('Sending game_started to player:', { userId, gameId: room.currentGameId, cardsCount: cards.length, cardNumbers: selections });
            console.log('WebSocket state:', { readyState: player.ws.readyState, OPEN: player.ws.OPEN });
            const message = JSON.stringify({
                type: 'game_started',
                payload: {
                    gameId: room.currentGameId,
                    stake: room.stake,
                    playersCount: room.selectedPlayers.size,
                    pot: pot,
                    prizePool: prizePool,
                    calledNumbers: room.calledNumbers,
                    called: room.calledNumbers,
                    cards: cards
                }
            });
            console.log('Game started message:', message.substring(0, 500) + '...'); // Log first 500 chars to avoid huge logs
            if (player.ws.readyState === player.ws.OPEN) {
                player.ws.send(message);
                console.log('Game started message sent successfully to player:', userId);
            } else {
                console.log('WebSocket not open, cannot send message to player:', userId, 'readyState:', player.ws.readyState);
            }
        } else {
            console.log('Player not found in room.players:', { userId, hasPlayer: !!player, hasWs: !!(player && player.ws) });
        }
    });

    // Start calling numbers after a short delay so the UI can show a 3-2-1 countdown
    console.log('⏳ Scheduling first number call in 4 seconds for game:', room.currentGameId);
    setTimeout(() => {
        // Only start calling numbers if the game is still running
        if (room.phase === 'running') {
    callNextNumber(room);
        } else {
            console.log('⏹️ Skipping first number call because phase is no longer running:', {
                gameId: room.currentGameId,
                phase: room.phase
            });
        }
    }, 4000);
}

function callNextNumber(room) {
    console.log('🔢 callNextNumber called:', {
        roomId: room.id,
        phase: room.phase,
        calledCount: room.calledNumbers.length,
        gameId: room.currentGameId
    });

    if (room.phase !== 'running' || room.calledNumbers.length >= 75) {
        console.log('⏹️ Stopping number calls:', {
            phase: room.phase,
            calledCount: room.calledNumbers.length,
            reason: room.phase !== 'running' ? 'phase not running' : 'max numbers reached'
        });
        scheduleAnnounce(room, 'max_numbers_or_not_running');
        return;
    }

    let number;
    do {
        number = Math.floor(Math.random() * 75) + 1;
    } while (room.calledNumbers.includes(number));

    room.calledNumbers.push(number);
    console.log('📢 Calling number:', {
        number,
        calledCount: room.calledNumbers.length,
        gameId: room.currentGameId,
        allCalled: room.calledNumbers
    });
    broadcast('number_called', { gameId: room.currentGameId, number, calledNumbers: room.calledNumbers, value: number, called: room.calledNumbers }, room);

    // Automatic winner detection disabled:
    // winners are now only determined from explicit bingo_claim messages.

    // Call next number after delay (maintains consistent timing)
    console.log('⏰ Scheduling next number call in 5 seconds...');
    room.callTimerId = setTimeout(() => {
        console.log('⏰ Timer fired, calling next number...');
        callNextNumber(room);
    }, 5000);
    console.log('✅ Timer scheduled, callTimerId:', room.callTimerId);
}

async function checkWinners(room) {
    try {
        // Safety check: ensure room is in running phase and has cartellas
        if (!room || room.phase !== 'running') {
            return;
        }
        if (!room.cartellas || !(room.cartellas instanceof Map) || room.cartellas.size === 0) {
            // No cartellas to check - game should continue
            return;
        }
        if (!room.calledNumbers || !Array.isArray(room.calledNumbers)) {
            return;
        }

    const winners = [];
        const calledCount = room.calledNumbers.length;
        
        try {
            room.cartellas.forEach((cartellasMap, userId) => {
                try {
                    // cartellasMap is a Map of cartelaNumber -> cartella (2D array)
                    if (cartellasMap instanceof Map) {
                        cartellasMap.forEach((cartella, cartelaNumber) => {
                            try {
                                if (cartella && Array.isArray(cartella)) {
        if (checkBingo(cartella, room.calledNumbers)) {
                                        console.log(`Bingo found! User: ${userId}, Cartela: ${cartelaNumber}, Called numbers: ${calledCount}`);
                                        winners.push({ userId, cartella, cartelaNumber });
        }
                                }
                            } catch (cartellaError) {
                                console.error(`Error checking cartella for user ${userId}, cartela ${cartelaNumber}:`, cartellaError);
                            }
                        });
                    } else if (Array.isArray(cartellasMap)) {
                        // Fallback: if it's directly an array (legacy support)
                        try {
                            if (checkBingo(cartellasMap, room.calledNumbers)) {
                                console.log(`Bingo found! User: ${userId}, Called numbers: ${calledCount}`);
                                winners.push({ userId, cartella: cartellasMap });
                            }
                        } catch (bingoError) {
                            console.error(`Error checking bingo for user ${userId}:`, bingoError);
                        }
                    }
                } catch (userError) {
                    console.error(`Error processing cartellas for user ${userId}:`, userError);
                }
            });
        } catch (forEachError) {
            console.error('Error iterating over cartellas:', forEachError);
        }

    if (winners.length > 0) {
            console.log(`Found ${winners.length} winner(s), scheduling announce`);
        room.winners = winners;
        scheduleAnnounce(room, 'winner_found');
        }
    } catch (error) {
        console.error('Error in checkWinners:', error);
        // Don't stop the game if there's an error checking winners
    }
}

function scheduleAnnounce(room, reason = 'unknown') {
    // Don't schedule if we've already processed announce or a timer exists
    if (!room || room.announceProcessed) {
        return;
    }
    if (room.announceTimerId) {
        return;
    }

    // Stop any further number calls while we wait
    if (room.callTimerId) {
        clearTimeout(room.callTimerId);
        room.callTimerId = null;
    }

    console.log('⏳ Scheduling announce in 5 seconds...', {
        roomId: room.id,
        gameId: room.currentGameId,
        reason
    });

    room.announceTimerId = setTimeout(async () => {
        room.announceTimerId = null;
        await toAnnounce(room);
    }, 5000);
}

async function toAnnounce(room) {
    // Idempotency guard to avoid duplicate payouts/announcements
    if (room.announceProcessed) {
        return;
    }
    room.announceProcessed = true;

    // Stop any pending scheduled number calls
    if (room.callTimerId) {
        clearTimeout(room.callTimerId);
        room.callTimerId = null;
    }
    room.phase = 'announce';

    // Populate winner data with user names
    const populatedWinners = await Promise.all(room.winners.map(async (winner) => {
        try {
            const user = await User.findById(winner.userId);
            return {
                ...winner,
                name: user ? `${user.firstName} ${user.lastName}`.trim() : 'Unknown Player',
                cartelaNumber: winner.cartella?.cartelaNumber || winner.cartelaNumber,
                card: winner.cartella, // Send the 5x5 grid directly
                cardNumbers: winner.cartella?.numbers || winner.cardNumbers,
                called: room.calledNumbers
            };
        } catch (error) {
            console.error('Error fetching user for winner:', error);
            return {
                ...winner,
                name: 'Unknown Player',
                cartelaNumber: winner.cartella?.cartelaNumber || winner.cartelaNumber,
                card: winner.cartella, // Send the 5x5 grid directly
                cardNumbers: winner.cartella?.numbers || winner.cardNumbers,
                called: room.calledNumbers
            };
        }
    }));

    console.log('Broadcasting game_finished with winners:', populatedWinners.map(w => ({
        name: w.name,
        cartelaNumber: w.cartelaNumber,
        cardLength: w.card?.length,
        cardNumbersLength: w.cardNumbers?.length
    })));

    broadcast('game_finished', {
        gameId: room.currentGameId,
        winners: populatedWinners,
        calledNumbers: room.calledNumbers,
        called: room.calledNumbers,
        stake: room.stake,
        nextStartAt: Date.now() + 5000
    }, room);

    // Process winnings
    if (room.winners.length > 0) {
        // Calculate pot based on total cartelas selected (not player count)
        // This accounts for players who selected 2 cartelas
        const selectedCount = countSelectedCartelas(room);
        const pot = selectedCount * room.stake;
        const systemCut = Math.floor(pot * 0.2); // 20% system cut
        const prizePool = pot - systemCut;

        // Split prize by unique winners (by userId), not by winning entries.
        // One player with 2 winning cartelas is still one winner and gets full prize.
        const uniqueWinnerIds = [...new Set(room.winners.map(w => w.userId.toString()))];
        const prizePerWinner = Math.floor(prizePool / uniqueWinnerIds.length);

        for (const userId of uniqueWinnerIds) {
            try {
                await WalletService.processGameWin(userId, prizePerWinner);

                // Send wallet update to the winner
                const playerObj = room.players.get(userId);
                const socket = playerObj && playerObj.ws;
                if (socket && socket.readyState === socket.OPEN) {
                    const wallet = await WalletService.getWallet(userId);
                    socket.send(JSON.stringify({
                        type: 'wallet_update',
                        payload: {
                            main: wallet.main,
                            play: wallet.play,
                            source: 'win'
                        }
                    }));
                }
            } catch (error) {
                console.error('Game win processing error:', error);
            }
        }

        // Coin completion gifts removed – no additional rewards for game completion.

        // Update existing game record with final results (only if game was actually played)
        try {
            const existingGame = await Game.findOne({ gameId: room.currentGameId });
            if (existingGame) {
                await Game.findOneAndUpdate(
                    { gameId: room.currentGameId },
                    {
                        players: Array.from(room.selectedPlayers).map(userId => ({ userId })),
                        winners: uniqueWinnerIds.map(userId => ({ userId, prize: prizePerWinner })),
                        calledNumbers: room.calledNumbers,
                        pot,
                        systemCut,
                        prizePool,
                        status: 'finished',
                        finishedAt: new Date()
                    },
                    { new: true }
                );
                console.log(`Game ${room.currentGameId} updated with final results`);
            } else {
                console.log(`Game ${room.currentGameId} was not found in database - it was likely created but never played`);
            }
        } catch (error) {
            console.error('Error updating game record:', error);
        }
    }

    // Reset room after delay, then immediately start a new registration round
    setTimeout(async () => {
        // Keep player connections but reset their per-game state
        room.players.forEach(player => {
            if (player) {
                player.cartella = null;
            }
        });
        room.selectedPlayers.clear();
        room.cartellas.clear();
        room.calledNumbers = [];
        room.winners = [];
        room.startTime = null;
        room.registrationEndTime = null;
        room.gameEndTime = null;
        room.announceProcessed = false; // Reset for next round
        
        console.log('🔄 Room reset for next round:', { roomId: room.id, stake: room.stake, playersCount: room.players.size });
        
        // Start new registration immediately
        await startRegistration(room);
    }, 5000);
}

function getPredefinedCartella(cardNumber) {
    // Card numbers are 1-100, array index is 0-99
    const cardIndex = cardNumber - 1;
    if (cardIndex >= 0 && cardIndex < BingoCards.cards.length) {
        return BingoCards.cards[cardIndex];
    }
    // Fallback to first card if invalid number
    return BingoCards.cards[0];
}

function checkBingo(cartella, calledNumbers) {
    // Safety checks
    if (!cartella || !Array.isArray(cartella) || cartella.length !== 5) {
        return false;
    }
    if (!calledNumbers || !Array.isArray(calledNumbers)) {
        return false;
    }
    
    // Check rows
    for (let i = 0; i < 5; i++) {
        if (!cartella[i] || !Array.isArray(cartella[i])) {
            continue;
        }
        if (cartella[i].every(num => num === 0 || calledNumbers.includes(num))) {
            return true;
        }
    }

    // Check columns
    for (let j = 0; j < 5; j++) {
        if (cartella.every(row => row && Array.isArray(row) && (row[j] === 0 || calledNumbers.includes(row[j])))) {
            return true;
        }
    }

    // Check diagonals
    if (cartella.every((row, i) => row && Array.isArray(row) && (row[i] === 0 || calledNumbers.includes(row[i])))) {
        return true;
    }
    if (cartella.every((row, i) => row && Array.isArray(row) && (row[4 - i] === 0 || calledNumbers.includes(row[4 - i])))) {
        return true;
    }

    // Check four corners
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

// Removed minute-based auto-cycler. Rounds will be chained after each game ends,
// and initial registration will start at server boot.

// WebSocket connection handling
wss.on('connection', async (ws, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token') || '';
    const stakeParam = Number(url.searchParams.get('stake') || '');

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        ws.userId = String(payload.sub);

        console.log('WebSocket JWT Verification Success:', {
            sub: payload.sub,
            userId: ws.userId,
            tokenPreview: token.substring(0, 50) + '...',
            payloadKeys: Object.keys(payload),
            isObjectId: /^[0-9a-fA-F]{24}$/.test(payload.sub),
            isTelegramId: /^\d+$/.test(payload.sub) && payload.sub.length < 15
        });

        // Validate that we have a proper user ID
        if (!payload.sub || payload.sub === 'undefined' || payload.sub === 'null') {
            console.error('Invalid user ID in JWT payload:', payload.sub);
            ws.close(1008, 'Invalid user ID in token');
            return;
        }

    } catch (error) {
        console.log('JWT verification failed:', {
            error: error.message,
            tokenPreview: token ? token.substring(0, 50) + '...' : 'NO_TOKEN',
            tokenLength: token ? token.length : 0,
            jwtSecret: JWT_SECRET ? 'SET' : 'NOT_SET',
            errorType: error.name
        });

        // Send a more helpful error message for expired tokens
        if (error.name === 'TokenExpiredError') {
            ws.close(1008, 'Token expired - please refresh page');
        } else {
            ws.close(1008, 'Invalid token');
        }
        return;
    }

    // Auto-join room based on URL stake param (aligns with frontend behavior)
    if (!Number.isNaN(stakeParam) && stakes.includes(stakeParam)) {
        // Clean up empty rooms
        cleanupEmptyRooms(stakeParam);
        
        const list = getRoomsForStake(stakeParam);
        let room = null;
        
        // Check if user has active game first
        const activeRoom = getActiveGameRoomForUser(ws.userId, stakeParam);
        if (activeRoom) {
            room = activeRoom;
            console.log('🎮 Auto-join: User has active game, returning to game room:', {
                userId: ws.userId,
                roomId: room.id,
                gameId: room.currentGameId
            });
        } else {
            // Find/create registration room
            room = getJoinableRoomForStake(stakeParam);
        if (!room) {
            room = makeRoom(stakeParam);
            list.push(room);
            await startRegistration(room);
            }
        }
        await room.onJoin(ws);
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'join_room') {
                const stake = data.stake || data.payload?.stake;
                console.log('join_room received:', { stake, dataStake: data.stake, payloadStake: data.payload?.stake, userId: ws.userId });

                if (!stake || !stakes.includes(stake)) {
                    console.error('Invalid stake for join_room:', { stake, validStakes: stakes });
                    ws.send(JSON.stringify({
                        type: 'error',
                        payload: { message: 'Invalid stake', validStakes: stakes }
                    }));
                    return;
                }

                // Clean up empty rooms periodically
                cleanupEmptyRooms(stake);

                const list = getRoomsForStake(stake);
                let room = null;

                // NEW BEHAVIOR: Only one room per stake.
                // If a room already exists (running, registration or announce), join that room.
                // Only create a new room when none exists.
                if (list.length > 0) {
                    // Prefer running room, then registration, then announce; but all are the same "single" room in practice.
                    room = list.find(r => r.phase === 'running') ||
                           list.find(r => r.phase === 'registration') ||
                           list.find(r => r.phase === 'announce') ||
                           list[0];
                    console.log('🔗 Joining existing single room for stake:', {
                        userId: ws.userId,
                        roomId: room.id,
                        roomPhase: room.phase,
                        gameId: room.currentGameId
                    });
                } else {
                    // No room yet for this stake – create one and start registration
                    room = makeRoom(stake);
                    list.push(room);
                    await startRegistration(room);
                    console.log('🆕 Created first room for stake and started registration:', {
                        userId: ws.userId,
                        roomId: room.id,
                        roomPhase: room.phase,
                        gameId: room.currentGameId
                    });
                }

                // If user was previously in a different room, leave it
                if (ws.room && ws.room !== room) {
                    console.log('🔄 User switching rooms:', {
                        userId: ws.userId,
                        fromRoom: ws.room.id,
                        toRoom: room.id,
                        fromPhase: ws.room.phase,
                        toPhase: room.phase
                    });
                    ws.room.onLeave(ws);
                }

                console.log('✅ Joining room:', { stake, roomId: room.id, roomPhase: room.phase, gameId: room.currentGameId, userId: ws.userId });
                await room.onJoin(ws);
            } else if (data.type === 'select_card') {
                const room = ws.room;
                const cardNumber = Number(data.cardNumber || data.payload?.cardNumber);
                console.log('select_card received:', { cardNumber, roomPhase: room?.phase, userId: ws.userId });

                if (room && Number.isInteger(cardNumber) && cardNumber >= 1 && cardNumber <= BingoCards.cards.length) {
                    // Ensure player is in room.players (in case they selected card before joining)
                    if (!room.players.has(ws.userId)) {
                        console.log('Player not in room.players, adding them:', ws.userId);
                        room.players.set(ws.userId, { ws, cartella: null, name: 'Player' });
                    }
                    // Only process if we're in registration phase
                    if (room.phase !== 'registration') {
                        console.log('Rejecting selection - not in registration phase:', room.phase);
                        ws.send(JSON.stringify({
                            type: 'selection_rejected',
                            payload: {
                                reason: 'NOT_IN_REGISTRATION',
                                cardNumber,
                                currentPhase: room.phase
                            }
                        }));
                        return;
                    }

                    const selections = room.userCardSelections.get(ws.userId) || [];

                    // Idempotent: clicking an already-selected cartela does nothing
                    if (selections.includes(cardNumber)) {
                        const selectedCount = countSelectedCartelas(room);
                        const selectedPlayersCount = countSelectedPlayers(room);
                        const currentPrizePool = Math.floor(selectedCount * room.stake * 0.8);
                        ws.send(JSON.stringify({
                            type: 'selection_confirmed',
                            payload: {
                                cardNumber,
                                selections,
                                playersCount: selectedPlayersCount,
                                prizePool: currentPrizePool
                            }
                        }));
                        return;
                    }

                    // Max 1 cartela per user
                    if (selections.length >= 1) {
                        ws.send(JSON.stringify({
                            type: 'selection_rejected',
                            payload: { reason: 'LIMIT_REACHED', limit: 1, cardNumber, selections }
                        }));
                        return;
                    }

                    if (room.takenCards.has(cardNumber)) {
                        // Already taken, notify user
                        ws.send(JSON.stringify({ type: 'selection_rejected', payload: { reason: 'TAKEN', cardNumber } }));
                        return;
                    }

                    // Just reserve the spot - no wallet deduction yet
                    const nextSelections = [...selections, cardNumber];
                    room.userCardSelections.set(ws.userId, nextSelections);
                    room.takenCards.add(cardNumber);
                    room.selectedPlayers.add(ws.userId);

                    // Calculate current prize pool (80% of stake × total cartelas)
                    // This accounts for players who selected multiple cartelas
                    const selectedCount = countSelectedCartelas(room);
                    const selectedPlayersCount = countSelectedPlayers(room);
                    const currentPrizePool = Math.floor(selectedCount * room.stake * 0.8);

                    ws.send(JSON.stringify({
                        type: 'selection_confirmed',
                        payload: {
                            cardNumber,
                            selections: nextSelections,
                            playersCount: selectedPlayersCount,
                            prizePool: currentPrizePool
                        }
                    }));

                    // Broadcast updates to all players
                    broadcast('players_update', {
                        playersCount: selectedPlayersCount,
                        prizePool: currentPrizePool
                    }, room);
                    broadcast('registration_update', {
                        takenCards: Array.from(room.takenCards),
                        prizePool: currentPrizePool
                    }, room);
                }
            } else if (data.type === 'deselect_card') {
                const room = ws.room;
                const cardNumber = Number(data.cardNumber || data.payload?.cardNumber);
                console.log('deselect_card received:', { cardNumber, roomPhase: room?.phase, userId: ws.userId });

                if (room && room.phase === 'registration') {
                    const currentSelections = room.userCardSelections.get(ws.userId) || [];
                    if (currentSelections.length > 0) {
                        // Remove specific card if provided; else clear all
                        const toRemove = Number.isInteger(cardNumber) && cardNumber > 0 ? cardNumber : null;
                        const nextSelections = toRemove
                            ? currentSelections.filter(n => Number(n) !== Number(toRemove))
                            : [];

                        const removed = toRemove
                            ? currentSelections.find(n => Number(n) === Number(toRemove)) ?? null
                            : null;

                        // Update takenCards
                        if (toRemove) {
                            room.takenCards.delete(toRemove);
                        } else {
                            currentSelections.forEach(n => room.takenCards.delete(n));
                        }

                        // Update selection map / selectedPlayers membership
                        if (nextSelections.length === 0) {
                            room.userCardSelections.delete(ws.userId);
                            room.selectedPlayers.delete(ws.userId);
                        } else {
                            room.userCardSelections.set(ws.userId, nextSelections);
                        }

                        // Recompute prize pool after removing player
                        const selectedCount = countSelectedCartelas(room);
                        const selectedPlayersCount = countSelectedPlayers(room);
                        const currentPrizePool = Math.floor(selectedCount * room.stake * 0.8);

                        // Notify the user
                        ws.send(JSON.stringify({
                            type: 'selection_cleared',
                            payload: {
                                removedCard: removed,
                                selections: nextSelections,
                                playersCount: selectedPlayersCount,
                                prizePool: currentPrizePool
                            }
                        }));

                        // Broadcast updates to all players
                        broadcast('players_update', {
                            playersCount: selectedPlayersCount,
                            prizePool: currentPrizePool
                        }, room);
                        broadcast('registration_update', {
                            takenCards: Array.from(room.takenCards),
                            prizePool: currentPrizePool
                        }, room);
                    } else {
                        // Nothing to clear; reply benignly
                        const selectedCount = countSelectedCartelas(room);
                        const selectedPlayersCount = countSelectedPlayers(room);
                        ws.send(JSON.stringify({ type: 'selection_cleared', payload: { removedCard: null, selections: [], playersCount: selectedPlayersCount, prizePool: Math.floor(selectedCount * room.stake * 0.8) } }));
                    }
                } else {
                    // Not in registration; ignore
                    ws.send(JSON.stringify({ type: 'selection_rejected', payload: { reason: 'NOT_IN_REGISTRATION' } }));
                }
            } else if (data.type === 'bingo_claim' || data.type === 'claim_bingo') {
                const room = ws.room;
                if (room && room.phase === 'running') {
                    const cartellasByNumber = room.cartellas.get(ws.userId);
                    const entries = cartellasByNumber instanceof Map
                        ? Array.from(cartellasByNumber.entries()).map(([cartelaNumber, cartella]) => ({ cartelaNumber, cartella }))
                        : [];

                    // Accept if any of the user's cartellas has bingo (based on called numbers only)
                    const winning = entries.find(e => e.cartella && checkBingo(e.cartella, room.calledNumbers));
                    if (winning) {
                        room.winners.push({ userId: ws.userId, cartelaNumber: winning.cartelaNumber, cartella: winning.cartella });
                        // Send bingo_accepted event to all players
                        broadcast('bingo_accepted', {
                            gameId: room.currentGameId,
                            winners: room.winners,
                            calledNumbers: room.calledNumbers,
                            called: room.calledNumbers
                        }, room);
                        // Schedule announce after short delay so clients have time
                        // to show \"Bingo accepted\" before moving to results.
                        scheduleAnnounce(room, 'bingo_claim_accepted');
                    } else {
                        // Invalid claim: user does not have a valid winning pattern. Punish by notifying client to clear manual marks.
                        if (ws.readyState === 1) {
                            ws.send(JSON.stringify({
                                type: 'bingo_rejected',
                                payload: {
                                    gameId: room.currentGameId,
                                    reason: 'invalid_claim'
                                }
                            }));
                        }
                    }
                }
            }
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('close', () => {
        if (ws.room) {
            ws.room.onLeave(ws);
        }
    });
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 WebSocket available at ws://localhost:${PORT}/ws`);

    // Signal PM2 that the app is ready
    if (typeof process.send === 'function') {
        process.send('ready');
    }

    // Initialize rooms with registration phase active
    stakes.forEach(async (stake) => {
        try {
            const list = getRoomsForStake(stake);
            if (list.length === 0) {
                list.push(makeRoom(stake));
            }
            const room = list[0];
            // Start registration immediately
            await startRegistration(room);
        } catch (error) {
            console.error(`Error initializing room for stake ${stake}:`, error);
        }
    });

    // Periodic cleanup of empty rooms (every 30 seconds)
    setInterval(() => {
        stakes.forEach(stake => {
            cleanupEmptyRooms(stake);
        });
    }, 30000);
});

// Start Telegram bot (guarded by RUN_TELEGRAM_BOT)
if (process.env.RUN_TELEGRAM_BOT === 'true') {
    if (BOT_TOKEN) {
        const { startTelegramBot } = require('./telegram/bot');
        startTelegramBot({ BOT_TOKEN, WEBAPP_URL });
    } else {
        console.log('⚠️  BOT_TOKEN not set. Telegram bot is disabled.');
    }
} else {
    console.log('🤖 Telegram bot startup skipped (RUN_TELEGRAM_BOT != "true").');
}

} catch (error) {
    console.error('❌ Fatal error during startup:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
}
