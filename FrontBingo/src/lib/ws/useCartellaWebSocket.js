import { useEffect, useRef, useState, useCallback } from 'react';

export function useCartellaWebSocket(stake, sessionId) {
    const wsRef = useRef(null);
    const [connected, setConnected] = useState(false);
    const [gameState, setGameState] = useState({
        phase: 'registration',
        gameId: null,
        playersCount: 0,
        countdown: 60,
        takenCards: [],
        prizePool: 0,
        yourSelection: null,
        registrationEndTime: null
    });
    const [lastEvent, setLastEvent] = useState(null);

    const send = useCallback((type, payload) => {
        const ws = wsRef.current;
        const message = JSON.stringify({ type, payload });
        console.log('WebSocket send attempt:', {
            type,
            payload,
            readyState: ws?.readyState,
            wsExists: !!ws
        });

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
            console.warn('WebSocket not ready, message not sent:', {
                type,
                payload,
                readyState: ws?.readyState
            });
            return false;
        }
    }, []); // No dependencies - this prevents re-creation

    useEffect(() => {
        if (!stake || !sessionId) {
            console.log('WebSocket connection skipped - missing stake or sessionId:', { stake, sessionId });
            return;
        }

        let stopped = false;
        let retry = 0;
        let heartbeat = null;
        let connecting = false;
        let hasJoinedRoom = false;

        const connect = () => {
            if (connecting || stopped) {
                console.log('Connection already in progress or stopped, skipping...');
                return;
            }

            // Close existing connection if any
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            connecting = true;
            hasJoinedRoom = false;

            const wsBase = import.meta.env.VITE_WS_URL ||
                (window.location.hostname === 'localhost' ? 'ws://localhost:3001' :
                    'wss://fikirbingo.com');
            const wsUrl = `${wsBase}/ws?token=${sessionId}&stake=${stake}`;
            console.log('Connecting to WebSocket:', wsUrl);
            console.log('Session ID:', sessionId);
            console.log('Stake:', stake);

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('Cartella WebSocket connected successfully');
                setConnected(true);
                retry = 0;
                connecting = false;

                // Join the room for this stake - but only once per connection
                if (!hasJoinedRoom) {
                    console.log('Joining room with stake:', stake);
                    hasJoinedRoom = true;
                    setTimeout(() => {
                        if (ws.readyState === WebSocket.OPEN && !stopped) {
                            ws.send(JSON.stringify({ type: 'join_room', payload: { stake } }));
                        }
                    }, 100); // Small delay to ensure connection is stable
                }
            };

            ws.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data);
                    console.log('Cartella WebSocket event:', event.type, event.payload);

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
                                    registrationEndTime,
                                    countdown: (phase === 'registration') ? remainingSeconds : prev.countdown
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
                                takenCards: event.payload.takenCards || [],
                                prizePool: event.payload.prizePool || 0,
                                registrationEndTime: endTime,
                                countdown: Math.max(0, remainingSeconds)
                            }));
                            break;

                        case 'registration_update':
                            setGameState(prev => ({
                                ...prev,
                                takenCards: event.payload.takenCards || [],
                                prizePool: event.payload.prizePool || 0
                            }));
                            break;

                        case 'players_update':
                            setGameState(prev => ({
                                ...prev,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool || 0
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

                        case 'game_started':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'running',
                                gameId: event.payload.gameId,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool
                            }));
                            break;

                        case 'registration_closed':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'starting'
                            }));
                            break;

                        case 'game_cancelled':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'registration',
                                gameId: null,
                                playersCount: 0,
                                yourSelection: null
                            }));
                            break;
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            ws.onclose = (event) => {
                console.log('Cartella WebSocket closed:', event.code, event.reason);
                console.log('Close code meanings:');
                console.log('- 1006: Abnormal closure (connection lost)');
                console.log('- 1008: Policy violation (invalid token)');
                console.log('- 1011: Server error');
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
                if (!stopped && retry < 3) { // Reduced retries to prevent spam
                    const delay = Math.min(1000 * Math.pow(2, retry), 5000); // Max 5 second delay
                    retry += 1;
                    console.log(`Retrying WebSocket connection in ${delay}ms (attempt ${retry}/3)`);
                    setTimeout(() => {
                        if (!stopped) {
                            connect();
                        }
                    }, delay);
                } else if (retry >= 3) {
                    console.error('Max WebSocket retry attempts reached. Connection will not be retried.');
                }
            };

            ws.onerror = (error) => {
                console.error('Cartella WebSocket error:', error);
                console.error('WebSocket URL:', wsUrl);
                console.error('WebSocket readyState:', ws.readyState);
                setConnected(false);
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
    }, [stake, sessionId]); // Removed 'send' from dependencies - this was the main cause of the loop

    // Countdown effect - decrement every second when in registration phase
    useEffect(() => {
        if (gameState.phase !== 'registration') return;

        const interval = setInterval(() => {
            setGameState(prev => {
                if (prev.phase === 'registration') {
                    // Calculate countdown based on registration end time
                    const now = Date.now();
                    const endTime = prev.registrationEndTime || (now + 60000);
                    const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));

                    if (remaining === 0) {
                        return {
                            ...prev,
                            phase: 'starting',
                            countdown: 0
                        };
                    }

                    return {
                        ...prev,
                        countdown: remaining
                    };
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


    return {
        connected,
        gameState,
        lastEvent,
        selectCartella,
        send
    };
}
