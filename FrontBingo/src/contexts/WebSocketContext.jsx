import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../lib/auth/AuthProvider';

const WebSocketContext = createContext();

export function WebSocketProvider({ children }) {
    const { sessionId } = useAuth();
    const wsRef = useRef(null);
    const [connected, setConnected] = useState(false);

    // Require real sessionId - no fallback allowed
    const safeSessionId = sessionId;
    const [gameState, setGameState] = useState({
        phase: 'waiting',
        gameId: null,
        playersCount: 0,
        prizePool: 0,
        calledNumbers: [],
        currentNumber: null,
        takenCards: [],
        yourSelections: [],
        yourCards: [], // [{ cardNumber, card }]
        countdown: 0,
        registrationEndTime: null,
        winners: [],
        walletUpdate: null,
        nextRegistrationStart: null
    });
    const [lastEvent, setLastEvent] = useState(null);
    const [currentStake, setCurrentStake] = useState(null);
    const [messageCount, setMessageCount] = useState(0);
    const [pendingGameStart, setPendingGameStart] = useState(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const rejoinScheduledRef = useRef(false);

    const send = useCallback((type, payload) => {
        const ws = wsRef.current;
        const message = JSON.stringify({ type, payload });
        console.log('WebSocket send:', { type, payload, connected, readyState: ws?.readyState });

        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(message);
                console.log('Message sent successfully:', { type, payload });
                return true;
            } catch (error) {
                console.error('Error sending message:', error);
                return false;
            }
        } else {
            console.warn('WebSocket not ready, message not sent:', { type, payload, readyState: ws?.readyState });
            return false;
        }
    }, [connected]);

    // Countdown timer effect
    useEffect(() => {
        let intervalId = null;

        if (gameState.phase === 'registration' && gameState.registrationEndTime) {
            intervalId = setInterval(() => {
                const now = Date.now();
                const endTime = gameState.registrationEndTime;
                const remainingSeconds = Math.max(0, Math.ceil((endTime - now) / 1000));

                setGameState(prev => ({
                    ...prev,
                    countdown: remainingSeconds
                }));

                // Auto-close registration when time runs out
                if (remainingSeconds <= 0) {
                    clearInterval(intervalId);
                }
            }, 1000);
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [gameState.phase, gameState.registrationEndTime]);

    // Connect to WebSocket immediately when user is authenticated (for general connection)
    const connectGeneral = useCallback(() => {
        console.log('🔍 WebSocket connectGeneral called:', {
            safeSessionId: safeSessionId ? 'PRESENT' : 'MISSING',
            sessionIdLength: safeSessionId?.length || 0,
            timestamp: new Date().toISOString()
        });

        if (!safeSessionId) {
            console.log('❌ WebSocket general connection skipped - missing sessionId');
            return;
        }

        // If already connected, don't reconnect
        if (connected && wsRef.current?.readyState === WebSocket.OPEN) {
            console.log('Already connected to general WebSocket');
            return;
        }

        // Prevent multiple simultaneous connections
        if (isConnecting) {
            console.log('General connection already in progress, skipping');
            return;
        }

        // Close existing connection
        if (wsRef.current) {
            console.log('Closing existing connection for general connection');
            wsRef.current.close();
            wsRef.current = null;
            setConnected(false);
        }

        console.log('Connecting to general WebSocket');

        let stopped = false;
        let connecting = false;
        let retry = 0;
        let heartbeat = null;

        const connect = () => {
            if (connecting || stopped) {
                console.log('General WebSocket connection skipped - already connecting or stopped');
                return;
            }

            connecting = true;
            setIsConnecting(true);

            // No timeout - require real WebSocket connection
            const wsBase = import.meta.env.VITE_WS_URL ||
                (window.location.hostname === 'localhost' ? 'ws://localhost:3001' :
                    'wss://fikirbingo.com');
            const wsUrl = `${wsBase}/ws?token=${safeSessionId}`;
            console.log('Connecting to general WebSocket:', wsUrl);

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('✅ General WebSocket connected successfully');
                setConnected(true);
                setIsConnecting(false);
                connecting = false;
                retry = 0;

                // Start heartbeat
                heartbeat = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, 30000);

                // Auto-join current stake room if selected
                if (currentStake) {
                    try {
                        console.log('Joining room after connect:', { stake: currentStake });
                        ws.send(JSON.stringify({ type: 'join_room', payload: { stake: currentStake } }));
                    } catch (e) {
                        console.warn('Failed to send join_room on open', e);
                    }
                }
            };

            ws.onmessage = (e) => {
                try {
                    setMessageCount(prev => prev + 1);
                    console.log('WS message received:', e.data);
                    const event = JSON.parse(e.data);
                    setLastEvent(event);

                    // Special logging for critical events
                    if (['game_finished', 'registration_open', 'game_started'].includes(event.type)) {
                        console.log(`🔥 CRITICAL EVENT: ${event.type}`, {
                            phase: event.payload?.phase || 'unknown',
                            gameId: event.payload?.gameId,
                            playersCount: event.payload?.playersCount,
                            timestamp: new Date().toISOString()
                        });
                    }

                    switch (event.type) {
                        case 'pong':
                            // Heartbeat
                            break;

                        case 'general_update':
                            setGameState(prev => ({
                                ...prev,
                                ...event.payload
                            }));
                            break;

                        case 'snapshot': {
                            setGameState(prev => {
                                const snapshotPhase = event.payload.phase || 'waiting';
                                const snapshotGameId = event.payload.gameId;
                                
                                // If we're in a running game with cards, completely ignore snapshots for different gameIds
                                const isCurrentlyRunning = prev.phase === 'running';
                                const hasCards = Array.isArray(prev.yourCards) && prev.yourCards.length > 0;
                                const isSameGame = prev.gameId === snapshotGameId;
                                
                                // Completely ignore snapshot if we're running with cards and it's for a different game
                                if (isCurrentlyRunning && hasCards && !isSameGame) {
                                    console.log('📸 Snapshot IGNORED - running game with cards, different gameId:', {
                                        snapshotGameId,
                                        currentGameId: prev.gameId,
                                        currentPhase: prev.phase,
                                        snapshotPhase
                                    });
                                    return prev; // Don't update anything
                                }
                                
                                // Otherwise, process the snapshot normally
                                const phase = snapshotPhase;
                                const gameId = snapshotGameId;
                                
                                const registrationEndTime = event.payload.nextStartAt || event.payload.registrationEndTime;
                                const remainingSeconds = registrationEndTime ? Math.max(0, Math.ceil((registrationEndTime - Date.now()) / 1000)) : 0;
                                
                                console.log('📸 Snapshot processed:', {
                                    snapshotPhase,
                                    snapshotGameId,
                                    currentPhase: prev.phase,
                                    currentGameId: prev.gameId,
                                    isCurrentlyRunning,
                                    hasCards,
                                    isSameGame,
                                    finalPhase: phase,
                                    finalGameId: gameId
                                });
                                
                                return {
                                    ...prev,
                                    ...event.payload,
                                    phase,
                                    gameId,
                                    playersCount: event.payload.playersCount || 0,
                                    prizePool: event.payload.prizePool || 0,
                                    calledNumbers: event.payload.calledNumbers || event.payload.called || [],
                                    takenCards: event.payload.takenCards || [],
                                    yourSelections: event.payload.yourSelections || [],
                                    countdown: phase === 'registration' ? remainingSeconds : (event.payload.countdown || 0),
                                    registrationEndTime,
                                    ...(phase === 'registration' ? {
                                        yourCards: [],
                                        yourSelections: [],
                                        calledNumbers: [],
                                        currentNumber: null,
                                        winners: []
                                    } : {})
                                };
                            });
                            break;
                        }

                        case 'registration_open': {
                            const registrationEndTime = event.payload.endsAt;
                            const remainingSeconds = registrationEndTime ? Math.max(0, Math.ceil((registrationEndTime - Date.now()) / 1000)) : 0;
                            setGameState(prev => ({
                                ...prev,
                                phase: 'registration',
                                gameId: event.payload.gameId,
                                playersCount: event.payload.playersCount || 0,
                                countdown: remainingSeconds,
                                registrationEndTime,
                                yourCards: [],
                                yourSelections: [],
                                calledNumbers: [],
                                currentNumber: null,
                                winners: [],
                                takenCards: event.payload.takenCards || [],
                                availableCards: event.payload.availableCards || [],
                                prizePool: 0
                            }));
                            break;
                        }

                        case 'game_started':
                            console.log('🎮 game_started received:', {
                                gameId: event.payload.gameId,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool,
                                cardsCount: event.payload.cards?.length || 0,
                                cards: event.payload.cards
                            });
                            setGameState(prev => {
                                const newState = {
                                    ...prev,
                                    phase: 'running', // Keep 'running' to match App.jsx and CartelaSelection.jsx
                                    gameId: event.payload.gameId,
                                    playersCount: event.payload.playersCount,
                                    prizePool: event.payload.prizePool,
                                    calledNumbers: event.payload.calledNumbers || event.payload.called || [],
                                    yourCards: event.payload.cards || [],
                                };
                                console.log('🎮 Game state updated to running:', {
                                    gameId: newState.gameId,
                                    phase: newState.phase,
                                    cardsCount: newState.yourCards?.length || 0
                                });
                                return newState;
                            });
                            setPendingGameStart(null);
                            break;

                        case 'number_called':
                            setGameState(prev => ({
                                ...prev,
                                currentNumber: event.payload.number,
                                calledNumbers: event.payload.calledNumbers || event.payload.called || []
                            }));
                            break;

                        case 'players_update':
                            setGameState(prev => ({
                                ...prev,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool
                            }));
                            break;

                        case 'registration_update':
                            setGameState(prev => ({
                                ...prev,
                                takenCards: event.payload.takenCards || [],
                                prizePool: event.payload.prizePool
                            }));
                            break;

                        case 'selection_confirmed':
                            setGameState(prev => ({
                                ...prev,
                                yourSelections: event.payload.selections || prev.yourSelections || [],
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool
                            }));
                            break;

                        case 'card_selected':
                        case 'select_card':
                            setGameState(prev => ({
                                ...prev,
                                yourSelections: event.payload.selections || prev.yourSelections || [],
                                takenCards: event.payload.takenCards || prev.takenCards,
                                playersCount: event.payload.playersCount || prev.playersCount
                            }));
                            break;

                        case 'selection_cleared':
                            setGameState(prev => ({
                                ...prev,
                                yourSelections: event.payload.selections || [],
                                playersCount: event.payload.playersCount ?? prev.playersCount,
                                prizePool: event.payload.prizePool ?? prev.prizePool
                            }));
                            break;

                        case 'bingo_accepted':
                            setGameState(prev => ({
                                ...prev,
                                winners: event.payload.winners || [],
                                phase: 'announce'
                            }));
                            break;

                        case 'game_finished':
                        case 'game_ended':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'announce',
                                winners: (event.payload && (event.payload.winners || event.payload.winner || [])) || prev.winners || [],
                                calledNumbers: (event.payload && (event.payload.calledNumbers || event.payload.called)) || prev.calledNumbers,
                                currentNumber: null,
                                yourCards: [],
                                yourSelections: [],
                                nextRegistrationStart: event.payload?.nextStartAt || null // Store when next registration will start
                            }));
                            // Do not auto-rejoin immediately here. We'll rejoin when:
                            // 1) Backend opens registration (we receive snapshot/registration_open), or
                            // 2) User navigates to cartella selection screen.
                            break;

                        case 'wallet_update':
                            setGameState(prev => ({
                                ...prev,
                                walletUpdate: {
                                    main: event.payload.main,
                                    play: event.payload.play,
                                    coins: event.payload.coins,
                                    source: event.payload.source
                                }
                            }));
                            window.dispatchEvent(new CustomEvent('walletUpdate', { detail: event }));
                            break;

                        default:
                            console.log('Unhandled WS event:', event.type);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            ws.onclose = (event) => {
                console.log('General WebSocket closed:', event.code, event.reason);
                setConnected(false);
                setIsConnecting(false);
                connecting = false;

                if (heartbeat) {
                    clearInterval(heartbeat);
                    heartbeat = null;
                }

                // Auto-reconnect with exponential backoff
                if (!stopped && retry < 5) {
                    const delay = Math.min(1000 * Math.pow(2, retry), 30000);
                    console.log(`Reconnecting general WebSocket in ${delay}ms (attempt ${retry + 1})`);
                    setTimeout(() => {
                        retry++;
                        connect();
                    }, delay);
                }
            };

            ws.onerror = (error) => {
                console.error('❌ General WebSocket error:', error);
                console.error('WebSocket error details:', {
                    readyState: ws.readyState,
                    url: wsUrl,
                    sessionId: sessionId ? 'present' : 'missing',
                    timestamp: new Date().toISOString()
                });
                setIsConnecting(false);
                connecting = false;

                // WebSocket failed - app will show connection error
                console.log('⚠️ WebSocket connection failed - app requires real connection');

                // Set a timeout to retry connection if it fails
                setTimeout(() => {
                    if (!stopped && !connected) {
                        console.log('🔄 Retrying WebSocket connection after error...');
                        connect();
                    }
                }, 5000);
            };
        };

        connect();

        return () => {
            stopped = true;
            if (heartbeat) {
                clearInterval(heartbeat);
            }
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [safeSessionId]);

    // Connect to stake by joining the room on the existing unified socket
    const connectToStake = useCallback((stake) => {
        console.log('🎯 WebSocket connectToStake called:', {
            stake,
            safeSessionId: safeSessionId ? 'PRESENT' : 'MISSING',
            sessionIdLength: safeSessionId?.length || 0,
            timestamp: new Date().toISOString()
        });

        if (!safeSessionId || !stake) {
            console.log('❌ WebSocket join skipped - missing sessionId or stake:', { sessionId: safeSessionId, stake });
            return;
        }

        const isSameStake = currentStake === stake;

        // Reset game state when switching stakes; if same stake, don't nuke state
        if (!isSameStake) {
            setGameState({
                phase: 'waiting',
                gameId: null,
                playersCount: 0,
                prizePool: 0,
                calledNumbers: [],
                currentNumber: null,
                takenCards: [],
                    yourSelections: [],
                    yourCards: [],
                countdown: 0,
                registrationEndTime: null,
                winners: [],
                walletUpdate: null,
                nextRegistrationStart: null
            });
            setCurrentStake(stake);
        }

        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                console.log(isSameStake
                    ? 'Rejoining same stake room over unified connection:'
                    : 'Sending join_room over unified connection:', { stake });
                ws.send(JSON.stringify({ type: 'join_room', payload: { stake } }));
            } catch (e) {
                console.warn('Failed to send join_room', e);
            }
        } else {
            console.log('Socket not open; will auto-join on connect');
        }
    }, [safeSessionId, currentStake]);

    // Debug connection state
    useEffect(() => {
        console.log('WebSocket state changed:', {
            connected,
            currentStake,
            readyState: wsRef.current?.readyState,
            OPEN: WebSocket.OPEN
        });
    }, [connected, currentStake]);

    // Connect immediately when sessionId is available
    useEffect(() => {
        if (sessionId && !connected && !isConnecting) {
            console.log('SessionId available, connecting to general WebSocket');
            connectGeneral();
        }
    }, [sessionId, connected, isConnecting]);

    // Keep general connection alive during navigation
    useEffect(() => {
        if (sessionId && connected && !currentStake) {
            console.log('Maintaining general WebSocket connection during navigation');
        }
    }, [sessionId, connected, currentStake]);

    // Disconnect when component unmounts or sessionId changes
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, []);

    const selectCartella = useCallback((cardNumber) => {
        return send('select_card', { cardNumber });
    }, [send]);

    const deselectCartella = useCallback((cardNumber) => {
        return send('deselect_card', { cardNumber });
    }, [send]);

    const claimBingo = useCallback(() => {
        return send('bingo_claim', {});
    }, [send]);

    // Countdown timer effect
    useEffect(() => {
        if (gameState.phase !== 'registration' || !gameState.registrationEndTime) return;

        const interval = setInterval(() => {
            setGameState(prev => {
                if (prev.phase === 'registration' && prev.registrationEndTime) {
                    const remaining = Math.max(0, Math.ceil((prev.registrationEndTime - Date.now()) / 1000));
                    return { ...prev, countdown: remaining };
                }
                return prev;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [gameState.phase, gameState.registrationEndTime]);

    // Debug connection state
    useEffect(() => {
        console.log('WebSocket Context State:', {
            connected,
            currentStake,
            readyState: wsRef.current?.readyState,
            gameState: {
                phase: gameState.phase,
                gameId: gameState.gameId,
                playersCount: gameState.playersCount
            }
        });
    }, [connected, currentStake, gameState.phase, gameState.gameId, gameState.playersCount]);

    const value = {
        connected,
        gameState,
        lastEvent,
        currentStake,
        connectToStake,
        connectGeneral,
        selectCartella,
        deselectCartella,
        claimBingo,
        send,
        // Debug info
        wsReadyState: wsRef.current?.readyState,
        isConnecting: isConnecting || wsRef.current?.readyState === WebSocket.CONNECTING,
        messageCount
    };

    return (
        <WebSocketContext.Provider value={value}>
            {children}
        </WebSocketContext.Provider>
    );
}

export function useWebSocket() {
    const context = useContext(WebSocketContext);
    if (!context) {
        throw new Error('useWebSocket must be used within a WebSocketProvider');
    }
    return context;
}
