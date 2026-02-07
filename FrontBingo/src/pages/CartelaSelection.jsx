import React, { useState, useEffect, useRef } from 'react';
import BottomNav from '../components/BottomNav';
import CartellaCard from '../components/CartellaCard';
import { apiFetch } from '../lib/api/client';
import { useAuth } from '../lib/auth/AuthProvider';
import { useToast } from '../contexts/ToastContext';
import { useWebSocket } from '../contexts/WebSocketContext';

export default function CartelaSelection({ onNavigate, onResetToGame, stake, onCartelaSelected, onGameIdUpdate }) {
    const { sessionId } = useAuth();
    const { showError, showSuccess, showWarning } = useToast();
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [wallet, setWallet] = useState({ main: 0, play: 0, coins: 0 });
    const [walletLoading, setWalletLoading] = useState(true);
    const [alertBanners, setAlertBanners] = useState([]);
    const alertTimersRef = useRef(new Map());

    // WebSocket integration
    const { connected, gameState, selectCartella, connectToStake, wsReadyState, isConnecting, lastEvent } = useWebSocket();
    const hasConnectedRef = useRef(false);
    const rejoinTriedRef = useRef(false);

    // Connect to WebSocket when component mounts with stake
    useEffect(() => {
        if (stake && sessionId && !hasConnectedRef.current) {
            console.log('CartelaSelection - Connecting to WebSocket for stake:', stake);
            hasConnectedRef.current = true;
            connectToStake(stake);
        }
    }, [stake, sessionId, connectToStake]);


    // Reset connection ref when stake changes
    useEffect(() => {
        hasConnectedRef.current = false;
    }, [stake]);

    // Reset transient UI state when component mounts
    useEffect(() => {
        console.log('CartelaSelection - Component mounted, resetting selected card');
        setError(null);
    }, []); // Empty dependency array - runs only on mount

    // Reset selected card when we're in registration phase (new game starting)
    useEffect(() => {
        if (gameState.phase === 'registration') {
            console.log('CartelaSelection - Resetting selected card for new game registration');
            setError(null);
            console.log('CartelaSelection - State reset complete, ready for new game');
            console.log('CartelaSelection - Current game state:', {
                phase: gameState.phase,
                gameId: gameState.gameId,
                playersCount: gameState.playersCount,
                takenCards: gameState.takenCards,
                connected: connected,
                wsReadyState: wsReadyState
            });
        }
    }, [gameState.phase, gameState.gameId, gameState.playersCount, gameState.takenCards, connected, wsReadyState]);

    // Reset when gameId changes (new game) - but only if we're in registration phase
    useEffect(() => {
        if (gameState.gameId && gameState.phase === 'registration') {
            console.log('CartelaSelection - New gameId detected in registration phase, resetting selection');
        }
    }, [gameState.gameId, gameState.phase]);

    // Special handling for navigation from Winner page
    useEffect(() => {
        // Check if we're coming from a winner announcement (game finished state)
        if (gameState.phase === 'announce' || gameState.winners?.length > 0) {
            console.log('CartelaSelection - Coming from Winner page, clearing all state');
            setError(null);

            // Force refresh data to get latest state
            if (stake && sessionId) {
                console.log('CartelaSelection - Reconnecting WebSocket after Winner page navigation');
                connectToStake(stake);
            }
        }
    }, [gameState.phase, gameState.winners, stake, sessionId]);

    // If we are connected but not in registration or countdown invalid, rejoin once to fetch fresh snapshot
    useEffect(() => {
        if (!stake || !sessionId) return;
        if (!connected || isConnecting) return;
        if (rejoinTriedRef.current) return;

        const notReadyForSelection = gameState.phase !== 'registration' || (typeof gameState.countdown === 'number' && gameState.countdown <= 0);
        if (notReadyForSelection) {
            rejoinTriedRef.current = true;
            console.log('CartelaSelection - Auto rejoin to fetch fresh snapshot');
            connectToStake(stake);
        }
    }, [stake, sessionId, connected, isConnecting, gameState.phase, gameState.countdown, connectToStake]);

    // Debug authentication
    useEffect(() => {
        console.log('CartelaSelection - Authentication Debug:', {
            sessionId: sessionId ? 'Present' : 'Missing',
            sessionIdLength: sessionId?.length || 0,
            stake: stake,
            connected: connected,
            wsReadyState: wsReadyState,
            isConnecting: isConnecting,
            readyStateNames: {
                0: 'CONNECTING',
                1: 'OPEN',
                2: 'CLOSING',
                3: 'CLOSED'
            }
        });
    }, [sessionId, stake, connected, wsReadyState, isConnecting]);

    // Handle page visibility changes to maintain connection
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && stake && sessionId) {
                console.log('CartelaSelection - Page became visible, ensuring WebSocket connection');
                // Small delay to let the page fully load
                setTimeout(() => {
                    if (!connected) {
                        console.log('Reconnecting WebSocket after page visibility change');
                        connectToStake(stake);
                    }
                }, 100);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [stake, sessionId, connected, connectToStake]);

    // Update gameId in parent component when it changes
    useEffect(() => {
        if (gameState.gameId) {
            console.log('CartelaSelection - GameId updated:', gameState.gameId);
            onGameIdUpdate?.(gameState.gameId);
        }
    }, [gameState.gameId, onGameIdUpdate]);

    // Fetch wallet data (use /wallet as source of truth, /user/profile as fallback)
    useEffect(() => {
        const fetchWallet = async () => {
            if (!sessionId) {
                return;
            }

            try {
                setWalletLoading(true);
                // Primary source: /wallet (authoritative)
                const walletResponse = await apiFetch('/wallet', { sessionId });
                
                // Debug logging to verify wallet data
                console.log('CartelaSelection wallet fetch:', {
                    main: walletResponse.main,
                    play: walletResponse.play,
                    balance: walletResponse.balance,
                    coins: walletResponse.coins,
                    fullResponse: walletResponse
                });

                // Use actual wallet values - prioritize main/play fields, fall back to balance only if null/undefined
                const mainValue = (walletResponse.main !== null && walletResponse.main !== undefined) 
                    ? walletResponse.main 
                    : (walletResponse.balance ?? 0);
                const playValue = (walletResponse.play !== null && walletResponse.play !== undefined) 
                    ? walletResponse.play 
                    : 0;

                setWallet({
                    main: mainValue,
                    play: playValue,
                    coins: walletResponse.coins ?? 0
                });
            } catch (walletErr) {
                console.error('Error fetching wallet from /wallet:', walletErr);
                // Fallback: try /user/profile to at least get some wallet info
                try {
                    const profileResponse = await apiFetch('/user/profile', { sessionId });
                    if (profileResponse.wallet) {
                        setWallet({
                            main: profileResponse.wallet.main ?? profileResponse.wallet.balance ?? 0,
                            play: profileResponse.wallet.play ?? profileResponse.wallet.balance ?? 0,
                            coins: profileResponse.wallet.coins ?? 0
                        });
                    } else {
                        setWallet({
                            main: 0,
                            play: 0,
                            coins: 0
                        });
                    }
                } catch (profileErr) {
                    console.error('Error fetching wallet fallback from /user/profile:', profileErr);
                    // Set safe defaults if everything fails
                    setWallet({
                        main: 0,
                        play: 0,
                        coins: 0
                    });
                }
            } finally {
                setWalletLoading(false);
            }
        };

        fetchWallet();
    }, [sessionId]);

    // Apply wallet updates from WebSocket
    useEffect(() => {
        if (!gameState?.walletUpdate) return;
        const update = gameState.walletUpdate;
        setWallet(prev => ({
            main: update.main ?? prev.main ?? 0,
            play: update.play ?? prev.play ?? 0,
            coins: update.coins ?? prev.coins ?? 0
        }));
    }, [gameState.walletUpdate]);

    // Fetch all cards from server
    useEffect(() => {
        const fetchCards = async () => {
            try {
                console.log('Fetching cartellas from /api/cartellas...');
                console.log('API Base URL:', import.meta.env.VITE_API_URL || 'https://fikirbingo.com');
                console.log('Session ID:', sessionId ? 'present' : 'missing');
                setLoading(true);


                const response = await apiFetch('/api/cartellas', { sessionId });
                console.log('Cartellas API response:', response);
                if (response.success) {
                    console.log('Cartellas loaded successfully:', response.cards?.length, 'cards');
                    setCards(response.cards);
                } else {
                    console.error('Cartellas API returned error:', response);
                    setError('Failed to load cards');
                }
            } catch (err) {
                console.error('Error fetching cards:', err);
                console.error('Error details:', {
                    message: err.message,
                    status: err.status,
                    url: '/api/cartellas',
                    sessionId: sessionId ? 'present' : 'missing'
                });
                setError('Failed to load cards from server');
            } finally {
                setLoading(false);
            }
        };

        fetchCards();
    }, []);

    // Handle game state changes and navigation
    useEffect(() => {
        const selectedNumbers = Array.isArray(gameState.yourSelections) ? gameState.yourSelections : [];
        console.log('Game state changed:', {
            phase: gameState.phase,
            gameId: gameState.gameId,
            selectedNumbers,
            hasSelectedCard: selectedNumbers.length > 0,
            yourCards: Array.isArray(gameState.yourCards) ? gameState.yourCards.length : 0,
        });

        // If game is running and we have selected cartela(s), navigate to game layout
        if (gameState.phase === 'running' && gameState.gameId && selectedNumbers.length > 0) {
            console.log('🎮 NAVIGATION TRIGGERED - Game started with our cartella, navigating to game layout', {
                gameId: gameState.gameId,
                selectedNumbers,
                phase: gameState.phase,
                hasCard: (Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0)
            });

            // Ensure gameId is updated in parent before navigation
            onGameIdUpdate?.(gameState.gameId);
            console.log('Calling onCartelaSelected with:', selectedNumbers);
            onCartelaSelected?.(selectedNumbers);
        }
        // If game is running but user has no selection, stay on CartelaSelection (no watch mode)
    }, [gameState.phase, gameState.gameId, gameState.yourSelections, gameState.yourCards, onCartelaSelected, onGameIdUpdate]);

    // Show message if game cancelled due to not enough players
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === 'game_cancelled' && lastEvent.payload?.reason === 'NOT_ENOUGH_PLAYERS') {
            showWarning('Not Enough Player');
        }
        if (lastEvent.type === 'selection_rejected' && lastEvent.payload?.reason === 'LIMIT_REACHED') {
            showError('You can select maximum 2 cartelas.');
        }
    }, [lastEvent, showWarning, showError]);

    // Handle registration expired - add to alert banners
    useEffect(() => {
        const registrationExpired = gameState?.phase === 'registration' && typeof gameState?.countdown === 'number' && gameState.countdown <= 0;
        const msg = 'Registration time has ended due to low number of players. Please wait for the next game to start.';
        
        setAlertBanners(prev => {
            const hasExpiredMsg = prev.includes(msg);
            if (registrationExpired && !hasExpiredMsg) {
                // Add expired message if registration is expired and message not already present
                return [...prev, msg];
            } else if (!registrationExpired && hasExpiredMsg) {
                // Remove expired message if registration is active again
                return prev.filter(m => m !== msg);
            }
            return prev;
        });
    }, [gameState?.phase, gameState?.countdown]);

    // Auto-dismiss alerts after 3 seconds
    useEffect(() => {
        // Clear any existing timers for alerts that are no longer in the array
        const currentMessages = new Set(alertBanners);
        alertTimersRef.current.forEach((timer, msg) => {
            if (!currentMessages.has(msg)) {
                clearTimeout(timer);
                alertTimersRef.current.delete(msg);
            }
        });

        // Create new timers for alerts that don't have one yet
        alertBanners.forEach((alertMsg) => {
            if (!alertTimersRef.current.has(alertMsg)) {
                const timer = setTimeout(() => {
                    setAlertBanners(prev => prev.filter(msg => msg !== alertMsg));
                    alertTimersRef.current.delete(alertMsg);
                }, 3000);
                alertTimersRef.current.set(alertMsg, timer);
            }
        });

        // Cleanup function - only clear on unmount
        return () => {
            // Don't clear here - let timers complete naturally
            // Only clear on component unmount (handled separately if needed)
        };
    }, [alertBanners]);

    // Cleanup timers on component unmount
    useEffect(() => {
        return () => {
            alertTimersRef.current.forEach(timer => clearTimeout(timer));
            alertTimersRef.current.clear();
        };
    }, []);


    // Handle card selection - automatically confirm without separate confirmation step
    const handleCardSelect = async (cardNumber) => {
        // Ensure type consistency - convert to number
        const cardNum = Number(cardNumber);

        console.log('Card selection attempt:', {
            cardNumber: cardNum,
            phase: gameState.phase,
            takenCards: gameState.takenCards,
            isTaken: gameState.takenCards.some(taken => Number(taken) === cardNum),
            connected: connected,
            wsReadyState: wsReadyState
        });

        // Prevent using stale/empty wallet data while it's still loading
        if (walletLoading) {
            showError('Loading wallet information. Please wait a moment and try again.');
            return;
        }

        const selectedNumbers = Array.isArray(gameState.yourSelections) ? gameState.yourSelections : [];

        // No unselect/toggle behavior: clicking an already-selected number does nothing
        if (selectedNumbers.includes(cardNum)) {
            return;
        }

        // Max 2 cartelas per user
        if (selectedNumbers.length >= 2) {
            showError('You can select maximum 2 cartelas.');
            return;
        }

        // Check if player has sufficient balance (stake per cartela)
        const totalBalance = (wallet.main || 0) + (wallet.play || 0);
        const needed = Number(stake) * (selectedNumbers.length + 1);
        const hasBalance = totalBalance >= needed;

        if (!hasBalance) {
            const msg = `Insufficient fund`;

            // Add banner to stack (like image showing multiple banners)
            setAlertBanners(prev => [...prev, msg]);

            showError(msg);
            return;
        }

        // Check if card is already taken
        if (gameState.takenCards.some(taken => Number(taken) === cardNum)) {
            showError('This cartella is already taken by another player!');
            return;
        }

        // Check if we're in the right phase
        if (gameState.phase !== 'registration') {
            showError(`Cannot select cartella - current phase is ${gameState.phase}, not registration!`);
            return;
        }

        // Check WebSocket connection
        if (!connected || wsReadyState !== WebSocket.OPEN) {
            showError('Not connected to game server. Please refresh and try again.');
            return;
        }

        try {
            console.log('Selecting cartella:', cardNum);

            // Send selection via WebSocket
            const success = selectCartella(cardNum);

            if (success) {
                showSuccess(`Cartella #${cardNum} selected! Waiting for game to start...`);
                console.log('Cartella selection sent successfully');
            } else {
                showError('Failed to select cartella. Please try again.');
            }
        } catch (err) {
            console.error('Error selecting cartella:', err);
            showError('Failed to select cartella. Please try again.');
        }
    };


    // Refresh wallet data (same logic as initial fetch: /wallet primary, /user/profile fallback)
    const refreshWallet = async () => {
        if (!sessionId) return;

        try {
            setWalletLoading(true);
            // Primary refresh from /wallet
            const walletResponse = await apiFetch('/wallet', { sessionId });
            setWallet({
                main: walletResponse.main ?? walletResponse.balance ?? 0,
                play: walletResponse.play ?? walletResponse.balance ?? 0,
                coins: walletResponse.coins ?? 0
            });
        } catch (walletErr) {
            console.error('Error refreshing wallet from /wallet:', walletErr);
            // Fallback to /user/profile
            try {
                const profileResponse = await apiFetch('/user/profile', { sessionId });
                if (profileResponse.wallet) {
                    setWallet({
                        main: profileResponse.wallet.main ?? profileResponse.wallet.balance ?? 0,
                        play: profileResponse.wallet.play ?? profileResponse.wallet.balance ?? 0,
                        coins: profileResponse.wallet.coins ?? 0
                    });
                }
            } catch (profileErr) {
                console.error('Error refreshing wallet fallback from /user/profile:', profileErr);
            }
        } finally {
            setWalletLoading(false);
        }
    };

    // Handle refresh button click - refresh data in-place without wiping UI
    const handleRefresh = async () => {
        console.log('Refreshing CartelaSelection data (lightweight)...');
        try {
            // Show immediate feedback
            showSuccess('🔄 Refreshing data...');

            // Light wallet refresh (keeps UI visible)
            await refreshWallet();

            // Light cartellas refresh (no full-screen loading)
            try {
                const response = await apiFetch('/api/cartellas');
                if (response?.success && Array.isArray(response.cards)) {
                    setCards(response.cards);
                    console.log('✅ Cartellas refreshed successfully');
                } else {
                    console.warn('Refresh: cartellas API returned unexpected response');
                    showWarning('⚠️ Some data may be outdated');
                }
            } catch (err) {
                console.warn('Refresh: error fetching cartellas (non-fatal)', err);
                showWarning('⚠️ Could not refresh cartellas, but game data is updated');
            }

            // Ensure we have the latest game snapshot for this stake
            if (stake && sessionId) {
                connectToStake(stake);
                console.log('✅ WebSocket reconnected for fresh game state');
            }

            // Clear any previous errors and show success
            setError(null);
            showSuccess('✅ Data refreshed successfully!');
            console.log('CartelaSelection lightweight refresh complete');
        } catch (error) {
            console.error('Error refreshing data:', error);
            setError('Failed to refresh data. Please try again.');
            showError('❌ Failed to refresh data. Please check your connection.');
        }
    };

    console.log('CartelaSelection render - loading:', loading, 'error:', error, 'cards:', cards.length);

    const selectedNumbers = Array.isArray(gameState.yourSelections) ? gameState.yourSelections : [];
    const selectedCards = selectedNumbers
        .map(n => ({ number: n, card: cards[n - 1] }))
        .filter(x => x.card);

    if (loading) {
        console.log('Showing loading screen');
        return (
            <div className="app-container">
                <header className="p-4">
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={() => {
                            onResetToGame?.();
                        }} className="header-button">
                            ← Back
                        </button>
                    </div>
                    {/* Wallet info during loading */}
                    <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                            <div className="wallet-box">
                                <div className="wallet-label">Main Wallet</div>
                                <div className="wallet-value text-blue-400">
                                    {walletLoading ? '...' : (wallet.main || 0).toLocaleString()}
                                </div>
                            </div>
                            <div className="wallet-box">
                                <div className="wallet-label">Play Wallet</div>
                                <div className="wallet-value text-green-400">
                                    {walletLoading ? '...' : (wallet.play || 0).toLocaleString()}
                                </div>
                            </div>
                            <div className="wallet-box">
                                <div className="wallet-label">Stake</div>
                                <div className="wallet-value">{stake}</div>
                            </div>
                        </div>
                        <div className="timer-box">
                            <div className="timer-countdown">
                                {gameState.countdown}s
                            </div>
                            <div className="timer-status">
                                {gameState.phase === 'registration' && `Registration open... (${gameState.playersCount} players)`}
                                {gameState.phase === 'starting' && `Starting game... (${gameState.playersCount} players)`}
                                {gameState.phase === 'running' && 'Game in progress!'}
                                {gameState.phase === 'announce' && 'Game finished!'}
                            </div>

                        </div>
                    </div>
                </header>
                <main className="p-4 flex items-center justify-center min-h-96">
                    <div className="text-center">
                        {/* Loading Animation */}
                        <div className="relative mb-4">
                            <div className="w-16 h-16 mx-auto">
                                {/* Spinning circle */}
                                <div className="w-16 h-16 border-4 border-purple-200/30 border-t-purple-500 rounded-full animate-spin"></div>
                                {/* Inner pulsing dot */}
                                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-purple-500 rounded-full animate-pulse"></div>
                            </div>
                        </div>


                        {/* Animated dots */}
                        <div className="flex justify-center mt-3 space-x-1">
                            <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                    </div>
                </main>
                <BottomNav current="game" onNavigate={onNavigate} />
            </div>
        );
    }

    if (error) {
        console.log('Showing error screen:', error);
        return (
            <div className="app-container">
                <header className="p-4">
                    <div className="flex items-center justify-between mb-4">
                        <button onClick={() => {
                            onResetToGame?.();
                        }} className="header-button">
                            ← Back
                        </button>
                    </div>
                    {/* Wallet info during error */}
                    <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                            <div className="wallet-box">
                                <div className="wallet-label">Main Wallet</div>
                                <div className="wallet-value text-blue-400">
                                    {walletLoading ? '...' : wallet.main?.toLocaleString() || 0}
                                </div>
                            </div>
                            <div className="wallet-box">
                                <div className="wallet-label">Play Wallet</div>
                                <div className="wallet-value text-green-400">
                                    {walletLoading ? '...' : wallet.play?.toLocaleString() || 0}
                                </div>
                            </div>
                            <div className="wallet-box">
                                <div className="wallet-label">Stake</div>
                                <div className="wallet-value">{stake}</div>
                            </div>
                        </div>
                        <div className="timer-box">
                            <div className="timer-countdown">
                                {gameState.countdown}s
                            </div>
                            <div className="timer-status">
                                {gameState.phase === 'registration' && `Registration open... (${gameState.playersCount} players)`}
                                {gameState.phase === 'starting' && `Starting game... (${gameState.playersCount} players)`}
                                {gameState.phase === 'running' && 'Game in progress!'}
                                {gameState.phase === 'announce' && 'Game finished!'}
                            </div>
                            <div className="prize-pool">
                                Prize Pool: ETB {gameState.prizePool || 0}
                            </div>
                            <div className="debug-info text-xs text-gray-400">
                                Phase: {gameState.phase} | Players: {gameState.playersCount}
                            </div>
                        </div>
                    </div>
                </header>

                {/* Show error message but still allow interaction */}
                <div className="p-4">
                    <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
                        <div className="flex items-center gap-2 text-yellow-400">
                            <span className="text-lg">⚠️</span>
                            <div>
                                <div className="font-semibold">Limited Mode</div>
                                <div className="text-sm text-yellow-300">{error}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <main className="p-4">

                </main>
                <BottomNav current="game" onNavigate={onNavigate} />
            </div>
        );
    }

    console.log('Rendering main CartelaSelection interface with', cards.length, 'cards');

    return (
        <div className="app-container relative">
            {/* Alert Banners - Fixed at top, stacked vertically with animations */}
            {Array.isArray(alertBanners) && alertBanners.length > 0 && (
                <div className="fixed top-0 left-0 right-0 z-50 px-4 pt-2 space-y-2">
                    {alertBanners.map((alertMsg, index) => (
                        <div 
                            key={index} 
                            className="alert-banner-appeal animate-slide-in"
                            style={{ animationDelay: `${index * 0.1}s` }}
                        >
                            {/* Icon on the left */}
                            <div className="alert-icon-wrapper">
                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                            </div>
                            {/* Message text */}
                            <div className="alert-message-text">
                                {alertMsg}
                            </div>
                            {/* Dismiss button on the right */}
                            <button
                                onClick={() => {
                                    setAlertBanners(prev => prev.filter((_, i) => i !== index));
                                }}
                                className="alert-dismiss-btn"
                                aria-label="Dismiss"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <header className="p-4 mb-0">
                {/* Top Row: Back and Refresh buttons */}
                <div className="flex items-center justify-between mb-4">
                    <button onClick={() => {
                        onResetToGame?.();
                    }} className="header-button">
                        ← Back
                    </button>
                    <button
                        onClick={handleRefresh}
                        className="header-button"
                        disabled={walletLoading || loading}
                    >
                        {walletLoading || loading ? '⟳ Loading...' : '↻ Refresh'}
                    </button>
                </div>

                {/* Second Row: Wallet info and Timer - White boxes style */}
                <div className="game-info-bar-light flex items-stretch rounded-lg flex-nowrap mobile-info-bar" style={{ marginBottom: '1rem' }}>
                    <div className="info-box flex-1">
                        <div className="info-label">Main Wallet</div>
                        <div className="info-value">
                            {walletLoading ? '...' : wallet.main?.toLocaleString() || 0}
                        </div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Play Wallet</div>
                        <div className="info-value">
                            {walletLoading ? '...' : wallet.play?.toLocaleString() || 0}
                        </div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Stake</div>
                        <div className="info-value">{stake}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Players</div>
                        <div className="info-value">{gameState.playersCount || 0}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Timer</div>
                        <div className="info-value">{gameState.countdown || 0}s</div>
                    </div>
                </div>


                
            </header>

            <main className="p-4 mt-2 pb-6">

                {/* Number Selection Grid - Inside Scrollable Box */}
                <div className="my-4 mx-4">
                    <div className="bg-purple-200 rounded-lg p-4 max-h-[320px] min-h-[260px] overflow-y-auto" style={{ background: '#e9d5ff' }}>
                        <div className="cartela-numbers-grid">
                            {Array.from({ length: cards.length }, (_, i) => i + 1).map((cartelaNumber) => {
                                // Ensure type consistency for comparison (convert to number)
                                const cartelaNum = Number(cartelaNumber);
                                const isTaken = gameState.takenCards.some(taken => Number(taken) === cartelaNum);
                                const isSelected = selectedNumbers.includes(cartelaNum);
                                const takenByMe = selectedNumbers.includes(cartelaNum);

                                return (
                                    <button
                                        key={cartelaNumber}
                                        onClick={() => !isTaken && handleCardSelect(cartelaNum)}
                                        disabled={isTaken || gameState.phase === 'running'}
                                        className={`cartela-number-btn-light ${isTaken
                                            ? (takenByMe
                                                ? 'cartela-selected-light'
                                                : 'cartela-taken-light')
                                            : (isSelected
                                                ? 'cartela-selected-light'
                                                : 'cartela-normal-light')
                                            }`}
                                        title={`Cartella #${cartelaNumber}`}
                                    >
                                        {cartelaNumber}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>


                {/* Selected Cartella Preview (up to 2 cartelas, side-by-side) */}
                {selectedCards.length > 0 && (
                    <div className="mt-6">
                        {/* <h3 className="text-lg font-semibold text-gray-800 mb-3 text-center">Your Selected Cartella</h3> */}
                        <div className="bg-purple-200 rounded-lg p-4" style={{ background: '#e9d5ff' }}>
                            <div className="flex justify-center gap-4 flex-wrap">
                                {selectedCards.map(({ number, card }) => (
                                    <CartellaCard
                                        key={number}
                                        id={number}
                                        card={card}
                                        called={gameState.calledNumbers || []}
                                        selectedNumber={number}
                                        isPreview={true}
                                    />
                                ))}
                            </div>
                            {/* <div className="text-center text-sm text-gray-700 mt-3">
                                🎫 {selectedNumbers.map(n => `Cartella #${n}`).join('  |  ')}
                            </div> */}
                        </div>
                    </div>
                )}
            </main>

            <BottomNav current="game" onNavigate={onNavigate} />
        </div>
    );
}