import { useEffect, useRef, useState, useCallback } from 'react';

export function useUnifiedWebSocket(stake, sessionId) {
    const wsRef = useRef(null);
    const [connected, setConnected] = useState(false);
    const [gameState, setGameState] = useState({
        phase: 'waiting',
        gameId: null,
        playersCount: 0,
        prizePool: 0,
        calledNumbers: [],
        currentNumber: null,
        takenCards: [],
        yourSelection: null,
        countdown: 0,
        registrationEndTime: null,
        isWatchMode: false,
        winners: []
    });
    const [lastEvent, setLastEvent] = useState(null);

    const send = useCallback((type, payload) => {
        const ws = wsRef.current;
        const message = JSON.stringify({ type, payload });
        console.log('Unified WebSocket send:', { type, payload, connected, readyState: ws?.readyState });

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

    useEffect(() => {
        if (!stake || !sessionId) {
            console.log('Unified WebSocket connection skipped - missing stake or sessionId:', { stake, sessionId });
            return;
        }

        let stopped = false;
        let connecting = false;
        let retry = 0;
        let heartbeat = null;
        let hasJoinedRoom = false;

        const connect = () => {
            if (connecting || stopped) {
                console.log('WebSocket connection skipped - already connecting or stopped');
                return;
            }

            connecting = true;
            const wsBase = import.meta.env.VITE_WS_URL ||
                (window.location.hostname === 'localhost' ? 'ws://localhost:3001' :
                    'wss://fikirbingo.com');
            const wsUrl = `${wsBase}/ws?token=${sessionId}&stake=${stake}`;
            console.log('Connecting to Unified WebSocket:', wsUrl);

            // Close existing connection if any
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('Unified WebSocket connected');
                setConnected(true);
                connecting = false;
                retry = 0;

                // Join the room immediately
                if (!hasJoinedRoom) {
                    console.log('Sending join_room message:', { stake });
                    ws.send(JSON.stringify({ type: 'join_room', payload: { stake } }));
                    hasJoinedRoom = true;
                }
            };

            ws.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data);
                    console.log('Unified WebSocket event received:', event.type, event.payload);
                    setLastEvent(event);

                    // Handle different event types
                    switch (event.type) {
                        case 'snapshot':
                            setGameState(prev => {
                                const phase = event.payload.phase;
                                const registrationEndTime = (phase === 'registration') ? (event.payload.nextStartAt || null) : null;
                                const remainingSeconds = registrationEndTime ? Math.max(0, Math.ceil((registrationEndTime - Date.now()) / 1000)) : prev.countdown;

                                // Don't override phase if game is already running
                                const finalPhase = (prev.phase === 'running') ? prev.phase : phase;

                                return ({
                                    ...prev,
                                    phase: finalPhase,
                                    gameId: event.payload.gameId,
                                    playersCount: event.payload.playersCount,
                                    takenCards: event.payload.takenCards || [],
                                    yourSelection: event.payload.yourSelection,
                                    prizePool: event.payload.prizePool || 0,
                                    calledNumbers: event.payload.calledNumbers || [],
                                    isWatchMode: event.payload.isWatchMode || false,
                                    countdown: (phase === 'registration') ? remainingSeconds : prev.countdown,
                                    registrationEndTime: registrationEndTime
                                });
                            });
                            break;

                        case 'registration_open':
                            const endTime = event.payload.endsAt;
                            const remainingSeconds = Math.ceil((endTime - Date.now()) / 1000);
                            console.log('Registration opened:', { endTime, remainingSeconds, endsAt: event.payload.endsAt });
                            setGameState(prev => ({
                                ...prev,
                                phase: 'registration',
                                gameId: event.payload.gameId,
                                playersCount: event.payload.playersCount,
                                countdown: remainingSeconds,
                                registrationEndTime: endTime,
                                // Clear all previous game data
                                yourCard: null,
                                yourCardNumber: null,
                                yourSelection: null,
                                calledNumbers: [],
                                currentNumber: null,
                                winners: [],
                                takenCards: event.payload.takenCards || [],
                                availableCards: event.payload.availableCards || []
                            }));
                            break;

                        case 'registration_closed':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'starting'
                            }));
                            break;

                        case 'game_started':
                            console.log('Game started event received:', event.payload);
                            setGameState(prev => ({
                                ...prev,
                                phase: 'running',
                                gameId: event.payload.gameId,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool,
                                calledNumbers: event.payload.calledNumbers || [],
                                currentNumber: null,
                                yourCard: event.payload.card,
                                yourCardNumber: event.payload.cardNumber
                            }));
                            break;

                        case 'number_called':
                            setGameState(prev => ({
                                ...prev,
                                calledNumbers: [...prev.calledNumbers, event.payload.number],
                                currentNumber: event.payload.number
                            }));
                            break;

                        case 'game_finished':
                        case 'game_ended':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'announce',
                                winners: (event.payload && (event.payload.winners || event.payload.winner || [])) || prev.winners || [],
                                calledNumbers: (event.payload && (event.payload.calledNumbers || event.payload.called)) || prev.calledNumbers,
                                currentNumber: null
                            }));
                            break;

                        case 'bingo_accepted':
                            setGameState(prev => ({
                                ...prev,
                                winners: event.payload.winners || []
                            }));
                            break;

                        case 'selection_confirmed':
                            setGameState(prev => ({
                                ...prev,
                                yourSelection: event.payload.cardNumber,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool || 0
                            }));
                            break;

                        case 'selection_rejected':
                            console.warn('Selection rejected:', event.payload);
                            break;

                        case 'players_update':
                            setGameState(prev => ({
                                ...prev,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool || prev.prizePool
                            }));
                            break;

                        case 'registration_update':
                            setGameState(prev => ({
                                ...prev,
                                takenCards: event.payload.takenCards || prev.takenCards,
                                prizePool: event.payload.prizePool || prev.prizePool
                            }));
                            break;

                        case 'game_cancelled':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'registration',
                                gameId: null,
                                playersCount: 0,
                                yourSelection: null,
                                calledNumbers: [],
                                currentNumber: null,
                                winners: []
                            }));
                            break;

                        case 'error':
                            console.error('WebSocket error:', event.payload);
                            break;

                        case 'pong':
                            // Heartbeat response
                            break;

                        default:
                            console.log('Unhandled WebSocket event:', event.type, event.payload);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            ws.onclose = (event) => {
                console.log('Unified WebSocket closed:', event.code, event.reason);
                setConnected(false);
                connecting = false;
                hasJoinedRoom = false;

                if (heartbeat) {
                    clearInterval(heartbeat);
                    heartbeat = null;
                }

                // If token is invalid (1008), don't retry - user needs to refresh
                if (event.code === 1008) {
                    console.error('WebSocket authentication failed - token may be expired. Please refresh the page.');
                    stopped = true; // Stop all retries
                    return;
                }

                // Only retry if not stopped and within retry limit
                if (!stopped && retry < 3) {
                    const delay = Math.min(1000 * Math.pow(2, retry), 5000);
                    retry += 1;
                    console.log(`Retrying Unified WebSocket connection in ${delay}ms (attempt ${retry}/3)`);
                    setTimeout(() => {
                        if (!stopped) {
                            connect();
                        }
                    }, delay);
                } else if (retry >= 3) {
                    console.error('Max Unified WebSocket retry attempts reached. Connection will not be retried.');
                }
            };

            ws.onerror = (error) => {
                console.error('Unified WebSocket error:', error);
                connecting = false;
            };

            // Start heartbeat keepalive every 20s
            heartbeat = setInterval(() => {
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping', payload: { ts: Date.now() } }));
                    }
                } catch (_) { }
            }, 20000);
        };

        connect();

        return () => {
            stopped = true;
            connecting = false;
            hasJoinedRoom = false;
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            if (heartbeat) {
                clearInterval(heartbeat);
                heartbeat = null;
            }
        };
    }, [stake, sessionId]);

    // Countdown effect - decrement every second when in registration phase
    useEffect(() => {
        if (gameState.phase !== 'registration') return;

        const interval = setInterval(() => {
            setGameState(prev => {
                if (prev.registrationEndTime) {
                    const remaining = Math.max(0, Math.ceil((prev.registrationEndTime - Date.now()) / 1000));
                    return { ...prev, countdown: remaining };
                }
                return prev;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [gameState.phase, gameState.registrationEndTime]);

    const selectCartella = useCallback((cardNumber) => {
        console.log('selectCartella called:', {
            cardNumber,
            connected,
            gamePhase: gameState.phase,
            wsReady: wsRef.current?.readyState === WebSocket.OPEN
        });

        if (!connected || wsRef.current?.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected - cannot select cartella');
            return false;
        }

        if (gameState.phase !== 'registration') {
            console.error('Game not in registration phase:', gameState.phase);
            return false;
        }

        console.log('Sending select_card message:', { cardNumber });
        const success = send('select_card', { cardNumber });
        return success;
    }, [connected, gameState.phase, send]);

    const claimBingo = useCallback(() => {
        console.log('claimBingo called:', { connected, gamePhase: gameState.phase });

        if (!connected || wsRef.current?.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected - cannot claim bingo');
            return false;
        }

        if (gameState.phase !== 'running') {
            console.error('Game not in running phase:', gameState.phase);
            return false;
        }

        console.log('Sending bingo_claim message');
        const success = send('bingo_claim', {});
        return success;
    }, [connected, gameState.phase, send]);

    return {
        connected,
        gameState,
        lastEvent,
        selectCartella,
        claimBingo,
        send
    };
}
