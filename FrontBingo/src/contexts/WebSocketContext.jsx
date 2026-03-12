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
    const connectionAttemptRef = useRef(false);

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
        if (isConnecting || connectionAttemptRef.current) {
            console.log('General connection already in progress, skipping');
            return;
        }

        // Mark that we're attempting a connection
        connectionAttemptRef.current = true;

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
            // Normalize base: if env already includes /ws (e.g. tunnel URL), don't double-append (avoids /ws/ws)
            let wsBase = import.meta.env.VITE_WS_URL ||
                (window.location.hostname === 'localhost' ? 'ws://localhost:3001' :
                    'ws://84.247.178.86');
            wsBase = (wsBase || '').replace(/\/+$/, '');
            if (!/\/ws$/i.test(wsBase)) {
                wsBase += '/ws';
            }
            const wsUrl = `${wsBase}?token=${safeSessionId}`;
            console.log('Connecting to general WebSocket:', wsUrl);

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('✅ General WebSocket connected successfully');
                setConnected(true);
                setIsConnecting(false);
                connecting = false;
                connectionAttemptRef.current = false;
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
                                
                                // CRITICAL: Preserve yourCards if we're in a running game and snapshot doesn't provide cards
                                // This prevents snapshot from overriding game_started cards
                                const shouldPreserveCards = phase === 'running' && 
                                                          isSameGame && 
                                                          hasCards && 
                                                          (!event.payload.cards || event.payload.cards.length === 0);
                                
                                console.log('📸 Snapshot processed:', {
                                    snapshotPhase,
                                    snapshotGameId,
                                    currentPhase: prev.phase,
                                    currentGameId: prev.gameId,
                                    isCurrentlyRunning,
                                    hasCards,
                                    isSameGame,
                                    finalPhase: phase,
                                    finalGameId: gameId,
                                    shouldPreserveCards,
                                    snapshotHasCards: event.payload.cards?.length > 0
                                });
                                
                                // Build the new state carefully to avoid overriding game_started data
                                // CRITICAL: Don't spread ...event.payload first as it might override yourCards
                                // Instead, selectively merge fields
                                const snapshotCards = event.payload.cards;
                                const snapshotSelections = event.payload.yourSelections;
                                
                                // Determine final values for cards and selections
                                let finalCards = prev.yourCards || [];
                                let finalSelections = prev.yourSelections || [];
                                
                                if (phase === 'running') {
                                    // If snapshot has cards, use them (user rejoined and got their cards)
                                    if (snapshotCards && snapshotCards.length > 0) {
                                        finalCards = snapshotCards;
                                        console.log('📸 Using cards from snapshot:', snapshotCards.length);
                                    } else if (shouldPreserveCards) {
                                        // Preserve existing cards from game_started
                                        finalCards = prev.yourCards || [];
                                        console.log('📸 Preserving existing cards from game_started:', finalCards.length);
                                    } else {
                                        // No cards in snapshot and no existing cards - might be watch mode
                                        finalCards = [];
                                    }
                                    
                                    // Similar logic for selections
                                    if (snapshotSelections && snapshotSelections.length > 0) {
                                        finalSelections = snapshotSelections;
                                    } else if (shouldPreserveCards) {
                                        finalSelections = prev.yourSelections || [];
                                    }
                                }
                                
                                const newState = {
                                    ...prev,
                                    // Only spread safe fields from payload (not yourCards/yourSelections)
                                    playersCount: event.payload.playersCount ?? prev.playersCount ?? 0,
                                    prizePool: event.payload.prizePool ?? prev.prizePool ?? 0,
                                    takenCards: event.payload.takenCards || prev.takenCards || [],
                                    availableCards: event.payload.availableCards || prev.availableCards || [],
                                    phase,
                                    gameId,
                                    calledNumbers: event.payload.calledNumbers || event.payload.called || prev.calledNumbers || [],
                                    countdown: phase === 'registration' ? remainingSeconds : (event.payload.countdown || prev.countdown || 0),
                                    registrationEndTime,
                                    // Use our carefully determined final values
                                    yourCards: phase === 'registration' ? [] : finalCards,
                                    yourSelections: phase === 'registration' ? [] : finalSelections,
                                    ...(phase === 'registration' ? {
                                        currentNumber: null,
                                        winners: []
                                    } : {})
                                };
                                
                                console.log('📸 Snapshot state merge result:', {
                                    preservedCards: shouldPreserveCards,
                                    finalCardsCount: newState.yourCards?.length || 0,
                                    finalSelectionsCount: newState.yourSelections?.length || 0,
                                    snapshotHadCards: snapshotCards?.length > 0,
                                    snapshotHadSelections: snapshotSelections?.length > 0,
                                    prevHadCards: prev.yourCards?.length > 0
                                });
                                
                                return newState;
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

                        case 'registration_extended': {
                            const registrationEndTime = event.payload.endsAt;
                            const remainingSeconds = registrationEndTime ? Math.max(0, Math.ceil((registrationEndTime - Date.now()) / 1000)) : 0;
                            setGameState(prev => ({
                                ...prev,
                                // Stay in / return to registration for the same game
                                phase: 'registration',
                                gameId: event.payload.gameId || prev.gameId,
                                playersCount: event.payload.playersCount ?? prev.playersCount ?? 0,
                                countdown: remainingSeconds,
                                registrationEndTime,
                                // Preserve existing selections/cards/takenCards, but allow backend to update prize pool
                                takenCards: event.payload.takenCards || prev.takenCards || [],
                                prizePool: event.payload.prizePool ?? prev.prizePool ?? 0
                            }));
                            break;
                        }

                        case 'registration_closed': {
                            // Backend signaled registration ended; game is about to start.
                            // Move to a "starting" phase so the UI can navigate to GameLayout
                            // even before the first number arrives.
                            setGameState(prev => ({
                                ...prev,
                                phase: 'starting',
                                gameId: event.payload?.gameId || prev.gameId,
                                countdown: 0
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
                                // If we're already in a running game with cards for a different game, ignore this
                                if (prev.phase === 'running' && 
                                    Array.isArray(prev.yourCards) && prev.yourCards.length > 0 &&
                                    prev.gameId !== event.payload.gameId) {
                                    console.log('🎮 game_started IGNORED - already in different running game:', {
                                        eventGameId: event.payload.gameId,
                                        currentGameId: prev.gameId,
                                        currentPhase: prev.phase
                                    });
                                    return prev;
                                }
                                
                                // Extract card numbers from cards array for yourSelections
                                const cards = event.payload.cards || [];
                                const cardNumbers = cards.map(card => card.cardNumber || card).filter(num => num != null);
                                
                                const newState = {
                                ...prev,
                                    phase: 'running', // Keep 'running' to match App.jsx and CartelaSelection.jsx
                                gameId: event.payload.gameId,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool,
                                calledNumbers: event.payload.calledNumbers || event.payload.called || [],
                                yourCards: cards,
                                yourSelections: cardNumbers,
                                };
                                console.log('🎮 Game state updated to running:', {
                                    gameId: newState.gameId,
                                    phase: newState.phase,
                                    cardsCount: newState.yourCards?.length || 0,
                                    selectionsCount: newState.yourSelections?.length || 0,
                                    selections: newState.yourSelections
                                });
                                
                                // Dispatch custom event to trigger navigation in App.jsx
                                // This ensures navigation happens even if useEffect doesn't trigger
                                window.dispatchEvent(new CustomEvent('gameStarted', {
                                    detail: {
                                        gameId: newState.gameId,
                                        phase: newState.phase,
                                        playersCount: newState.playersCount,
                                        hasCards: newState.yourCards?.length > 0
                                    }
                                }));
                                
                                return newState;
                            });
                            setPendingGameStart(null);
                            break;

                        case 'number_called':
                            // Only process if it's for the current game
                            setGameState(prev => {
                                if (event.payload.gameId && event.payload.gameId !== prev.gameId) {
                                    console.log('🔢 number_called IGNORED - different gameId:', {
                                        eventGameId: event.payload.gameId,
                                        currentGameId: prev.gameId,
                                        number: event.payload.number
                                    });
                                    return prev; // Don't update state
                                }
                                return {
                                ...prev,
                                currentNumber: event.payload.number,
                                calledNumbers: event.payload.calledNumbers || event.payload.called || []
                                };
                            });
                            break;

                        case 'players_update':
                            // Only process if it's for the current game (or no gameId specified - assume it's for current)
                            setGameState(prev => {
                                if (event.payload?.gameId && event.payload.gameId !== prev.gameId) {
                                    console.log('👥 players_update IGNORED - different gameId:', {
                                        eventGameId: event.payload.gameId,
                                        currentGameId: prev.gameId
                                    });
                                    return prev; // Don't update state
                                }
                                return {
                                ...prev,
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool
                                };
                            });
                            break;

                        case 'registration_update':
                            // Only process if it's for the current game (or no gameId specified - assume it's for current)
                            setGameState(prev => {
                                if (event.payload?.gameId && event.payload.gameId !== prev.gameId) {
                                    console.log('📝 registration_update IGNORED - different gameId:', {
                                        eventGameId: event.payload.gameId,
                                        currentGameId: prev.gameId
                                    });
                                    return prev; // Don't update state
                                }
                                return {
                                ...prev,
                                takenCards: event.payload.takenCards || [],
                                prizePool: event.payload.prizePool
                                };
                            });
                            break;

                        case 'selection_confirmed':
                            // Only process if it's for the current game (or no gameId specified - assume it's for current)
                            setGameState(prev => {
                                if (event.payload?.gameId && event.payload.gameId !== prev.gameId) {
                                    console.log('✅ selection_confirmed IGNORED - different gameId:', {
                                        eventGameId: event.payload.gameId,
                                        currentGameId: prev.gameId
                                    });
                                    return prev; // Don't update state
                                }
                                return {
                                ...prev,
                                yourSelections: event.payload.selections || prev.yourSelections || [],
                                playersCount: event.payload.playersCount,
                                prizePool: event.payload.prizePool
                                };
                            });
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
                            // Store winners but keep phase as running until game_finished arrives.
                            // This lets the backend control the exact timing of the announce phase.
                            setGameState(prev => ({
                                ...prev,
                                winners: event.payload.winners || prev.winners || []
                            }));
                            break;

                        case 'bingo_rejected':
                            // Invalid BINGO claim: dispatch so GameLayout can clear manual marks and show error
                            window.dispatchEvent(new CustomEvent('bingoRejected', { detail: event.payload || {} }));
                            break;

                        case 'game_finished':
                        case 'game_ended':
                            // Process game_finished message
                            setGameState(prev => {
                                // Only ignore if we have both gameIds and they don't match
                                // If prev.gameId is null/undefined, accept the message (user might have just connected)
                                if (event.payload?.gameId && prev.gameId && event.payload.gameId !== prev.gameId) {
                                    console.log('🏁 game_finished IGNORED - different gameId:', {
                                        eventGameId: event.payload.gameId,
                                        currentGameId: prev.gameId
                                    });
                                    return prev; // Don't update state
                                }
                                
                                console.log('🏁 game_finished PROCESSING:', {
                                    eventGameId: event.payload?.gameId,
                                    prevGameId: prev.gameId,
                                    winnersCount: event.payload?.winners?.length || 0,
                                    phase: 'announce'
                                });
                                
                                return {
                                ...prev,
                                phase: 'announce',
                                gameId: event.payload?.gameId || prev.gameId, // Explicitly set gameId
                                winners: (event.payload && (event.payload.winners || event.payload.winner || [])) || prev.winners || [],
                                calledNumbers: (event.payload && (event.payload.calledNumbers || event.payload.called)) || prev.calledNumbers,
                                currentNumber: null,
                                yourCards: [],
                                yourSelections: [],
                                nextRegistrationStart: event.payload?.nextStartAt || null // Store when next registration will start
                                };
                            });
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
                connectionAttemptRef.current = false;

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
                        connectionAttemptRef.current = false; // Reset before reconnecting
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
                connectionAttemptRef.current = false;

                // WebSocket failed - app will show connection error.
                // Do NOT schedule retry here: onclose will also fire and handle reconnect with backoff.
                // Scheduling here too caused "Insufficient resources" from too many parallel retries.
                console.log('⚠️ WebSocket connection failed - app requires real connection');
            };
        };

        connect();

        return () => {
            stopped = true;
            connectionAttemptRef.current = false;
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
        if (sessionId && !connected && !isConnecting && !connectionAttemptRef.current) {
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
