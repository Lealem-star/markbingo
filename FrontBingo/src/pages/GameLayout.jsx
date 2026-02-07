import React, { useEffect, useState, useRef } from 'react';
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

        return false;
    };


    const { connected, gameState, claimBingo, connectToStake } = useWebSocket();

    // Use ONLY WebSocket data - no props fallbacks
    const currentPlayersCount = gameState.playersCount || 0;
    const currentPrizePool = gameState.prizePool || 0;
    const calledNumbers = gameState.calledNumbers || [];
    const currentNumber = gameState.currentNumber;
    const currentGameId = gameState.gameId;


    // Sound control
    const [isSoundOn, setIsSoundOn] = useState(true);
    
    // Auto-mark control (green or light purple)
    const [isAutoMarkOn, setIsAutoMarkOn] = useState(true);
    
    // Track manually marked numbers per cartela when auto-mark is OFF
    // Structure: { cardNumber: Set<number> }
    const [manuallyMarkedNumbers, setManuallyMarkedNumbers] = useState({});
    
    // Reset manually marked numbers when auto-mark is turned back ON
    useEffect(() => {
        if (isAutoMarkOn && Object.keys(manuallyMarkedNumbers).length > 0) {
            setManuallyMarkedNumbers({});
        }
    }, [isAutoMarkOn]);
    
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

    // Automatic winning pattern detection and auto-claim
    useEffect(() => {
        // Only check during running phase and if we have cards
        if (gameState.phase !== 'running' || !currentGameId || yourCards.length === 0) {
            return;
        }

        // Don't claim if we've already claimed for this game
        if (claimedBingoRef.current) {
            return;
        }

        // Determine which numbers to use for winning detection
        // If auto-mark is ON: use calledNumbers
        // If auto-mark is OFF: use manuallyMarkedNumbers (or calledNumbers if no manual marks)
        const getNumbersForDetection = (cardNumber) => {
            if (isAutoMarkOn) {
                return calledNumbers;
            } else {
                const manualMarks = manuallyMarkedNumbers[cardNumber];
                // If user has manually marked numbers, use those; otherwise use calledNumbers
                if (manualMarks && manualMarks.size > 0) {
                    return Array.from(manualMarks);
                } else {
                    return calledNumbers; // Fallback to calledNumbers if no manual marks
                }
            }
        };

        // Check each cartela for winning pattern
        let hasWinningPattern = false;
        for (const { card, cardNumber } of yourCards) {
            const numbersToCheck = getNumbersForDetection(cardNumber);
            if (checkBingoPattern(card, numbersToCheck)) {
                hasWinningPattern = true;
                break;
            }
        }

        // Auto-claim bingo if winning pattern detected
        if (hasWinningPattern && connected) {
            console.log('🎉 Automatic BINGO detected! Auto-claiming...', {
                isAutoMarkOn,
                hasManualMarks: Object.keys(manuallyMarkedNumbers).length > 0
            });
            claimedBingoRef.current = true;
            claimBingo().catch((error) => {
                console.error('Error auto-claiming bingo:', error);
                // Reset on error so we can retry
                claimedBingoRef.current = false;
            });
        }
    }, [calledNumbers, yourCards, gameState.phase, currentGameId, connected, claimBingo, isAutoMarkOn, manuallyMarkedNumbers]);

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
    const yourCards = Array.isArray(gameState.yourCards) ? gameState.yourCards : [];
    
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
    if (!currentGameId && connected && gameState.phase === 'waiting') {
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

    return (
        <div className="app-container relative overflow-hidden joy-bingo-bg">
            <div className="max-w-md mx-auto px-3 py-3 relative z-10">
                {/* Top Information Bar - Light Purple Style */}
                <div className="game-info-bar-light flex items-stretch rounded-lg flex-nowrap mobile-info-bar" style={{ marginBottom: '1rem' }}>
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
                <div className="main-content-area mobile-first-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.3rem',
                    padding: '0.25rem',
                    marginTop: '0.75rem',
                    marginBottom: '0.75rem',
                    marginRight: '0.15rem',
                    height: 'calc(100vh - 180px)',
                    maxHeight: '500px'
                }}>
                    {/* Left Card - BINGO Grid with Square Letters */}
                    <div className="bingo-grid-container" style={{ height: '100%', overflow: 'hidden' }}>
                        <div className="grid grid-cols-5 gap-1" style={{ height: '100%' }}>
                            {/* B Column - Yellow */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* I Column - Green */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* N Column - Purple */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* G Column - Red */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* O Column - Pink/Magenta */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                        </div>
                    </div>

                    {/* Right Side - Joy Bingo Style */}
                    <div className="right-side-container" style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        marginLeft: '0.25rem'
                    }}>
                        {/* Control Bar - Status, Auto-Mark, Sound Toggle in One Line */}
                        <div className="game-controls-bar">
                            {/* Reduced Size Status Box */}
                            <div className="game-status-box-small">
                                <span className="game-status-text-small">{gamePhaseDisplay}</span>
                            </div>
                            
                            {/* Auto-Mark Toggle (Green or Light Purple) */}
                            <button
                                onClick={() => setIsAutoMarkOn(!isAutoMarkOn)}
                                className={`auto-mark-toggle ${isAutoMarkOn ? 'auto-mark-on' : 'auto-mark-off'}`}
                                title={isAutoMarkOn ? 'Auto-mark ON (Green)' : 'Auto-mark OFF (Light Purple)'}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </button>
                            
                            {/* Sound Toggle (Microphone) */}
                            <button
                                onClick={() => setIsSoundOn(!isSoundOn)}
                                className={`sound-toggle ${isSoundOn ? 'sound-on' : 'sound-off'}`}
                                title={isSoundOn ? 'Sound ON' : 'Sound OFF'}
                            >
                                {isSoundOn ? (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.793L4.383 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.383l4-4.707a1 1 0 011.617.793zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                                    </svg>
                                )}
                            </button>
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

                        {/* Recently Called Numbers - Circular Buttons in Row */}
                        <div className="recent-numbers-joy">
                            {(() => {
                                // Get recently called numbers (excluding current)
                                const recent = calledNumbers.slice(-3);
                                return recent.map((n, index) => {
                                    const letter = n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O';
                                    return (
                                        <div key={`recent-${n}-${index}`} className={`recent-number-circle recent-number-${letter.toLowerCase()}`}>
                                            {`${letter}${n}`}
                                        </div>
                                    );
                                });
                            })()}
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
                                    <p className="waiting-message-text font-semibold">Watch Mode</p>
                                    <p className="waiting-message-text text-sm mt-1 opacity-90">You're watching this game. Join the next round to play!</p>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* User Cartelas - Below Both Columns (only for multiple cartelas) */}
                {yourCards.length > 1 && (
                    <div className="user-cartelas-container-full">
                        <div className="user-cartelas-list">
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
                                        isAutoMarkOn={isAutoMarkOn}
                                        onNumberToggle={!isAutoMarkOn ? (number) => handleNumberToggle(cardNumber, number) : undefined}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}

                <BottomNav current="game" onNavigate={onNavigate} />

            </div>
        </div>
    );
}