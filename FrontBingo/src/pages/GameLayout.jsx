import React, { useEffect, useState, useRef, useCallback } from 'react';
import CartellaCard from '../components/CartellaCard';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from '../lib/auth/AuthProvider';
import { useToast } from '../contexts/ToastContext';
import { playNumberSound, preloadNumberSounds } from '../lib/audio/numberSounds';
import BottomNav from '../components/BottomNav';
import '../styles/bingo-balls.css';
import '../styles/action-buttons.css';

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
    
    // Auto-mark control (green or light purple)
    const [isAutoMarkOn, setIsAutoMarkOn] = useState(false);
    
    // Track if user has manually toggled auto-mark off (to prevent auto-enabling again)
    const userManuallyDisabledRef = useRef(false);
    
    // Track manually marked numbers per cartela when auto-mark is OFF
    // Structure: { cardNumber: Set<number> }
    const [manuallyMarkedNumbers, setManuallyMarkedNumbers] = useState({});
    const [isManualClaiming, setIsManualClaiming] = useState(false);
    const [startCountdown, setStartCountdown] = useState(0);
    
    // Reset manually marked numbers when auto-mark is turned back ON
    useEffect(() => {
        if (isAutoMarkOn && Object.keys(manuallyMarkedNumbers).length > 0) {
            setManuallyMarkedNumbers({});
        }
    }, [isAutoMarkOn]);
    
    // Single-cartela mode: no auto-mark forcing based on card count
    
    // Track if we've already claimed bingo for this game to prevent duplicate claims
    const claimedBingoRef = useRef(false);
    const lastGameIdRef = useRef(null);

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
            // Keep manually marked numbers when new game starts (don't clear them)
        }
    }, [currentGameId]);

    // Handle manual number marking/unmarking
    const handleNumberToggle = useCallback((cardNumber, number) => {
        if (isAutoMarkOn) return; // Don't allow manual marking when auto-mark is ON
        
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
    }, [isAutoMarkOn]);

    // Manual BINGO claim button handler (single cartela)
    const handleManualBingo = useCallback(() => {
        if (!connected || gameState.phase !== 'running' || !currentGameId) {
            return;
        }

        if (claimedBingoRef.current || isManualClaiming) {
            return;
        }

        try {
            setIsManualClaiming(true);
            console.log('📨 Manual BINGO claim sent by user');
            claimedBingoRef.current = true;
            const result = claimBingo();
            if (!result) {
                console.warn('Manual BINGO claim send failed');
                claimedBingoRef.current = false;
                showError('Failed to send BINGO claim. Please try again.');
            } else {
                showSuccess('BINGO claim sent! Waiting for confirmation...');
            }
        } catch (error) {
            console.error('Error sending manual BINGO claim:', error);
            claimedBingoRef.current = false;
            showError('Failed to send BINGO claim. Please try again.');
        } finally {
            setIsManualClaiming(false);
        }
    }, [claimBingo, connected, currentGameId, gameState.phase, isManualClaiming, showError, showSuccess]);

    // NO automatic winning or auto-claim: players must always tap the BINGO button.

    // Local 3-2-1 countdown before showing "STARTED" in status box
    useEffect(() => {
        // Reset countdown when game changes or leaves running phase
        if (gameState.phase !== 'running') {
            setStartCountdown(0);
            return;
        }

        // Only trigger countdown at the very beginning of a running game (no numbers called yet)
        if (gameState.phase === 'running' && calledNumbers.length === 0) {
            setStartCountdown(3);
        }
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

    // Navigate to winner page when phase enters announce
    useEffect(() => {
        if (gameState.phase === 'announce' && !isRefreshing) {
            // Show winner announcement
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

            // Navigate to winner page for all users
            onNavigate?.('winner');
        }
    }, [gameState.phase, gameState.winners, sessionId, onNavigate, isRefreshing, showSuccess]);

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
        }
    }, [gameState.phase]);

    // Handle invalid BINGO claim: clear all manual marks as punishment, allow retry
    useEffect(() => {
        const handleBingoRejected = () => {
            claimedBingoRef.current = false;
            setManuallyMarkedNumbers({});
            const errorMsg = 'Invalid BINGO! ትክክለኛ አልሆነም። ሁሉም ምልክቶችዎ ተሰርዘዋል።';
            setAlertBanners(prev => {
                // Avoid duplicate messages
                if (prev.includes(errorMsg)) return prev;
                return [...prev, errorMsg];
            });
        };
        window.addEventListener('bingoRejected', handleBingoRejected);
        return () => window.removeEventListener('bingoRejected', handleBingoRejected);
    }, []);

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
            <div className="app-container flex items-center justify-center p-4">
                <div className="text-center text-white">
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
            <div className="app-container flex items-center justify-center">
                <div className="text-center text-white">
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
            <div className="app-container flex items-center justify-center">
                <div className="text-center text-white">
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
            <div className="app-container flex items-center justify-center">
                <div className="text-center text-white">
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
    const gamePhaseDisplay = (gameState.phase === 'running' || gameState.phase === 'playing') ? 'STARTED' : gameState.phase === 'registration' ? 'REGISTRATION' : 'WAITING';
    const hasSingleCartela = yourCards.length === 1;
    const isWatchMode = yourCards.length === 0;
    const statusText = startCountdown > 0 ? startCountdown : gamePhaseDisplay;
    // For a single cartela, keep a fixed main content height so the left BINGO grid can stretch
    // and distribute numbers vertically (fills the empty space).
    const mainContentHeight = (hasSingleCartela || isWatchMode) ? '500px' : 'calc(100vh - 180px)';
    // Make left BINGO columns narrower and right side larger when showing single cartela,
    // otherwise keep 1:1 split.
    const gridTemplateColumns = (hasSingleCartela || isWatchMode) ? '0.8fr 1.2fr' : '1fr 1fr';

    return (
        <div className="app-container relative overflow-hidden joy-bingo-bg">
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

            <div className="max-w-md mx-auto px-3 py-3 relative z-10">
                {/* Top Information Bar - Light Purple Style */}
                <div
                    className="game-info-bar-light flex items-stretch rounded-lg flex-nowrap mobile-info-bar"
                    style={{ marginBottom: '1rem' }}
                >
                    <div className="info-box flex-1">
                        <div className="info-label">Derash</div>
                        <div className="info-value">{currentPrizePool || 0}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Players</div>
                        <div className="info-value">{currentPlayersCount || 0}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Bet</div>
                        <div className="info-value">{stake || 0}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Call</div>
                        <div className="info-value">{calledNumbers.length || 0}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Game Nº</div>
                        <div className="info-value truncate">{currentGameId ? currentGameId.replace('LB', '') : '1'}</div>
                    </div>
                </div>



                {/* Main Content Area - Mobile-First 2 Column Layout */}
                <div
                    className="main-content-area mobile-first-grid"
                    style={{
                        display: 'grid',
                        gridTemplateColumns,
                        gap: '0.1rem',
                        padding: '0.15rem',
                        marginTop: '0.75rem',
                        marginBottom: '0.75rem',
                        marginRight: '0.15rem',
                        height: mainContentHeight,
                        maxHeight: '500px'
                    }}
                >
                    {/* Left Card - BINGO Grid with Square Letters */}
                    <div
                        className="bingo-grid-container"
                        style={{
                            height: '100%',
                            overflow: 'hidden'
                        }}
                    >
                        <div
                            className="grid grid-cols-5 gap-1"
                            style={{
                                height: '100%'
                            }}
                        >
                            {/* B Column - Yellow */}
                            <div className="space-y-1" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            className={`bingo-number-btn ${className}`}
                                            style={{
                                                flex: '1',
                                                minHeight: '20px',
                                                marginBottom: 4
                                            }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* I Column - Green */}
                            <div className="space-y-1" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            className={`bingo-number-btn ${className}`}
                                            style={{
                                                flex: '1',
                                                minHeight: '20px',
                                                marginBottom: 4
                                            }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* N Column - Purple */}
                            <div className="space-y-1" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            className={`bingo-number-btn ${className}`}
                                            style={{
                                                flex: '1',
                                                minHeight: '20px',
                                                marginBottom: 4
                                            }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* G Column - Red */}
                            <div className="space-y-1" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            className={`bingo-number-btn ${className}`}
                                            style={{
                                                flex: '1',
                                                minHeight: '20px',
                                                marginBottom: 4
                                            }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* O Column - Pink/Magenta */}
                            <div className="space-y-1" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            className={`bingo-number-btn ${className}`}
                                            style={{
                                                flex: '1',
                                                minHeight: '20px',
                                                marginBottom: 4
                                            }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                        </div>
                    </div>

                    {/* Right Side - Joy Bingo Style */}
                    <div
                        className="right-side-container"
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.75rem',
                            marginLeft: '0.25rem',
                            height: '100%',
                            justifyContent: 'space-between'
                        }}
                    >
                        {/* Control Bar - Joy Bingo style STARTED pill (single box) */}
                        <div className="game-controls-bar">
                            {startCountdown > 0 ? (
                                <div className="countdown-circle">
                                    <div className="countdown-glow"></div>
                                    <span className="countdown-number">
                                        {startCountdown}
                                    </span>
                                </div>
                            ) : (
                                <span className="game-status-text-small">
                                    {gamePhaseDisplay}
                                </span>
                            )}
                        </div>

                        {/* Current Call Bar */}
                        <div className="current-call-bar">
                            <span className="current-call-label">Current Call</span>
                            {currentNumber ? (
                                <div className="current-call-ball">
                                    {(() => {
                                        const letter = currentNumber <= 15 ? 'B' : currentNumber <= 30 ? 'I' : currentNumber <= 45 ? 'N' : currentNumber <= 60 ? 'G' : 'O';
                                        return `${letter}-${currentNumber}`;
                                    })()}
                                </div>
                            ) : (
                                <div className="current-call-ball waiting">--</div>
                            )}
                        </div>

                        {/* Recently Called Numbers - Joy Bingo style: empty placeholder before calls, then circular buttons in row */}
                        <div className={`recent-numbers-joy ${calledNumbers.length === 0 ? 'recent-numbers-empty' : ''}`}>
                            {calledNumbers.length === 0 ? (
                                <span className="recent-numbers-placeholder">—</span>
                            ) : (
                                (() => {
                                    let recent = currentNumber
                                        ? calledNumbers.filter((n) => n !== currentNumber).slice(-3)
                                        : calledNumbers.slice(-3);
                                    if (recent.length === 0) recent = calledNumbers.slice(-3);
                                    return recent.map((n, index) => {
                                        const letter = n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O';
                                        return (
                                            <div key={`recent-${n}-${index}`} className={`recent-number-circle recent-number-${letter.toLowerCase()}`}>
                                                {`${letter}${n}`}
                                            </div>
                                        );
                                    });
                                })()
                            )}
                        </div>

                        {/* Single Cartela or Watch Mode - Render in Right Column */}
                        {yourCards.length === 1 ? (
                            <div className="user-cartelas-single">
                                {yourCards.map(({ cardNumber, card }) => {
                                    // Determine which numbers to show as marked
                                    const markedNumbers = isAutoMarkOn 
                                        ? calledNumbers 
                                        : (manuallyMarkedNumbers[cardNumber] ? Array.from(manuallyMarkedNumbers[cardNumber]) : []);
                                    
                                    return (
                                        <CartellaCard
                                            key={cardNumber}
                                            id={cardNumber}
                                            card={card}
                                            called={isAutoMarkOn ? calledNumbers : markedNumbers}
                                            isPreview={false}
                                            showHeader={true}
                                            isAutoMarkOn={isAutoMarkOn}
                                            onNumberToggle={!isAutoMarkOn ? (number) => handleNumberToggle(cardNumber, number) : undefined}
                                        />
                                    );
                                })}
                            </div>
                        ) : yourCards.length === 0 ? (
                            <div className="user-cartelas-single">
                                <div className="watch-mode-indicator">
                                    <svg className="w-6 h-6 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    </svg>
                                    <p className="waiting-message-text font-semibold">Watch Only</p>
                                    <p className="waiting-message-text text-sm mt-1 opacity-90">የዚህ ዙር ጨዋታ ተጀምሯል። አዲስ ዙር እስኪጀምር እዚሁ ይጠብቁ</p>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* Manual BINGO button for single cartela (below main content) */}
                {hasSingleCartela && gameState.phase === 'running' && (
                    <div className="mt-16 mb-4 flex justify-center">
                        <button
                            onClick={handleManualBingo}
                            className={`action-button bingo-button game-bingo-button ${isManualClaiming ? 'loading' : ''}`}
                            disabled={!connected || !currentGameId || claimedBingoRef.current || gameState.phase !== 'running'}
                            style={{ width: '50%' }}
                        >
                            <div className="button-content">
                                <span className="button-text">BINGO!</span>
                            </div>
                        </button>
                    </div>
                )}

                {/* Single-cartela mode: no multi-cartela layout below columns */}

                {/* <BottomNav current="game" onNavigate={onNavigate} /> */}

            </div>
        </div>
    );
}