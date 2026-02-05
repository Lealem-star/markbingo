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
    const [selectedCardNumber, setSelectedCardNumber] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [wallet, setWallet] = useState({ main: 0, play: 0, coins: 0, creditAvailable: 0, creditUsed: 0 });
    const [walletLoading, setWalletLoading] = useState(true);
    const [centerMessage, setCenterMessage] = useState(null);

    // WebSocket integration
    const { connected, gameState, selectCartella, deselectCartella, connectToStake, wsReadyState, isConnecting, lastEvent, messageCount } = useWebSocket();
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

    // Reset selected card when component mounts
    useEffect(() => {
        console.log('CartelaSelection - Component mounted, resetting selected card');
        setSelectedCardNumber(null);
        setError(null);
    }, []); // Empty dependency array - runs only on mount

    // Reset selected card when we're in registration phase (new game starting)
    useEffect(() => {
        if (gameState.phase === 'registration') {
            console.log('CartelaSelection - Resetting selected card for new game registration');
            setSelectedCardNumber(null);
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
            setSelectedCardNumber(null);
        }
    }, [gameState.gameId, gameState.phase]);

    // Special handling for navigation from Winner page
    useEffect(() => {
        // Check if we're coming from a winner announcement (game finished state)
        if (gameState.phase === 'announce' || gameState.winners?.length > 0) {
            console.log('CartelaSelection - Coming from Winner page, clearing all state');
            setSelectedCardNumber(null);
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

    // Fetch wallet data
    useEffect(() => {
        const fetchWallet = async () => {
            if (!sessionId) {
                setWalletLoading(false);
                return;
            }

            try {
                setWalletLoading(true);
                const response = await apiFetch('/user/profile', { sessionId });
                if (response.wallet) {
                    setWallet({
                        main: response.wallet.main || 0,
                        play: response.wallet.play || 0,
                        coins: response.wallet.coins || 0,
                        creditAvailable: response.wallet.creditAvailable || 0,
                        creditUsed: response.wallet.creditUsed || 0
                    });
                }
            } catch (err) {
                console.error('Error fetching wallet:', err);
                // Fallback to direct wallet fetch
                try {
                    const walletResponse = await apiFetch('/wallet', { sessionId });
                    setWallet({
                        main: walletResponse.main || 0,
                        play: walletResponse.play || 0,
                        coins: walletResponse.coins || 0,
                        creditAvailable: walletResponse.creditAvailable || 0,
                        creditUsed: walletResponse.creditUsed || 0
                    });
                } catch (walletErr) {
                    console.error('Error fetching wallet fallback:', walletErr);
                    // Set default values if all requests fail
                    setWallet({
                        main: 0,
                        play: 0,
                        coins: 0,
                        creditAvailable: 0,
                        creditUsed: 0
                    });
                }
            } finally {
                setWalletLoading(false);
            }
        };

        fetchWallet();
    }, [sessionId]);

    // Apply wallet updates from WebSocket (includes credit fields when playing on credit)
    useEffect(() => {
        if (!gameState?.walletUpdate) return;
        const update = gameState.walletUpdate;
        setWallet(prev => ({
            main: update.main ?? prev.main ?? 0,
            play: update.play ?? prev.play ?? 0,
            coins: update.coins ?? prev.coins ?? 0,
            creditAvailable: update.creditAvailable ?? prev.creditAvailable ?? 0,
            creditUsed: update.creditUsed ?? prev.creditUsed ?? 0
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
        console.log('Game state changed:', {
            phase: gameState.phase,
            gameId: gameState.gameId,
            selectedCardNumber,
            hasSelectedCard: !!selectedCardNumber,
            yourCard: gameState.yourCard,
            yourCardNumber: gameState.yourCardNumber,
            isWatchMode: gameState.isWatchMode
        });

        // If game is running and we have a selected card, navigate to game layout
        if (gameState.phase === 'running' && gameState.gameId && (selectedCardNumber || gameState.yourCardNumber)) {
            console.log('🎮 NAVIGATION TRIGGERED - Game started with our cartella, navigating to game layout', {
                gameId: gameState.gameId,
                selectedCardNumber,
                yourCardNumber: gameState.yourCardNumber,
                phase: gameState.phase,
                hasCard: !!gameState.yourCard
            });

            // Use WebSocket state as the source of truth
            const cardToUse = gameState.yourCardNumber || selectedCardNumber;

            // Ensure gameId is updated in parent before navigation
            onGameIdUpdate?.(gameState.gameId);
            console.log('Calling onCartelaSelected with:', cardToUse);
            onCartelaSelected?.(cardToUse);
        }
        // If game is running but we don't have a selected card, navigate to watch mode
        else if (gameState.phase === 'running' && gameState.gameId && !selectedCardNumber && !gameState.yourCardNumber) {
            console.log('Game is ongoing, navigating to GameLayout for watch mode');
            onCartelaSelected?.(null);
        }
    }, [gameState.phase, gameState.gameId, gameState.yourCardNumber, gameState.yourCard, selectedCardNumber, onCartelaSelected, onGameIdUpdate]);

    // Show message if game cancelled due to not enough players
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === 'game_cancelled' && lastEvent.payload?.reason === 'NOT_ENOUGH_PLAYERS') {
            showWarning('Not Enough Player');
        }
    }, [lastEvent, showWarning]);


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

        // Toggle off if clicking the same selected number during registration
        const alreadySelectedByYou = selectedCardNumber === cardNum || Number(gameState.yourSelection) === cardNum;
        if (alreadySelectedByYou) {
            if (gameState.phase !== 'registration') {
                showError(`Cannot unselect - current phase is ${gameState.phase}`);
                return;
            }
            if (!connected || wsReadyState !== WebSocket.OPEN) {
                showError('Not connected to game server. Please refresh and try again.');
                return;
            }
            try {
                console.log('Deselecting cartella:', cardNum);
                const success = deselectCartella(cardNum);
                if (success) {
                    setSelectedCardNumber(null);
                    showSuccess(`Cartella #${cardNum} unselected.`);
                } else {
                    showError('Failed to unselect cartella. Please try again.');
                }
            } catch (err) {
                console.error('Error deselecting cartella:', err);
                showError('Failed to unselect cartella. Please try again.');
            }
            return;
        }

        // Check if player has sufficient balance or credit
        const totalBalance = (wallet.main || 0) + (wallet.play || 0);
        const creditAvailable = wallet.creditAvailable || 0;
        const hasBalance = totalBalance >= stake;
        const hasCredit = creditAvailable >= stake && totalBalance === 0; // Credit only if no balance

        if (!hasBalance && !hasCredit) {
            const msg = `Insufficient balance and credit. You need ${stake} ETB but have ${totalBalance} ETB balance and ${creditAvailable} ETB credit available.`;

            // Avoid stacking multiple overlays/toasts on repeated clicks
            if (centerMessage !== msg) {
                setCenterMessage(msg);
                setTimeout(() => setCenterMessage(null), 3000);
            }

            showError(msg);
            return;
        }

        if (totalBalance < stake && hasCredit) {
            showSuccess('Using credit to play this game...');
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

            // Set local state immediately for UI feedback
            setSelectedCardNumber(cardNum);

            // Send selection via WebSocket
            const success = selectCartella(cardNum);

            if (success) {
                showSuccess(`Cartella #${cardNum} selected! Waiting for game to start...`);
                console.log('Cartella selection sent successfully');
            } else {
                showError('Failed to select cartella. Please try again.');
                setSelectedCardNumber(null); // Reset on failure
            }
        } catch (err) {
            console.error('Error selecting cartella:', err);
            showError('Failed to select cartella. Please try again.');
            setSelectedCardNumber(null); // Reset on error
        }
    };


    // Refresh wallet data
    const refreshWallet = async () => {
        if (!sessionId) return;

        try {
            setWalletLoading(true);
            const response = await apiFetch('/user/profile', { sessionId });
            if (response.wallet) {
                setWallet({
                    main: response.wallet.main || 0,
                    play: response.wallet.play || 0,
                    coins: response.wallet.coins || 0,
                    creditAvailable: response.wallet.creditAvailable || 0,
                    creditUsed: response.wallet.creditUsed || 0
                });
            }
        } catch (err) {
            console.error('Error refreshing wallet:', err);
            // Fallback to direct wallet fetch
            try {
                const walletResponse = await apiFetch('/wallet', { sessionId });
                setWallet({
                    main: walletResponse.main || 0,
                    play: walletResponse.play || 0,
                    coins: walletResponse.coins || 0,
                    creditAvailable: walletResponse.creditAvailable || 0,
                    creditUsed: walletResponse.creditUsed || 0
                });
            } catch (walletErr) {
                console.error('Error refreshing wallet fallback:', walletErr);
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

    // Derive currently selected card (by user or from websocket)
    const effectiveSelectedNumber = selectedCardNumber || gameState.yourCardNumber || gameState.yourSelection || null;
    const effectiveSelectedCard = effectiveSelectedNumber ? cards[effectiveSelectedNumber - 1] : null;

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
                                <div className="wallet-label">Credit</div>
                                <div className="wallet-value text-orange-400">
                                    {walletLoading ? '...' : (wallet.creditAvailable || 0).toLocaleString()}
                                </div>
                                {(wallet.creditUsed || 0) > 0 && (
                                    <div className="text-xs text-orange-300 mt-1">
                                        Used: {(wallet.creditUsed || 0).toLocaleString()}
                                    </div>
                                )}
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

            <header className="p-4 mb-6">
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

                {/* Second Row: Wallet info and Timer */}
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
                            <div className="wallet-label">Credit</div>
                            <div className="wallet-value text-orange-400">
                                {walletLoading ? '...' : (wallet.creditAvailable || 0).toLocaleString()}
                            </div>
                            {(wallet.creditUsed || 0) > 0 && (
                                <div className="text-xs text-orange-300 mt-1">
                                    Used: {(wallet.creditUsed || 0).toLocaleString()}
                                </div>
                            )}
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
                            Players: {gameState.playersCount}
                        </div>
                        <div className="prize-pool">
                            Prize: {gameState.prizePool || 0}
                        </div>
                    </div>
                </div>
            </header>

            {/* Overlay card for balance issues - centered button-like card at top */}
            {centerMessage && (
                <div className="fixed inset-x-0 top-2 z-[999] flex justify-center px-4 pointer-events-none">
                    <div className="pointer-events-auto inline-flex items-center gap-2 max-w-xl rounded-full bg-red-600 px-4 py-2 shadow-lg border border-red-300">
                        <span className="w-6 h-6 flex items-center justify-center rounded-full bg-white/15 text-white text-sm">!</span>
                        <span className="text-sm font-medium text-white text-center">
                            {centerMessage}
                        </span>
                    </div>
                </div>
            )}

            {/* Overlay card for registration expired - same style */}
            {gameState.phase === 'registration' && gameState.countdown <= 0 && (
                <div className="fixed inset-x-0 top-2 z-[998] flex justify-center px-4 pointer-events-none">
                    <div className="pointer-events-auto inline-flex items-center gap-2 max-w-xl rounded-full bg-red-600 px-4 py-2 shadow-lg border border-red-300">
                        <span className="w-6 h-6 flex items-center justify-center rounded-full bg-white/15 text-white text-sm">⏰</span>
                        <span className="text-sm font-medium text-white text-center">
                            Registration time has ended due to low number of players. Please wait for the next game to start.
                        </span>
                    </div>
                </div>
            )}

            <main className="p-4 mt-4 pb-6">

                {/* Status Message */}
                {gameState.phase === 'waiting' && (
                    <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-500 rounded-lg">
                        <div className="text-yellow-300 text-sm">
                            <div className="font-semibold mb-1">⏳ Waiting for Game</div>
                            <div>Connecting to game server... Please wait for the connection to establish.</div>
                            <div className="mt-2 text-xs">
                                Debug: Connected={connected ? 'Yes' : 'No'}, WS State={wsReadyState}, Messages={messageCount}
                            </div>
                        </div>
                    </div>
                )}

                {/* Number Selection Grid - Inside Scrollable Box */}
                <div className="my-4 mx-4">
                    <div className="bg-gray-800 rounded-lg p-4 max-h-[320px] min-h-[260px] overflow-y-auto">
                        <div className="cartela-numbers-grid">
                            {Array.from({ length: cards.length }, (_, i) => i + 1).map((cartelaNumber) => {
                                // Ensure type consistency for comparison (convert to number)
                                const cartelaNum = Number(cartelaNumber);
                                const isTaken = gameState.takenCards.some(taken => Number(taken) === cartelaNum);
                                const isSelected = selectedCardNumber === cartelaNum;
                                const takenByMe = Number(gameState.yourSelection) === cartelaNum;

                                return (
                                    <button
                                        key={cartelaNumber}
                                        onClick={() => !isTaken && handleCardSelect(cartelaNum)}
                                        disabled={isTaken || gameState.phase === 'running'}
                                        className={`cartela-number-btn ${isTaken
                                            ? (takenByMe
                                                ? 'bg-green-600 text-white cursor-default'
                                                : 'bg-red-600 text-white cursor-not-allowed opacity-60')
                                            : (isSelected
                                                ? 'bg-blue-600 text-white'
                                                : 'hover:bg-blue-500')
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


                {/* Selected Cartella Preview (only the user's selected card) */}
                {effectiveSelectedNumber && effectiveSelectedCard && (
                    <div className="mt-6">
                        <h3 className="text-lg font-semibold text-white mb-3 text-center">Your Selected Cartella</h3>
                        <div className="bg-gray-800 rounded-lg p-4">
                            <div className="flex justify-center">
                                <CartellaCard
                                    id={effectiveSelectedNumber}
                                    card={effectiveSelectedCard}
                                    called={gameState.calledNumbers || []}
                                    selectedNumber={effectiveSelectedNumber}
                                    isPreview={true}
                                />
                            </div>
                            <div className="text-center text-sm text-gray-300 mt-3">
                                🎫 Cartella #{effectiveSelectedNumber}
                            </div>
                        </div>
                    </div>
                )}
            </main>

            <BottomNav current="game" onNavigate={onNavigate} />
        </div>
    );
}