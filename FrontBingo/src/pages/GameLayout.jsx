import React, { useEffect, useState, useRef, useCallback } from 'react';
import CartellaCard from '../components/CartellaCard';
import Winner from './Winner';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from '../lib/auth/AuthProvider';
import { useToast } from '../contexts/ToastContext';
import { playNumberSound, preloadNumberSounds } from '../lib/audio/numberSounds';
import '../styles/bingo-balls.css';
import '../styles/action-buttons.css';

const MISSED_BINGO_MSG = 'ይቅርታ የማሸነፍ እድልዎ አልፏል';
const INVALID_BINGO_MSG = 'Invalid BINGO! No winning pattern yet.';
/** Minimum time to claim BINGO after a winning pattern appears (next ball alone is not enough if it comes sooner). */
const WIN_CLAIM_MIN_MS = 5000;

function getBallLetter(number) {
    if (number <= 15) return 'B';
    if (number <= 30) return 'I';
    if (number <= 45) return 'N';
    if (number <= 60) return 'G';
    return 'O';
}

function formatBallLabel(number) {
    return `${getBallLetter(number)}-${number}`;
}

export default function GameLayout({
    stake,
    selectedCartelas,
    onNavigate,
    onResetToGame,
}) {
    const { sessionId } = useAuth();
    const { showSuccess, showError, showWarning } = useToast();
    const [showTimeout, setShowTimeout] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [alertBanners, setAlertBanners] = useState([]);
    const alertTimersRef = useRef(new Map());

    useEffect(() => {
        document.documentElement.classList.add('game-layout-active');
        document.body.classList.add('game-layout-active');
        return () => {
            document.documentElement.classList.remove('game-layout-active');
            document.body.classList.remove('game-layout-active');
        };
    }, []);

    // Function to check if player has a valid bingo pattern
    const checkBingoPattern = (cartella, calledNumbers) => {
        if (!cartella || !Array.isArray(cartella) || !Array.isArray(calledNumbers)) {
            return false;
        }

        // Check rows
        for (let i = 0; i < 5; i++) {
            if (cartella[i].every(num => num === 0 || calledNumbers.includes(num))) {
                return true;
            }
        }

        // Check columns
        for (let j = 0; j < 5; j++) {
            if (cartella.every(row => row[j] === 0 || calledNumbers.includes(row[j]))) {
                return true;
            }
        }

        // Check diagonals
        if (cartella.every((row, i) => row[i] === 0 || calledNumbers.includes(row[i]))) {
            return true;
        }
        if (cartella.every((row, i) => row[4 - i] === 0 || calledNumbers.includes(row[4 - i]))) {
            return true;
        }

        // Check four corners
        const topLeft = cartella[0][0];
        const topRight = cartella[0][4];
        const bottomLeft = cartella[4][0];
        const bottomRight = cartella[4][4];
        if (
            (topLeft === 0 || calledNumbers.includes(topLeft)) &&
            (topRight === 0 || calledNumbers.includes(topRight)) &&
            (bottomLeft === 0 || calledNumbers.includes(bottomLeft)) &&
            (bottomRight === 0 || calledNumbers.includes(bottomRight))
        ) {
            return true;
        }

        return false;
    };


    const { connected, gameState, claimBingo, connectToStake } = useWebSocket();

    // Use ONLY WebSocket data - no props fallbacks
    const currentPlayersCount = gameState.playersCount || 0;
    const currentPrizePool = gameState.prizePool || 0;
    const calledNumbers = gameState.calledNumbers || [];
    const currentNumber = gameState.currentNumber;
    const currentGameId = gameState.gameId;
    const yourCards = Array.isArray(gameState.yourCards) ? gameState.yourCards : [];

    // Sound control
    const [isSoundOn, setIsSoundOn] = useState(false);

    // Manually marked numbers per cartela: { cardNumber: Set<number> }
    const [manuallyMarkedNumbers, setManuallyMarkedNumbers] = useState({});
    const [isManualClaiming, setIsManualClaiming] = useState(false);
    const [startCountdown, setStartCountdown] = useState(0);

    /** Cartelas locked after a false BINGO claim — show "ታስሯል" banner. */
    const [lockedCartelaIds, setLockedCartelaIds] = useState([]);

    /** User had a winning pattern but did not tap BINGO in time. */
    const [missedClaimWindow, setMissedClaimWindow] = useState(false);
    /** Called numbers when the win opportunity opened — drives red pattern cells. */
    const [missedPatternCalledSnapshot, setMissedPatternCalledSnapshot] = useState(null);

    // Track if we've already claimed bingo for this game to prevent duplicate claims
    const claimedBingoRef = useRef(false);
    const lastGameIdRef = useRef(null);
    const lastClaimCardRef = useRef(null);
    const yourCardsRef = useRef([]);
    /** When a win pattern first completes: { startedAt, callCount, snapshot }. */
    const winOpportunityRef = useRef(null);
    const hadWinPatternRef = useRef(false);

    useEffect(() => {
        yourCardsRef.current = yourCards;
    }, [yourCards]);

    const isCartelaLocked = useCallback(
        (cardNumber) => lockedCartelaIds.includes(Number(cardNumber)),
        [lockedCartelaIds]
    );

    const lockCartela = useCallback((cardNumber) => {
        const id = Number(cardNumber);
        setLockedCartelaIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        setManuallyMarkedNumbers((prev) => {
            if (!prev[id]) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
    }, []);
    
    // Connect to WebSocket when component mounts with stake
    useEffect(() => {
        if (stake && sessionId) {
            connectToStake(stake);
        }
    }, [stake, sessionId, connectToStake]);

    // Handle page visibility changes to maintain connection
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && stake && sessionId) {
                // Small delay to let the page fully load
                setTimeout(() => {
                    if (!connected) {
                        connectToStake(stake);
                    }
                }, 100);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [stake, sessionId, connected, connectToStake]);

    // Preload sounds on first user toggle on (or mount if desired)
    useEffect(() => {
        // Attempt a deferred preload to speed up first play; ignore failures on restricted devices
        const id = setTimeout(() => {
            try { preloadNumberSounds(); } catch { /* noop */ }
        }, 1000);
        return () => clearTimeout(id);
    }, []);

    // Play sound when a new number arrives and sound is enabled
    useEffect(() => {
        if (isSoundOn && typeof currentNumber === 'number') {
            playNumberSound(currentNumber).catch(() => { });
        }
    }, [currentNumber, isSoundOn]);

    // Reset bingo claim tracking when game changes
    useEffect(() => {
        if (currentGameId !== lastGameIdRef.current) {
            claimedBingoRef.current = false;
            lastGameIdRef.current = currentGameId;
            winOpportunityRef.current = null;
            hadWinPatternRef.current = false;
            setMissedClaimWindow(false);
            setMissedPatternCalledSnapshot(null);
            setLockedCartelaIds([]);
            lastClaimCardRef.current = null;
        }
    }, [currentGameId]);

    // Start win-opportunity timer when any cartela first completes a pattern
    useEffect(() => {
        if (gameState.phase !== 'running' || yourCards.length === 0) {
            winOpportunityRef.current = null;
            hadWinPatternRef.current = false;
            setMissedClaimWindow(false);
            setMissedPatternCalledSnapshot(null);
            return;
        }

        if (claimedBingoRef.current || missedClaimWindow) {
            return;
        }

        const hasWinPattern = yourCards.some(({ card }) => checkBingoPattern(card, calledNumbers));

        if (hasWinPattern && !hadWinPatternRef.current) {
            winOpportunityRef.current = {
                startedAt: Date.now(),
                callCount: calledNumbers.length,
                snapshot: [...calledNumbers],
            };
        }

        if (!hasWinPattern) {
            winOpportunityRef.current = null;
        }

        hadWinPatternRef.current = hasWinPattern;
    }, [calledNumbers, gameState.phase, yourCards, currentGameId, missedClaimWindow]);

    // Close claim window after min 5s AND next ball (whichever is later — fast draws still get 5s)
    useEffect(() => {
        if (gameState.phase !== 'running' || missedClaimWindow) {
            return;
        }

        const evaluateMissedWindow = () => {
            const opp = winOpportunityRef.current;
            if (!opp || claimedBingoRef.current) {
                return;
            }

            const elapsed = Date.now() - opp.startedAt;
            const nextBallDrawn = calledNumbers.length > opp.callCount;

            if (nextBallDrawn && elapsed >= WIN_CLAIM_MIN_MS) {
                setMissedClaimWindow(true);
                setMissedPatternCalledSnapshot(opp.snapshot);
                winOpportunityRef.current = null;
            }
        };

        evaluateMissedWindow();
        const intervalId = setInterval(evaluateMissedWindow, 250);
        return () => clearInterval(intervalId);
    }, [calledNumbers.length, gameState.phase, missedClaimWindow, currentGameId]);

    // Handle manual number marking/unmarking
    const handleNumberToggle = useCallback((cardNumber, number) => {
        if (missedClaimWindow) return;
        if (isCartelaLocked(cardNumber)) return;

        setManuallyMarkedNumbers(prev => {
            const cardMarks = prev[cardNumber] || new Set();
            const newCardMarks = new Set(cardMarks);
            
            if (newCardMarks.has(number)) {
                newCardMarks.delete(number); // Unmark
            } else {
                newCardMarks.add(number); // Mark
            }
            
            return {
                ...prev,
                [cardNumber]: newCardMarks
            };
        });
    }, [missedClaimWindow, isCartelaLocked]);

    const getMarkedNumbersForCard = useCallback((cardNumber) => {
        const marksSet = manuallyMarkedNumbers[cardNumber];
        return marksSet ? Array.from(marksSet) : [];
    }, [manuallyMarkedNumbers]);

    const cardHasValidBingo = useCallback((cardNumber, card) => {
        if (!card || !Array.isArray(calledNumbers) || calledNumbers.length === 0) {
            return false;
        }
        if (!checkBingoPattern(card, calledNumbers)) {
            return false;
        }
        const marks = manuallyMarkedNumbers[cardNumber];
        if (!marks || marks.size === 0) {
            return false;
        }
        for (const n of marks) {
            if (n !== 0 && !calledNumbers.includes(n)) {
                return false;
            }
        }
        return true;
    }, [calledNumbers, manuallyMarkedNumbers]);

    const handleCardBingo = useCallback((cardNumber, card) => {
        if (!connected || gameState.phase !== 'running' || !currentGameId) {
            return;
        }

        if (isCartelaLocked(cardNumber)) {
            return;
        }

        if (missedClaimWindow) {
            setAlertBanners(prev =>
                prev.includes(MISSED_BINGO_MSG) ? prev : [...prev, MISSED_BINGO_MSG]
            );
            showError(MISSED_BINGO_MSG);
            return;
        }

        if (claimedBingoRef.current || isManualClaiming) {
            return;
        }

        if (!cardHasValidBingo(cardNumber, card)) {
            lockCartela(cardNumber);
            const errorMsg = 'Invalid BINGO! ትክክለኛ አልሆነም።';
            setAlertBanners(prev => (prev.includes(errorMsg) ? prev : [...prev, errorMsg]));
            showError(INVALID_BINGO_MSG);
            return;
        }

        try {
            setIsManualClaiming(true);
            claimedBingoRef.current = true;
            lastClaimCardRef.current = cardNumber;
            const marks = getMarkedNumbersForCard(cardNumber);
            const result = claimBingo({ cardNumber, markedNumbers: marks });
            if (!result) {
                claimedBingoRef.current = false;
                lastClaimCardRef.current = null;
                showError('Failed to send BINGO claim. Please try again.');
            } else {
                showSuccess('BINGO claim sent! Waiting for confirmation...');
            }
        } catch (error) {
            console.error('Error sending BINGO claim:', error);
            claimedBingoRef.current = false;
            lastClaimCardRef.current = null;
            showError('Failed to send BINGO claim. Please try again.');
        } finally {
            setIsManualClaiming(false);
        }
    }, [
        cardHasValidBingo,
        claimBingo,
        connected,
        currentGameId,
        gameState.phase,
        getMarkedNumbersForCard,
        isCartelaLocked,
        isManualClaiming,
        lockCartela,
        missedClaimWindow,
        showError,
        showSuccess
    ]);

    // NO automatic winning or auto-claim: players must always tap the BINGO button.

    // Local 3-2-1 countdown before the first ball is drawn
    useEffect(() => {
        if (gameState.phase !== 'running') {
            setStartCountdown(0);
            return;
        }

        if (calledNumbers.length > 0) {
            setStartCountdown(0);
            return;
        }

        setStartCountdown(3);
    }, [gameState.phase, calledNumbers.length, currentGameId]);

    // Tick the countdown down each second
    useEffect(() => {
        if (startCountdown <= 0) return;

        const timer = setTimeout(() => {
            setStartCountdown(prev => (prev > 0 ? prev - 1 : 0));
        }, 1000);

        return () => clearTimeout(timer);
    }, [startCountdown]);

    // Handle refresh button click - refresh game data without full page reload
    const handleRefresh = async () => {
        try {
            setIsRefreshing(true);
            showSuccess('🔄 Refreshing game data...');

            // Add a small delay to prevent rapid reconnections
            await new Promise(resolve => setTimeout(resolve, 100));

            // Reconnect to WebSocket to get fresh data
            if (stake && sessionId) {
                connectToStake(stake);
                // Add another small delay to let the connection stabilize
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            showSuccess('✅ Game data refreshed successfully!');
        } catch (error) {
            showError('❌ Failed to refresh game data. Please check your connection.');
        } finally {
            setIsRefreshing(false);
        }
    };

    const announceToastGameIdRef = useRef(null);

    // Toast when a round ends (Winner overlay shows on this screen — no page navigation)
    useEffect(() => {
        if (gameState.phase !== 'announce' || isRefreshing) return;
        if (announceToastGameIdRef.current === currentGameId) return;
        announceToastGameIdRef.current = currentGameId;

        const winners = gameState.winners || [];
        if (winners.length > 0) {
            const winnerNames = winners.map(w => w.name || 'Player').join(', ');
            if (winners.some(w => w.userId === sessionId)) {
                showSuccess(`🎉 Congratulations! You won! ${winners.length > 1 ? `(Shared with ${winners.length - 1} other${winners.length > 2 ? 's' : ''})` : ''}`);
            } else {
                showSuccess(`🏆 Game Over! Winner${winners.length > 1 ? 's' : ''}: ${winnerNames}`);
            }
        } else {
            showSuccess('🏆 Game Over!');
        }
    }, [gameState.phase, gameState.winners, sessionId, isRefreshing, showSuccess, currentGameId]);

    useEffect(() => {
        if (gameState.phase === 'registration') {
            announceToastGameIdRef.current = null;
        }
    }, [gameState.phase]);

    // Timeout mechanism for when gameId is not available
    useEffect(() => {
        if (!currentGameId) {
            const timeout = setTimeout(() => {
                setShowTimeout(true);
            }, 5000); // 5 second timeout

            return () => clearTimeout(timeout);
        } else {
            setShowTimeout(false);
        }
    }, [currentGameId]);
    
    // Debug logging
    useEffect(() => {
        console.log('🎯 GameLayout state:', {
            phase: gameState.phase,
            yourCardsCount: yourCards.length,
            yourCards: yourCards,
            playersCount: currentPlayersCount,
            prizePool: currentPrizePool,
            calledNumbersCount: calledNumbers.length,
            gameId: currentGameId
        });
    }, [gameState.phase, yourCards.length, currentPlayersCount, currentPrizePool, calledNumbers.length, currentGameId]);


    // Reset local state when game phase changes to registration
    useEffect(() => {
        if (gameState.phase === 'registration') {
            // Clear any local state that might interfere with new game
            setShowTimeout(false);
            setIsRefreshing(false);
            // Reset bingo claim tracking for new game
            claimedBingoRef.current = false;
            calledLenEvalRef.current = -1;
            setMissedClaimWindow(false);
            setMissedPatternCalledSnapshot(null);
            setLockedCartelaIds([]);
            lastClaimCardRef.current = null;
        }
    }, [gameState.phase]);

    // Handle invalid BINGO claim from server: clear marks and lock cartela with "ታስሯል"
    useEffect(() => {
        const handleBingoRejected = () => {
            claimedBingoRef.current = false;
            setManuallyMarkedNumbers({});

            const cardToLock = lastClaimCardRef.current;
            const fallbackIds = yourCardsRef.current.map(({ cardNumber }) => Number(cardNumber));
            const idsToLock = cardToLock != null ? [Number(cardToLock)] : fallbackIds;

            setLockedCartelaIds((prev) => [...new Set([...prev, ...idsToLock])]);
            lastClaimCardRef.current = null;

            const errorMsg = 'Invalid BINGO! ትክክለኛ አልሆነም። ሁሉም ምልክቶችዎ ተሰርዘዋል።';
            setAlertBanners(prev => {
                if (prev.includes(errorMsg)) return prev;
                return [...prev, errorMsg];
            });
            showError(INVALID_BINGO_MSG);
        };
        window.addEventListener('bingoRejected', handleBingoRejected);
        return () => window.removeEventListener('bingoRejected', handleBingoRejected);
    }, [showError]);

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

        // Cleanup function
        return () => {
            // Don't clear here - let timers complete naturally
        };
    }, [alertBanners]);

    // Cleanup timers on component unmount
    useEffect(() => {
        return () => {
            alertTimersRef.current.forEach(timer => clearTimeout(timer));
            alertTimersRef.current.clear();
        };
    }, []);

    // Show refreshing state to prevent black page
    if (isRefreshing) {
        return (
            <div className="app-container game-layout-page flex items-center justify-center">
                <div className="text-center text-gray-900">
                    <div className="relative">
                        <div className="animate-spin rounded-full h-16 w-16 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="animate-pulse text-2xl">🎮</div>
                        </div>
                    </div>
                    <div className="flex items-center justify-center space-x-1">
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                </div>
            </div>
        );
    }

    // If we don't have a gameId and we're not connected, show loading state
    if (!currentGameId && !connected && !isRefreshing) {
        return (
            <div className="app-container game-layout-page flex items-center justify-center">
                <div className="text-center text-gray-900">
                    <div className="text-2xl mb-4">🎮</div>
                    <div className="text-lg mb-2">Connecting to game...</div>
                    <div className="text-sm text-gray-300 mb-4">Please wait while we connect to the game</div>
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>


                    {showTimeout && (
                        <div className="mt-4">
                            <div className="text-sm text-yellow-300 mb-2">Taking longer than expected?</div>
                            <button
                                onClick={() => onNavigate?.('cartela-selection')}
                                className="px-6 py-3 bg-pink-600 text-white rounded-lg font-semibold hover:bg-pink-700 transition-colors"
                            >
                                Back to Cartella Selection
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // If we're connected but don't have gameId yet, wait a bit longer for the snapshot
    // This handles both 'waiting' phase and 'running' phase where gameId hasn't arrived yet
    if (!currentGameId && connected && (gameState.phase === 'waiting' || gameState.phase === 'running')) {
        return (
            <div className="app-container game-layout-page flex items-center justify-center">
                <div className="text-center text-gray-900">
                    <div className="relative">
                        <div className="animate-spin rounded-full h-16 w-16 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="animate-pulse text-2xl">🎮</div>
                        </div>
                    </div>
                    <div className="flex items-center justify-center space-x-1">
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                    <div className="text-sm text-gray-300 mt-4">
                        {gameState.phase === 'running' ? 'Game started, loading...' : 'Waiting for game...'}
                    </div>
                </div>
            </div>
        );
    }

    // If we have a gameId but it's still loading, show a different loading state
    if (!currentGameId && connected) {
        return (
            <div className="app-container game-layout-page flex items-center justify-center">
                <div className="text-center text-gray-900">
                    <div className="relative">
                        <div className="animate-spin rounded-full h-16 w-16 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="animate-pulse text-2xl">🎮</div>
                        </div>
                    </div>
                    <div className="flex items-center justify-center space-x-1">
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                </div>
            </div>
        );
    }


    // Determine game phase display
    const hasPlayableCartelas = yourCards.length >= 1 && yourCards.length <= 2;
    const hasTwoCartelas = yourCards.length === 2;
    const roomLabel = Number(stake) === 50 ? 'VIP 💰💰' : `${stake || 10} ETB`;

    return (
        <div className="app-container relative game-layout-page">
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

            <div className="game-layout-shell">
                <div className="game-layout-header-wrap">
                    <header className="game-layout-header">
                        <div className="gl-stat">
                            <span className="gl-stat-label">DERASH</span>
                            <span className="gl-stat-value gl-stat-green">{currentPrizePool || 0} ETB</span>
                        </div>
                        <div className="gl-stat">
                            <span className="gl-stat-label">BALLS</span>
                            <span className="gl-stat-value">{calledNumbers.length}/75</span>
                        </div>
                        <div className="gl-stat">
                            <span className="gl-stat-label">PLAYERS</span>
                            <span className="gl-stat-value gl-stat-yellow">{currentPlayersCount || 0}</span>
                        </div>
                    </header>
                    <div
                        className={`gl-current-ball gl-ball-${
                            startCountdown > 0 && calledNumbers.length === 0
                                ? 'countdown'
                                : currentNumber
                                    ? getBallLetter(currentNumber).toLowerCase()
                                    : 'empty'
                        }`}
                        aria-live={startCountdown > 0 && calledNumbers.length === 0 ? 'polite' : undefined}
                    >
                        {startCountdown > 0 && calledNumbers.length === 0
                            ? startCountdown
                            : currentNumber
                                ? formatBallLabel(currentNumber)
                                : '--'}
                    </div>
                </div>

                <div className="game-layout-main">
                    <div className="game-layout-left-col">
                        <div className="bingo-grid-container gl-master-board">
                        <div className="grid grid-cols-5 gl-master-grid">
                            {/* B Column */}
                            <div className="gl-master-col">
                                <div className="bingo-letter-square bingo-letter-b">
                                    <span>B</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 1).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    // Current number = green, old called = orange, normal = light purple
                                    const className = isCurrentNumber 
                                        ? 'current-number' 
                                        : isCalled 
                                            ? 'called-orange' 
                                            : 'bingo-number-default';
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            className={`bingo-number-btn ${className}`}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* I Column - Green */}
                            <div className="gl-master-col">
                                <div className="bingo-letter-square bingo-letter-i">
                                    <span>I</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 16).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    const className = isCurrentNumber 
                                        ? 'current-number' 
                                        : isCalled 
                                            ? 'called-orange' 
                                            : 'bingo-number-default';
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            className={`bingo-number-btn ${className}`}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* N Column - Purple */}
                            <div className="gl-master-col">
                                <div className="bingo-letter-square bingo-letter-n">
                                    <span>N</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 31).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    const className = isCurrentNumber 
                                        ? 'current-number' 
                                        : isCalled 
                                            ? 'called-orange' 
                                            : 'bingo-number-default';
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            className={`bingo-number-btn ${className}`}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* G Column - Red */}
                            <div className="gl-master-col">
                                <div className="bingo-letter-square bingo-letter-g">
                                    <span>G</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 46).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    const className = isCurrentNumber 
                                        ? 'current-number' 
                                        : isCalled 
                                            ? 'called-orange' 
                                            : 'bingo-number-default';
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            className={`bingo-number-btn ${className}`}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* O Column - Pink/Magenta */}
                            <div className="gl-master-col">
                                <div className="bingo-letter-square bingo-letter-o">
                                    <span>O</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 61).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    const className = isCurrentNumber 
                                        ? 'current-number' 
                                        : isCalled 
                                            ? 'called-orange' 
                                            : 'bingo-number-default';
                                    return (
                                        <button
                                            key={n}
                                            type="button"
                                            className={`bingo-number-btn ${className}`}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                        </div>
                        </div>

                        <div className="gl-left-footer">
                            <div className="gl-left-footer-row">
                                <span className="gl-left-footer-room">ROOM</span>
                                <button
                                    type="button"
                                    className="gl-refresh-btn"
                                    onClick={handleRefresh}
                                    disabled={isRefreshing}
                                >
                                    <span className="gl-refresh-icon" aria-hidden="true">↻</span>
                                    {isRefreshing ? '...' : 'REFRESH'}
                                </button>
                            </div>
                            <div className="gl-left-footer-vip">{roomLabel}</div>
                        </div>
                    </div>

                    {/* Right Side */}
                    <div className="right-side-container game-layout-right">
                        <div className="gl-right-top">
                            <div className="gl-call-strip">
                                <div className={`recent-numbers-joy gl-recent-numbers ${calledNumbers.length === 0 ? 'recent-numbers-empty' : ''}`}>
                                    {calledNumbers.length === 0 ? (
                                        <span className="recent-numbers-placeholder">—</span>
                                    ) : (
                                        (() => {
                                            let recent = currentNumber
                                                ? calledNumbers.filter((n) => n !== currentNumber).slice(-3)
                                                : calledNumbers.slice(-3);
                                            if (recent.length === 0) recent = calledNumbers.slice(-3);
                                            return recent.map((n, index) => {
                                                const letter = getBallLetter(n);
                                                return (
                                                    <div key={`recent-${n}-${index}`} className={`recent-number-circle recent-number-${letter.toLowerCase()}`}>
                                                        {`${letter}${n}`}
                                                    </div>
                                                );
                                            });
                                        })()
                                    )}
                                </div>
                            </div>
                        </div>

                        {hasPlayableCartelas ? (
                            <div className={hasTwoCartelas ? 'user-cartelas-stack' : 'user-cartelas-single-play'}>
                                {yourCards.map(({ cardNumber, card }) => {
                                    const markedNumbers = manuallyMarkedNumbers[cardNumber]
                                        ? Array.from(manuallyMarkedNumbers[cardNumber])
                                        : [];
                                    const bingoReady = cardHasValidBingo(cardNumber, card);
                                    const isLocked = isCartelaLocked(cardNumber);

                                    return (
                                        <div key={cardNumber} className={`gl-cartela-card-wrap ${isLocked ? 'gl-cartela-locked' : ''}`}>
                                            <div className="gl-cartela-card-body">
                                                <CartellaCard
                                                    id={cardNumber}
                                                    card={card}
                                                    called={markedNumbers}
                                                    isPreview={false}
                                                    showHeader={true}
                                                    onNumberToggle={
                                                        !missedClaimWindow && !isLocked
                                                            ? (number) => handleNumberToggle(cardNumber, number)
                                                            : undefined
                                                    }
                                                    missedWinningCalledNumbers={
                                                        missedClaimWindow && missedPatternCalledSnapshot
                                                            ? missedPatternCalledSnapshot
                                                            : null
                                                    }
                                                />
                                                {isLocked && (
                                                    <div className="cartela-lock-overlay" aria-hidden="true">
                                                        <div className="cartela-lock-banner">ታስሯል</div>
                                                    </div>
                                                )}
                                            </div>
                                            {isLocked && (
                                                <div className="cartela-lock-footer" aria-hidden="true">ታስሯል</div>
                                            )}
                                            {gameState.phase === 'running' && (
                                                <button
                                                    type="button"
                                                    className={`cartela-bingo-btn ${bingoReady && !isLocked ? 'cartela-bingo-btn--ready' : ''} ${isManualClaiming ? 'loading' : ''} ${isLocked ? 'cartela-bingo-btn--locked' : ''}`}
                                                    onClick={() => handleCardBingo(cardNumber, card)}
                                                    disabled={
                                                        !connected ||
                                                        !currentGameId ||
                                                        claimedBingoRef.current ||
                                                        isManualClaiming ||
                                                        missedClaimWindow ||
                                                        isLocked
                                                    }
                                                >
                                                    <span className="cartela-bingo-text">BINGO!</span>
                                                    <span className="cartela-bingo-id">#{cardNumber}</span>
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="game-watch-panel">
                                <div className="game-watch-hourglass" aria-hidden="true">⏳</div>
                                <h2 className="game-watch-title">GAME IN PROGRESS</h2>
                                <p className="game-watch-subtitle">PLEASE WAIT FOR THE NEXT BUYING ROUND TO JOIN.</p>
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {gameState.phase === 'announce' && (
                <Winner onNavigate={onNavigate} overlay />
            )}
        </div>
    );
}