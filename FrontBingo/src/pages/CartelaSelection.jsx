import React, { useState, useEffect, useRef, useCallback } from 'react';
// import BottomNav from '../components/BottomNav';
import CartellaCard from '../components/CartellaCard';
import { apiFetch } from '../lib/api/client';
import { useAuth } from '../lib/auth/AuthProvider';
import { useToast } from '../contexts/ToastContext';
import { useWebSocket } from '../contexts/WebSocketContext';

const MAX_CARTELAS_PER_PLAYER = 2;
const PRESALE_AUTO_CONFIRM_MS = 3500;

function SuperPendingCartelaSlot({ cardNumber, card, called, onCancel, onConfirm }) {
    const [progress, setProgress] = useState(0);
    const cancelledRef = useRef(false);
    const confirmedRef = useRef(false);
    const onConfirmRef = useRef(onConfirm);

    useEffect(() => {
        onConfirmRef.current = onConfirm;
    }, [onConfirm]);

    useEffect(() => {
        cancelledRef.current = false;
        confirmedRef.current = false;
        setProgress(0);
        const start = Date.now();
        let frameId = null;

        const tick = () => {
            if (cancelledRef.current || confirmedRef.current) return;
            const elapsed = Date.now() - start;
            const pct = Math.min(100, (elapsed / PRESALE_AUTO_CONFIRM_MS) * 100);
            setProgress(pct);
            if (pct >= 100) {
                confirmedRef.current = true;
                onConfirmRef.current(cardNumber);
                return;
            }
            frameId = requestAnimationFrame(tick);
        };

        frameId = requestAnimationFrame(tick);
        return () => {
            cancelledRef.current = true;
            if (frameId) cancelAnimationFrame(frameId);
        };
    }, [cardNumber]);

    const handleCancel = () => {
        if (confirmedRef.current) return;
        cancelledRef.current = true;
        onCancel(cardNumber);
    };

    return (
        <div className="cartela-slot cartela-slot-filled cartela-slot-pending">
            <div className="cartela-slot-progress-track" aria-hidden="true">
                <div className="cartela-slot-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <button
                type="button"
                className="cartela-slot-remove"
                onClick={handleCancel}
                aria-label={`Cancel cartela ${cardNumber}`}
            >
                ×
            </button>
            <div className="cartela-slot-meta">
                <span className="cartela-slot-id">#{cardNumber}</span>
            </div>
            <div className="cartela-slot-card">
                <CartellaCard
                    id={cardNumber}
                    card={card}
                    called={called}
                    isPreview={true}
                />
            </div>
        </div>
    );
}

