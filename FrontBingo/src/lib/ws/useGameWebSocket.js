import { useEffect, useRef, useState, useCallback } from 'react';

export function useGameWebSocket(gameId, sessionId) {
    const wsRef = useRef(null);
    const [connected, setConnected] = useState(false);
    const [gameState, setGameState] = useState({
        phase: 'waiting',
        gameId: null,
        playersCount: 0,
        prizePool: 0,
        calledNumbers: [],
        currentNumber: null,
        gameStatus: 'waiting',
        yourCard: null,
        winners: []
    });
    const [lastEvent, setLastEvent] = useState(null);

    const send = useCallback((type, payload) => {
        const ws = wsRef.current;
        const message = JSON.stringify({ type, payload });
        console.log('Game WebSocket send:', { type, payload, connected, readyState: ws?.readyState });

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
        } else {
            console.warn('Game WebSocket not ready, message not sent:', { type, payload });
        }
    }, [connected]);

    useEffect(() => {
        if (!gameId || !sessionId) return;

        let stopped = false;
        let retry = 0;
        let heartbeat = null;

        const connect = () => {
            const wsBase = import.meta.env.VITE_WS_URL ||
                (window.location.hostname === 'localhost' ? 'ws://localhost:3001' :
                    'wss://fikirbingo.com');
            const wsUrl = `${wsBase}/ws?token=${sessionId}&gameId=${gameId}`;
            console.log('Connecting to Game WebSocket:', wsUrl);

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('Game WebSocket connected');
                setConnected(true);
                retry = 0;

                // Join the game room
                send('join_game', { gameId });
            };

            ws.onmessage = (e) => {
                try {
                    const event = JSON.parse(e.data);
                    console.log('Game WebSocket event:', event.type, event.payload);

                    setLastEvent(event);

                    // Handle different event types
                    switch (event.type) {
                        case 'game_snapshot':
                            setGameState(prev => ({
                                ...prev,
                                phase: event.payload.phase,
                                gameId: event.payload.gameId,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool || 0,
                                calledNumbers: event.payload.calledNumbers || [],
                                currentNumber: event.payload.currentNumber,
                                gameStatus: event.payload.gameStatus || 'waiting',
                                yourCard: event.payload.yourCard,
                                winners: event.payload.winners || []
                            }));
                            break;

                        case 'number_called':
                            setGameState(prev => ({
                                ...prev,
                                calledNumbers: [...prev.calledNumbers, event.payload.number],
                                currentNumber: event.payload.number
                            }));
                            break;

                        case 'game_ended':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'ended',
                                winners: event.payload.winners || [],
                                gameStatus: 'ended'
                            }));
                            break;

                        case 'game_cancelled':
                            setGameState(prev => ({
                                ...prev,
                                phase: 'cancelled',
                                gameStatus: 'cancelled'
                            }));
                            break;
                    }
                } catch (error) {
                    console.error('Error parsing Game WebSocket message:', error);
                }
            };

            ws.onclose = (event) => {
                console.log('Game WebSocket closed:', event.code, event.reason);
                setConnected(false);
                if (heartbeat) {
                    clearInterval(heartbeat);
                    heartbeat = null;
                }

                if (!stopped) {
                    const delay = Math.min(1000 * 2 ** retry, 10000);
                    retry += 1;
                    console.log(`Retrying Game WebSocket connection in ${delay}ms (attempt ${retry})`);
                    setTimeout(connect, delay);
                }
            };

            ws.onerror = (error) => {
                console.error('Game WebSocket error:', error);
                ws.close();
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
            wsRef.current?.close();
            if (heartbeat) {
                clearInterval(heartbeat);
                heartbeat = null;
            }
        };
    }, [gameId, sessionId, send]);

    return {
        connected,
        gameState,
        lastEvent,
        send
    };
}