export default function CartelaSelection({ onNavigate, onResetToGame, stake, onCartelaSelected, onGameIdUpdate }) {
    const { sessionId } = useAuth();
    const { showError, showSuccess, showWarning } = useToast();
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [wallet, setWallet] = useState({ main: 0, play: 0 });
    const [walletLoading, setWalletLoading] = useState(true);
    const [alertBanners, setAlertBanners] = useState([]);
    const alertTimersRef = useRef(new Map());

    // WebSocket integration
    const { connected, gameState, selectCartella, deselectCartella, confirmCartella, connectToStake, wsReadyState, isConnecting, lastEvent } = useWebSocket();
    const hasConnectedRef = useRef(false);
    const rejoinTriedRef = useRef(false);
    const [pendingSelections, setPendingSelections] = useState([]);

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

    // If we are connected but not in registration, rejoin once to fetch fresh snapshot.
    // Don't rejoin just because countdown hits 0 - backend may extend registration.
    useEffect(() => {
        if (!stake || !sessionId) return;
        if (!connected || isConnecting) return;
        if (rejoinTriedRef.current) return;

        const notReadyForSelection = gameState.phase !== 'registration';
        if (notReadyForSelection) {
            rejoinTriedRef.current = true;
            console.log('CartelaSelection - Auto rejoin to fetch fresh snapshot');
            connectToStake(stake);
        }
    }, [stake, sessionId, connected, isConnecting, gameState.phase, gameState.countdown, connectToStake]);

    // Debug authentication
    useEffect(() => {
    }, [sessionId, stake, connected, wsReadyState, isConnecting]);

    // Rejoin room when tab becomes visible (handles zombie connections)
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && stake && sessionId) {
                console.log('CartelaSelection - Page became visible, rejoining stake room');
                setTimeout(() => {
                    connectToStake(stake);
                }, 100);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [stake, sessionId, connectToStake]);

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
                    play: playValue
                });
            } catch (walletErr) {
                console.error('Error fetching wallet from /wallet:', walletErr);
                // Fallback: try /user/profile to at least get some wallet info
                try {
                    const profileResponse = await apiFetch('/user/profile', { sessionId });
                    if (profileResponse.wallet) {
                        setWallet({
                            main: profileResponse.wallet.main ?? profileResponse.wallet.balance ?? 0,
                            play: profileResponse.wallet.play ?? profileResponse.wallet.balance ?? 0
                        });
                    } else {
                        setWallet({
                            main: 0,
                            play: 0
                        });
                    }
                } catch (profileErr) {
                    console.error('Error fetching wallet fallback from /user/profile:', profileErr);
                    // Set safe defaults if everything fails
                    setWallet({
                        main: 0,
                        play: 0
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
            play: update.play ?? prev.play ?? 0
        }));
    }, [gameState.walletUpdate]);

    const [retryCount, setRetryCount] = useState(0);

    // Fetch all cards from server
    useEffect(() => {
        const fetchCards = async () => {
            if (!sessionId) {
                console.log('Skipping cartellas fetch - missing sessionId (will retry when available)');
                return;
            }
            try {
                setLoading(true);
                setError(null);
                const response = await apiFetch('/api/cartellas', { sessionId });
                if (response.success && Array.isArray(response.cards)) {
                    if (response.cards.length === 0) {
                        console.error('Cartellas API returned empty cards array');
                        setError('No cards available right now. Please refresh.');
                        setCards([]);
                    } else {
                        setCards(response.cards);
                        setError(null);
                    }
                } else {
                    setError('Failed to load cards');
                }
            } catch (err) {
                console.error('Error fetching cards:', err);
                setError('Failed to load cards from server');
            } finally {
                setLoading(false);
            }
        };
        fetchCards();
    }, [sessionId, retryCount]);

    // Handle game state changes and navigation
    useEffect(() => {
        const selectedNumbers = Array.isArray(gameState.yourSelections) ? gameState.yourSelections : [];
        const hasCards = Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0;
        const isGameRunning = gameState.phase === 'running' && gameState.gameId;
        const isGameStarting = gameState.phase === 'starting' && gameState.gameId;
        const hasPlayers = typeof gameState.playersCount === 'number' && gameState.playersCount >= 2;
        // Only go to game-layout when a real game is running or starting with at least one player.
        // If timer hits 0 but not enough players selected, game is cancelled → stay on cartela selection.
        const shouldGoToGameLayout = (isGameRunning || isGameStarting) && hasPlayers;
        
        console.log('🎮 CartelaSelection - Game state changed:', {
            phase: gameState.phase,
            gameId: gameState.gameId,
            selectedNumbers,
            hasSelectedCard: selectedNumbers.length > 0,
            yourCardsCount: gameState.yourCards?.length || 0,
            hasCards,
            playersCount: gameState.playersCount,
            hasPlayers,
            isGameRunning,
            isGameStarting
        });

        // When a game is starting or running, navigate to GameLayout (watch mode if no cards, play if has cards):
        // - Players with cards see their boards.
        // - Users without cards see watch mode.
        if (shouldGoToGameLayout) {
            console.log('🎮 NAVIGATION TRIGGERED - Game starting/running, requesting game layout', {
                gameId: gameState.gameId,
                phase: gameState.phase,
                hasCards,
                hasSelections: selectedNumbers.length > 0
            });

            // Ensure gameId is updated in parent before navigation
            onGameIdUpdate?.(gameState.gameId);
            
            // Extract card numbers from yourCards if available, otherwise use yourSelections.
            // If neither exist, pass an empty array (watch mode).
            let cardNumbersToPass = [];
            if (hasCards && Array.isArray(gameState.yourCards)) {
                cardNumbersToPass = gameState.yourCards
                    .map(card => card.cardNumber || card)
                    .filter(num => num != null);
                console.log('📋 Using card numbers from yourCards:', cardNumbersToPass);
            } else if (selectedNumbers.length > 0) {
                cardNumbersToPass = selectedNumbers;
                console.log('📋 Using card numbers from yourSelections:', cardNumbersToPass);
            } else {
                console.log('👀 Watch mode - no cards available for this user');
            }
            
            console.log('Calling onCartelaSelected with:', cardNumbersToPass);
            onCartelaSelected?.(cardNumbersToPass);

            // Ask parent app to navigate into game-layout immediately (players or watchers).
            // Use forceDirect=true so we don't get bounced back to selection by smart routing.
            onNavigate?.('game-layout', true);
        }
    }, [gameState.phase, gameState.gameId, gameState.yourSelections, gameState.yourCards, onCartelaSelected, onGameIdUpdate, onNavigate]);

    // Show message if game cancelled due to not enough players
    useEffect(() => {
        if (!lastEvent) return;
        if (lastEvent.type === 'game_cancelled' && lastEvent.payload?.reason === 'NOT_ENOUGH_PLAYERS') {
            showWarning('Not Enough Player');
        }
        if (lastEvent.type === 'selection_rejected' && lastEvent.payload?.reason === 'LIMIT_REACHED') {
            showError(`You can select up to ${MAX_CARTELAS_PER_PLAYER} cartelas.`);
        }
    }, [lastEvent, showWarning, showError]);

    // Handle registration expired - add to alert banners only when it's truly "no players"
    // Don't show when user has a selection: server may extend (1 player) or start (2+ players)
    useEffect(() => {
        const hasSelection = Array.isArray(gameState?.yourSelections) && gameState.yourSelections.length > 0;
        const countdownZero = typeof gameState?.countdown === 'number' && gameState.countdown <= 0;
        const registrationExpired = gameState?.phase === 'registration' && countdownZero && !hasSelection;
        const msg = 'Registration time has ended due to low number of players. Please wait for the next game to start.';

        setAlertBanners(prev => {
            const hasExpiredMsg = prev.includes(msg);
            if (registrationExpired && !hasExpiredMsg) {
                return [...prev, msg];
            } else if (!registrationExpired && hasExpiredMsg) {
                return prev.filter(m => m !== msg);
            }
            return prev;
        });
    }, [gameState?.phase, gameState?.countdown, gameState?.yourSelections]);

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
            if (alertMsg === 'LOW BALANCE') {
                return;
            }
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


    // Super Bingo presale: local preview before confirm + pay
    const isSuperPresale = Number(stake) === 50
        && gameState.phase === 'registration'
        && (gameState.superMode === 'presale' || gameState.superMode === 'countdown');

    const lockedNumbers = Array.isArray(gameState.lockedSelections) && gameState.lockedSelections.length > 0
        ? gameState.lockedSelections.map(Number)
        : (isSuperPresale
            ? (Array.isArray(gameState.yourSelections) ? gameState.yourSelections.map(Number) : [])
            : []);

    useEffect(() => {
        setPendingSelections([]);
    }, [gameState.gameId]);

    useEffect(() => {
        if (gameState.superCountdownAlert) {
            setAlertBanners((prev) => (
                prev.includes(gameState.superCountdownAlert) ? prev : [...prev, gameState.superCountdownAlert]
            ));
            showWarning(gameState.superCountdownAlert);
        }
    }, [gameState.superCountdownAlert, showWarning]);

    useEffect(() => {
        if (gameState.walletUpdate) {
            setWallet({
                main: gameState.walletUpdate.main ?? 0,
                play: gameState.walletUpdate.play ?? 0,
            });
        }
    }, [gameState.walletUpdate]);

    useEffect(() => {
        if (!lastEvent || lastEvent.type !== 'selection_rejected') return;
        const reason = lastEvent.payload?.reason;
        if (reason === 'INSUFFICIENT_FUNDS') {
            const msg = 'LOW BALANCE';
            setAlertBanners((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
            showError(msg);
            const rejected = Number(lastEvent.payload?.cardNumber);
            if (Number.isInteger(rejected)) {
                setPendingSelections((prev) => prev.filter((n) => n !== rejected));
            }
        } else if (reason === 'LOCKED') {
            showError('This cartela is confirmed and locked.');
        }
    }, [lastEvent, showError]);

    const handleConfirmCartela = useCallback(async (cardNum) => {
        if (walletLoading) {
            showError('Loading wallet information. Please wait a moment and try again.');
            setPendingSelections((prev) => prev.filter((n) => n !== cardNum));
            return false;
        }
        const totalBalance = (wallet.main || 0) + (wallet.play || 0);
        if (totalBalance < Number(stake)) {
            const msg = totalBalance <= 0 ? 'LOW BALANCE' : 'Insufficient fund';
            setAlertBanners((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
            showError(msg);
            setPendingSelections((prev) => prev.filter((n) => n !== cardNum));
            return false;
        }
        if (!connected || wsReadyState !== WebSocket.OPEN) {
            showError('Not connected to game server. Please refresh and try again.');
            setPendingSelections((prev) => prev.filter((n) => n !== cardNum));
            return false;
        }
        const success = confirmCartella(cardNum);
        if (success) {
            setPendingSelections((prev) => prev.filter((n) => n !== cardNum));
            showSuccess(`Cartela #${cardNum} confirmed!`);
            return true;
        }
        showError('Failed to confirm cartela. Please try again.');
        setPendingSelections((prev) => prev.filter((n) => n !== cardNum));
        return false;
    }, [walletLoading, wallet.main, wallet.play, stake, connected, wsReadyState, confirmCartella, showError, showSuccess]);

    const handleCancelPending = useCallback((cardNum) => {
        setPendingSelections((prev) => prev.filter((n) => n !== cardNum));
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

        // Super Bingo presale: preview locally, confirm separately
        if (isSuperPresale) {
            if (lockedNumbers.includes(cardNum)) {
                return;
            }
            if (pendingSelections.includes(cardNum)) {
                setPendingSelections((prev) => prev.filter((n) => n !== cardNum));
                return;
            }
            if (lockedNumbers.length + pendingSelections.length >= MAX_CARTELAS_PER_PLAYER) {
                showError(`You can select up to ${MAX_CARTELAS_PER_PLAYER} cartelas.`);
                return;
            }
            const totalBalance = (wallet.main || 0) + (wallet.play || 0);
            if (totalBalance < Number(stake)) {
                const msg = totalBalance <= 0 ? 'LOW BALANCE' : 'Insufficient fund';
                setAlertBanners((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
                showError(msg);
                return;
            }
            const isTakenByOthers = gameState.takenCards.some((taken) => Number(taken) === cardNum)
                && !lockedNumbers.includes(cardNum)
                && !pendingSelections.includes(cardNum);
            if (isTakenByOthers) {
                const takenMsg = 'ተይዟል ሌላ ᭭ምረጡ';
                setAlertBanners((prev) => (prev.includes(takenMsg) ? prev : [...prev, takenMsg]));
                showError(takenMsg);
                return;
            }
            setPendingSelections((prev) => [...prev, cardNum]);
            return;
        }

        // Check if we're in the right phase first (for both select and deselect)
        if (gameState.phase !== 'registration') {
            // Friendly message when user tries to pick while a game is already running
            const waitMsg = 'Please wait until the current game finishes. You can select cartela when registration starts again.';
            
            // Add to alert banners (same style as "Insufficient fund" and "Not enough players")
            setAlertBanners(prev => {
                // Avoid duplicate messages
                if (prev.includes(waitMsg)) return prev;
                return [...prev, waitMsg];
            });
            
            showError(waitMsg);
            return;
        }

        // Check WebSocket connection
        if (!connected || wsReadyState !== WebSocket.OPEN) {
            showError('Not connected to game server. Please refresh and try again.');
            return;
        }

        // Toggle behavior: if already selected, deselect it
        if (selectedNumbers.includes(cardNum)) {
            try {
                console.log('Deselecting cartella:', cardNum);
                const success = deselectCartella(cardNum);
                if (success) {
                    showSuccess(`Cartella #${cardNum} deselected!`);
                    console.log('Cartella deselection sent successfully');
                } else {
                    showError('Failed to deselect cartella. Please try again.');
                }
            } catch (err) {
                console.error('Error deselecting cartella:', err);
                showError('Failed to deselect cartella. Please try again.');
            }
            return;
        }

        // Max cartelas per player
        if (selectedNumbers.length >= MAX_CARTELAS_PER_PLAYER) {
            showError(`You can select up to ${MAX_CARTELAS_PER_PLAYER} cartelas.`);
            return;
        }

        // Check if player has sufficient balance (stake per cartela)
        const totalBalance = (wallet.main || 0) + (wallet.play || 0);
        const needed = Number(stake) * (selectedNumbers.length + 1);
        const hasBalance = totalBalance >= needed;

        if (!hasBalance) {
            const msg = totalBalance <= 0 ? 'LOW BALANCE' : 'Insufficient fund';

            // Add banner to stack (like image showing multiple banners)
            setAlertBanners(prev => [...prev, msg]);

            showError(msg);
            return;
        }

        // Check if card is already taken by someone else
        const isTakenByOthers = gameState.takenCards.some(taken => Number(taken) === cardNum) && !selectedNumbers.includes(cardNum);
        if (isTakenByOthers) {
            const takenMsg = 'ተይዟል ሌላ ᭭ምረጡ';
            
            // Add to alert banners
            setAlertBanners(prev => {
                // Avoid duplicate messages
                if (prev.includes(takenMsg)) return prev;
                return [...prev, takenMsg];
            });
            
            showError(takenMsg);
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
                play: walletResponse.play ?? walletResponse.balance ?? 0
            });
        } catch (walletErr) {
            console.error('Error refreshing wallet from /wallet:', walletErr);
            // Fallback to /user/profile
            try {
                const profileResponse = await apiFetch('/user/profile', { sessionId });
                if (profileResponse.wallet) {
                    setWallet({
                        main: profileResponse.wallet.main ?? profileResponse.wallet.balance ?? 0,
                        play: profileResponse.wallet.play ?? profileResponse.wallet.balance ?? 0
                    });
                }
            } catch (profileErr) {
                console.error('Error refreshing wallet fallback from /user/profile:', profileErr);
            }
        } finally {
            setWalletLoading(false);
        }
    };

    console.log('CartelaSelection render - loading:', loading, 'error:', error, 'cards:', cards.length);

    // Derive a fresh timer value from registrationEndTime to avoid getting stuck at 0
    const timerSeconds = (gameState.phase === 'registration' && gameState.registrationEndTime)
        ? Math.max(0, Math.ceil((gameState.registrationEndTime - Date.now()) / 1000))
        : (gameState.countdown || 0);

    const selectedNumbers = Array.isArray(gameState.yourSelections) ? gameState.yourSelections : [];
    const highlightedNumbers = isSuperPresale
        ? [...new Set([...lockedNumbers, ...pendingSelections])]
        : selectedNumbers;
    const selectedCards = highlightedNumbers
        .map(n => ({ number: n, card: cards[n - 1] }))
        .filter(x => x.card);
    const soldCount = Array.isArray(gameState.takenCards) ? gameState.takenCards.length : 0;
    const balanceTotal = (wallet.main || 0) + (wallet.play || 0);
    const roomLabel = Number(stake) === 50 ? 'VIP' : `${stake} ETB`;

    const superScheduleLabel = (() => {
        const ms = gameState.scheduledStartAt;
        if (ms) {
            const eat = new Date(ms).toLocaleString('en-GB', {
                timeZone: 'Africa/Addis_Ababa',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
            });
            // Phone clock (EAT) — not traditional Ethiopian time (which is +6h)
            return `Next game: ${eat} (phone clock)`;
        }
        return 'Daily 11:00 AM (phone clock / EAT)';
    })();
    const superGameTypeLabel = 'ሙሉ ዝግ';
    const superTimeLabel = gameState.superMode === 'countdown'
        ? `${timerSeconds}s`
        : superScheduleLabel;

    const slotEntries = (() => {
        const entries = [];
        lockedNumbers.forEach((n) => entries.push({ type: 'confirmed', number: n }));
        pendingSelections.forEach((n) => entries.push({ type: 'pending', number: n }));
        while (entries.length < MAX_CARTELAS_PER_PLAYER) {
            entries.push({ type: 'empty', number: null });
        }
        return entries.slice(0, MAX_CARTELAS_PER_PLAYER);
    })();

    const renderSelectionSlot = (slotIndex) => {
        const entry = slotEntries[slotIndex];

        if (entry?.type === 'confirmed') {
            const card = cards[entry.number - 1];
            if (!card) return null;
            return (
                <div key={`slot-${slotIndex}`} className="cartela-slot cartela-slot-filled cartela-slot-confirmed">
                    <div className="cartela-slot-lock-badge" aria-hidden="true" title="Confirmed">
                        🔒
                    </div>
                    <div className="cartela-slot-meta">
                        <span className="cartela-slot-id">#{entry.number}</span>
                        <span className="cartela-slot-live cartela-slot-confirmed-label">CONFIRMED</span>
                    </div>
                    <div className="cartela-slot-card">
                        <CartellaCard
                            id={entry.number}
                            card={card}
                            called={gameState.calledNumbers || []}
                            isPreview={true}
                        />
                    </div>
                </div>
            );
        }

        if (entry?.type === 'pending') {
            const card = cards[entry.number - 1];
            if (!card) return null;
            return (
                <SuperPendingCartelaSlot
                    key={`slot-pending-${entry.number}`}
                    cardNumber={entry.number}
                    card={card}
                    called={gameState.calledNumbers || []}
                    onCancel={handleCancelPending}
                    onConfirm={handleConfirmCartela}
                />
            );
        }

        if (!isSuperPresale) {
            const legacy = selectedCards[slotIndex];
            if (legacy) {
                return (
                    <div key={`slot-${slotIndex}`} className="cartela-slot cartela-slot-filled">
                        <button
                            type="button"
                            className="cartela-slot-remove"
                            onClick={() => handleCardSelect(legacy.number)}
                            aria-label={`Remove cartela ${legacy.number}`}
                        >
                            ×
                        </button>
                        <div className="cartela-slot-meta">
                            <span className="cartela-slot-id">#{legacy.number}</span>
                            <span className="cartela-slot-live">LIVE</span>
                        </div>
                        <div className="cartela-slot-card">
                            <CartellaCard
                                id={legacy.number}
                                card={legacy.card}
                                called={gameState.calledNumbers || []}
                                isPreview={true}
                            />
                        </div>
                    </div>
                );
            }
        }

        return (
            <div key={`slot-${slotIndex}`} className="cartela-slot cartela-slot-empty">
                <span className="cartela-slot-plus">+</span>
                <span className="cartela-slot-empty-label">SLOT {slotIndex + 1} EMPTY</span>
            </div>
        );
    };

    // If we aren't ready to render the grid yet, show the loading animation instead of a blank screen.
    const cardsReady = Array.isArray(cards) && cards.length > 0;
    if (loading || !cardsReady) {
        console.log('Showing loading screen');
        return (
            <div className="app-container joy-bingo-bg">
                <header className="p-4">
                    {/* Wallet info during loading */}
                    <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                            <div className="wallet-box">
                                <div className="wallet-label">Wallet</div>
                                <div className="wallet-value text-blue-400">
                                    {walletLoading ? '...' : ((wallet.main || 0) + (wallet.play || 0)).toLocaleString()}
                                </div>
                            </div>
                            <div className="wallet-box">
                                <div className="wallet-label">Stake</div>
                                <div className="wallet-value">{stake}</div>
                            </div>
                        </div>
                        <div className="timer-box">
                            <div className="timer-countdown">
                                {timerSeconds}s
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
                        {/* Circular loading spinner */}
                        <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto"></div>
                        <p className="text-purple-600 font-medium mt-3">Loading...</p>
                    </div>
                </main>
                {/* <BottomNav current="game" onNavigate={onNavigate} /> */}
            </div>
        );
    }

    if (error) {
        console.log('Showing error screen:', error);
        return (
            <div className="app-container joy-bingo-bg">
                <header className="p-4">
                    {/* Wallet info during error */}
                    <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                            <div className="wallet-box">
                                <div className="wallet-label">Wallet</div>
                                <div className="wallet-value text-blue-400">
                                    {walletLoading ? '...' : ((wallet.main || 0) + (wallet.play || 0)).toLocaleString()}
                                </div>
                            </div>
                            <div className="wallet-box">
                                <div className="wallet-label">Stake</div>
                                <div className="wallet-value">{stake}</div>
                            </div>
                        </div>
                        <div className="timer-box">
                            <div className="timer-countdown">
                                {timerSeconds}s
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

                {/* Show error message with Retry */}
                <main className="p-4 flex flex-col items-center justify-center min-h-64">
                    <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg max-w-md">
                        <div className="flex items-center gap-2 text-yellow-400">
                            <span className="text-lg">⚠️</span>
                            <div>
                                <div className="font-semibold">Limited Mode</div>
                                <div className="text-sm text-yellow-300">{error}</div>
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setRetryCount((c) => c + 1)}
                        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Retry
                    </button>
                </main>
                {/* <BottomNav current="game" onNavigate={onNavigate} /> */}
            </div>
        );
    }

    return (
        <div className="app-container relative joy-bingo-bg cartela-selection-page">
            {/* Alert Banners - Fixed at top, stacked vertically with animations */}
            {Array.isArray(alertBanners) && alertBanners.length > 0 && (
                <div className="fixed top-0 left-0 right-0 z-50 px-2 pt-1 space-y-1">
                    {alertBanners.map((alertMsg, index) => (
                        <div 
                            key={index} 
                            className={`alert-banner-appeal animate-slide-in ${alertMsg === 'LOW BALANCE' ? 'alert-banner-low-balance' : ''}`}
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

            <div className={`cartela-selection-top ${isSuperPresale ? 'cartela-selection-top-super' : ''}`}>
                <header className="cartela-selection-header">
                    {isSuperPresale ? (
                        <div className="super-bingo-header">
                            <div className="super-bingo-bar super-bingo-bar-gold">
                                <div className="super-bingo-cell">
                                    <span className="super-bingo-label">SOLD</span>
                                    <span className="super-bingo-value">{soldCount}</span>
                                </div>
                                <div className="super-bingo-cell">
                                    <span className="super-bingo-label">REG CODE</span>
                                    <span className="super-bingo-value">{gameState.regCode || '---'}</span>
                                </div>
                                <div className="super-bingo-cell">
                                    <span className="super-bingo-label">BALANCE</span>
                                    <span className="super-bingo-value">
                                        {walletLoading ? '...' : balanceTotal.toFixed(0)}
                                    </span>
                                </div>
                            </div>
                            <div className="super-bingo-bar super-bingo-bar-dark">
                                <div className="super-bingo-cell">
                                    <span className="super-bingo-label">STAKE</span>
                                    <span className="super-bingo-value">{stake} ETB</span>
                                </div>
                                <div className="super-bingo-cell">
                                    <span className="super-bingo-label">የጨዋታ አይነት</span>
                                    <span className="super-bingo-value super-bingo-status">{superGameTypeLabel}</span>
                                </div>
                                <div className="super-bingo-cell super-bingo-cell-wide">
                                    <span className="super-bingo-label">TIME</span>
                                    <span className="super-bingo-schedule">{superTimeLabel}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="cartela-status-badges">
                            <div className="cs-badge cs-badge-room">
                                <span className="cs-badge-label">ROOM</span>
                                <span className="cs-badge-value">{roomLabel}</span>
                            </div>
                            <div className="cs-badge cs-badge-sold">
                                <span className="cs-badge-label">SOLD</span>
                                <span className="cs-badge-value">{soldCount}</span>
                            </div>
                            <div className="cs-badge cs-badge-time">
                                <span className="cs-badge-label cs-time-label">TIME</span>
                                <span className="cs-badge-value">{timerSeconds}s</span>
                            </div>
                            <div className="cs-badge cs-badge-balance">
                                <span className="cs-badge-label">BALANCE</span>
                                <span className="cs-badge-value">
                                    {walletLoading ? '...' : `${balanceTotal.toFixed(2)} ETB`}
                                </span>
                            </div>
                        </div>
                    )}
                </header>

                <div className="cartela-grid-panel">
                    <div className="cartela-grid-scrollable cartela-grid-scrollable-v2">
                        <div className="cartela-numbers-grid-8">
                            {Array.from({ length: cards.length }, (_, i) => i + 1).map((cartelaNumber) => {
                                // Ensure type consistency for comparison (convert to number)
                                const cartelaNum = Number(cartelaNumber);
                                
                                // For newcomers during running game: hide taken cards (show all as available)
                                // Only show taken cards during registration phase or if user has cards
                                const hasCards = Array.isArray(gameState.yourCards) && gameState.yourCards.length > 0;
                                const shouldShowTakenCards = gameState.phase === 'registration' || hasCards;
                                
                                const isTaken = shouldShowTakenCards 
                                    ? gameState.takenCards.some(taken => Number(taken) === cartelaNum)
                                    : false; // Hide taken cards for newcomers during running game
                                    
                                const takenByMe = highlightedNumbers.includes(cartelaNum);
                                const isSelected = takenByMe;
                                const isSold = isTaken && !takenByMe;

                                let btnClass = 'cartela-normal-light';
                                if (isSelected) btnClass = 'cartela-selected-light';
                                else if (isSold) btnClass = 'cartela-sold-light';

                                return (
                                    <button
                                        key={cartelaNumber}
                                        type="button"
                                        onClick={() => handleCardSelect(cartelaNum)}
                                        className={`cartela-number-btn-light ${btnClass}`}
                                        title={`Cartella #${cartelaNumber}`}
                                    >
                                        {cartelaNumber}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            <main className="cartela-selection-main cartela-selection-preview">
                <div className="cartela-slots-row">
                    {renderSelectionSlot(0)}
                    {renderSelectionSlot(1)}
                </div>
            </main>
        </div>
    );
}