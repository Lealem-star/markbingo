import React, { useEffect, useState } from 'react';
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
    selectedCartela,
    onNavigate,
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

    // Navigate to winner page when phase enters announce (for both players and watch mode)
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

            // Navigate to winner page for all users (players and watch mode)
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
    const yourBingoCard = gameState.yourCard;
    const yourCardNumber = gameState.yourCardNumber || selectedCartela;

    // Determine if we're in watch mode (no selected cartella and no bingo card from WebSocket)
    const isWatchMode = !selectedCartela && !yourBingoCard;


    // Auto-transition back to CartelaSelection when registration starts
    useEffect(() => {
        if (isWatchMode && gameState.phase === 'registration' && !isRefreshing) {
            onNavigate?.('cartela-selection');
        }
    }, [isWatchMode, gameState.phase, onNavigate, isRefreshing]);

    // Reset local state when game phase changes to registration
    useEffect(() => {
        if (gameState.phase === 'registration') {
            // Clear any local state that might interfere with new game
            setShowTimeout(false);
            setIsRefreshing(false);
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


    return (
        <div className="app-container relative overflow-hidden">
            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-pink-500/20 to-purple-600/20 rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-tr from-blue-500/20 to-purple-600/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
            </div>

            <div className="max-w-md mx-auto px-3 py-3 relative z-10">
                {/* Enhanced Top Information Bar (mobile-first compact design) */}
                <div className="game-info-bar compact flex items-stretch rounded-2xl flex-nowrap mobile-info-bar" style={{ marginBottom: '1.5rem' }}>
                    <div className="wallet-box wallet-box--compact flex-1 group">
                        <div className="wallet-label">Game ID</div>
                        <div className="wallet-value font-bold text-yellow-300 truncate">{currentGameId || 'LB000000'}</div>
                    </div>
                    <div className="wallet-box wallet-box--compact flex-1 group">
                        <div className="wallet-label">Players</div>
                        <div className="wallet-value font-bold text-green-300">{currentPlayersCount}</div>
                    </div>
                    <div className="wallet-box wallet-box--compact flex-1 group">
                        <div className="wallet-label">Bet</div>
                        <div className="wallet-value font-bold text-blue-300">ETB {stake}</div>
                    </div>
                    <div className="wallet-box wallet-box--compact flex-1 group">
                        <div className="wallet-label">Prize</div>
                        <div className="wallet-value font-bold text-orange-300">ETB {currentPrizePool}</div>
                    </div>
                    <div className="wallet-box wallet-box--compact flex-1 group">
                        <div className="wallet-label">Called</div>
                        <div className="wallet-value font-bold text-pink-300">{calledNumbers.length}/75</div>
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
                    {/* Left Card - Enhanced BINGO Grid */}
                    <div className="rounded-2xl p-4 bg-gradient-to-br from-purple-900/70 to-slate-900/50 ring-1 ring-black/20 shadow-2xl shadow-purple-900/30 backdrop-blur-md" style={{ height: '100%', overflow: 'hidden' }}>
                        <div className="grid grid-cols-5 gap-1" style={{ height: '100%' }}>
                            {/* B Column */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <div className="cartela-letter ball-b relative w-6 h-6 rounded-full text-white font-bold text-center flex items-center justify-center shadow-xl mx-auto" style={{ flexShrink: 0 }}>
                                    <span className="relative z-10 text-sm drop-shadow-sm">B</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 1).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    return (
                                        <button
                                            key={n}
                                            className={`cartela-number-btn text-[8px] leading-none transition-all duration-200 ${isCurrentNumber
                                                ? '!bg-gradient-to-b !from-green-500 !to-green-600 !text-white animate-pulse ring-2 ring-yellow-400'
                                                : isCalled
                                                    ? '!bg-gradient-to-b !from-red-500 !to-red-600 !text-white'
                                                    : '!bg-gradient-to-b !from-slate-700/80 !to-slate-800/80 !text-slate-200'
                                                }`}
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* I Column */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <div className="cartela-letter ball-i relative w-6 h-6 rounded-full text-white font-bold text-center flex items-center justify-center shadow-xl mx-auto" style={{ flexShrink: 0 }}>
                                    <span className="relative z-10 text-sm drop-shadow-sm">I</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 16).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    return (
                                        <button
                                            key={n}
                                            className={`cartela-number-btn text-[8px] leading-none transition-all duration-200 ${isCurrentNumber
                                                ? '!bg-gradient-to-b !from-green-500 !to-green-600 !text-white animate-pulse ring-2 ring-yellow-400'
                                                : isCalled
                                                    ? '!bg-gradient-to-b !from-red-500 !to-red-600 !text-white'
                                                    : '!bg-gradient-to-b !from-slate-700/80 !to-slate-800/80 !text-slate-200'
                                                }`}
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* N Column */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <div className="cartela-letter ball-n relative w-6 h-6 rounded-full text-white font-bold text-center flex items-center justify-center shadow-xl mx-auto" style={{ flexShrink: 0 }}>
                                    <span className="relative z-10 text-sm drop-shadow-sm">N</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 31).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    return (
                                        <button
                                            key={n}
                                            className={`cartela-number-btn text-[8px] leading-none transition-all duration-200 ${isCurrentNumber
                                                ? '!bg-gradient-to-b !from-green-500 !to-green-600 !text-white animate-pulse ring-2 ring-yellow-400'
                                                : isCalled
                                                    ? '!bg-gradient-to-b !from-red-500 !to-red-600 !text-white'
                                                    : '!bg-gradient-to-b !from-slate-700/80 !to-slate-800/80 !text-slate-200'
                                                }`}
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* G Column */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <div className="cartela-letter ball-g relative w-6 h-6 rounded-full text-white font-bold text-center flex items-center justify-center shadow-xl mx-auto" style={{ flexShrink: 0 }}>
                                    <span className="relative z-10 text-sm drop-shadow-sm">G</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 46).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    return (
                                        <button
                                            key={n}
                                            className={`cartela-number-btn text-[8px] leading-none transition-all duration-200 ${isCurrentNumber
                                                ? '!bg-gradient-to-b !from-green-500 !to-green-600 !text-white animate-pulse ring-2 ring-yellow-400'
                                                : isCalled
                                                    ? '!bg-gradient-to-b !from-red-500 !to-red-600 !text-white'
                                                    : '!bg-gradient-to-b !from-slate-700/80 !to-slate-800/80 !text-slate-200'
                                                }`}
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* O Column */}
                            <div className="space-y-0" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <div className="cartela-letter ball-o relative w-6 h-6 rounded-full text-white font-bold text-center flex items-center justify-center shadow-xl mx-auto" style={{ flexShrink: 0 }}>
                                    <span className="relative z-10 text-sm drop-shadow-sm">O</span>
                                </div>
                                {Array.from({ length: 15 }, (_, i) => i + 61).map(n => {
                                    const isCalled = calledNumbers.includes(n);
                                    const isCurrentNumber = currentNumber === n;
                                    return (
                                        <button
                                            key={n}
                                            className={`cartela-number-btn text-[8px] leading-none transition-all duration-200 ${isCurrentNumber
                                                ? '!bg-gradient-to-b !from-green-500 !to-green-600 !text-white animate-pulse ring-2 ring-yellow-400'
                                                : isCalled
                                                    ? '!bg-gradient-to-b !from-red-500 !to-red-600 !text-white'
                                                    : '!bg-gradient-to-b !from-slate-700/80 !to-slate-800/80 !text-slate-200'
                                                }`}
                                            style={{ flex: '1', minHeight: '20px', maxHeight: '24px' }}
                                        >
                                            {n}
                                        </button>
                                    );
                                })}
                            </div>

                        </div>
                    </div>

                    {/* Right Side - Enhanced Two Cards Stacked */}
                    <div className="right-side-container" style={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        marginLeft: '0.25rem'
                    }}>
                        {/* Floating Bingo Balls - Recent Numbers */}
                        <div className="recent-numbers-container">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 flex-1 justify-start min-w-0 overflow-hidden flex-nowrap" style={{ maxWidth: 'calc(100% - 3rem)' }}>
                                    {(() => {
                                        // Get all called numbers including current number
                                        const allNumbers = [...calledNumbers];
                                        if (
                                            currentNumber && typeof currentNumber === 'number' &&
                                            (calledNumbers.length === 0 || calledNumbers[calledNumbers.length - 1] !== currentNumber)
                                        ) {
                                            allNumbers.push(currentNumber);
                                        }

                                        // Get the last 4 numbers (most recent) - limit to exactly 4
                                        const toShow = allNumbers.slice(-4);
                                        const toBadge = (n, index) => {
                                            const letter = n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O';
                                            const ballClass = n <= 15
                                                ? 'ball-b'
                                                : n <= 30
                                                    ? 'ball-i'
                                                    : n <= 45
                                                        ? 'ball-n'
                                                        : n <= 60
                                                            ? 'ball-g'
                                                            : 'ball-o';
                                            return (
                                                <div
                                                    key={`recent-${n}-${index}`}
                                                    className={`recent-ball ${ballClass}`}
                                                    style={{
                                                        flexShrink: 0,
                                                        minWidth: '2rem',
                                                        maxWidth: '2rem'
                                                    }}
                                                >
                                                    <span>{`${letter}-${n}`}</span>
                                                </div>
                                            );
                                        };
                                        return toShow.map(toBadge);
                                    })()}
                                </div>
                                <button
                                    onClick={() => setIsSoundOn(v => !v)}
                                    className={`sound-button ${isSoundOn ? '' : 'muted'}`}
                                    aria-label={isSoundOn ? 'Mute' : 'Unmute'}
                                    title={isSoundOn ? 'Mute' : 'Unmute'}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                                        {isSoundOn ? (
                                            <path d="M11 5l-4 4H4v6h3l4 4V5zm6.54 1.46a8 8 0 010 11.31M15.36 8.64a4.5 4.5 0 010 6.36" strokeLinecap="round" strokeLinejoin="round" />
                                        ) : (
                                            <>
                                                <path d="M11 5l-4 4H4v6h3l4 4V5" strokeLinecap="round" strokeLinejoin="round" />
                                                <path d="M18 9l-6 6M12 9l6 6" strokeLinecap="round" strokeLinejoin="round" />
                                            </>
                                        )}
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Floating Current Number Ball */}
                        <div className="current-number-container">
                            <div className="text-center">
                                <div className="mx-auto w-full flex items-center justify-center">
                                    {currentNumber ? (
                                        <div className="relative">
                                            <div className="current-ball">
                                                <div className="current-ball-text">
                                                    {(() => {
                                                        const letter = currentNumber <= 15 ? 'B' : currentNumber <= 30 ? 'I' : currentNumber <= 45 ? 'N' : currentNumber <= 60 ? 'G' : 'O';
                                                        return `${letter}-${currentNumber}`;
                                                    })()}
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="relative">
                                            <div className="current-ball waiting">
                                                <div className="current-ball-text"></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Right Bottom Card - Enhanced User's Cartella */}
                        <div className="relative rounded-2xl p-3 bg-gradient-to-br from-purple-900/70 to-slate-900/50 ring-1 ring-black/20 shadow-2xl shadow-black/30 overflow-hidden">
                            <div className="shimmer-overlay"></div>
                            {isWatchMode ? (
                                /* Watching Only Mode - Matching the image design */
                                <div className="rounded-xl p-4 text-center bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-black/10">
                                    <div className="text-white font-bold text-lg mb-3 flex items-center justify-center gap-2">
                                        <span>👀</span>
                                        <span>Watching Only</span>
                                    </div>
                                    <div className="text-white/80 text-sm mb-4 space-y-2">
                                        <div className="text-white/90 text-sm leading-relaxed">
                                            {gameState.phase === 'running' ? (
                                                <>
                                                    <div className="mb-2">ጭዋታው ተጀምሯል።</div>
                                                    <div className="mb-2">ቀጣይ ጭዋታ እስኪጀምር እዚህ ይቆዩ።</div>
                                                    <div className="mb-2">መልካም ተዝናኖት መልካም ዕድል።</div>
                                                </>
                                            ) : gameState.phase === 'announce' ? (
                                                <>
                                                    <div className="mb-2">ጨዋታው ተጠናቋል።</div>
                                                    <div className="mb-2">የአሸናፊ ማስታወቂያ ወደሚታይበት ያመራሉ።</div>
                                                    <div className="mb-2">በቅርቡ ወደ ቀጣይ ጭዋታ ይቀላቀላሉ።</div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="mb-2">የጨዋታ ምዝገባ ተከፍቷል።</div>
                                                    <div className="mb-2">አዲስ የጨዋታ ማጠናቀቅ እዚህ ይጀምራል።</div>
                                                    <div className="mb-2">ተጠብቅ።</div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                /* Enhanced Normal Cartella Mode */
                                <>
                                    {/* Enhanced User's Cartella - 5x5 Grid */}
                                    <div className="rounded-xl p-3 mt-8 bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-black/10">


                                        {/* Implemented cartella grid using CartellaCard */}
                                        <CartellaCard
                                            id={yourCardNumber || selectedCartela}
                                            card={yourBingoCard}
                                            called={calledNumbers}
                                            isPreview={false}
                                        />
                                    </div>


                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Enhanced Bottom Action Buttons */}
                <div className="action-buttons-container" style={{ marginTop: '1rem' }}>
                    {/* Leave Button */}
                    <button
                        onClick={() => {
                            onNavigate?.('cartela-selection');
                        }}
                        className="action-button leave-button"
                    >
                        <div className="button-content">
                            <span className="button-icon">🚪</span>
                            <span className="button-text">Leave Game</span>
                        </div>
                    </button>

                    {/* Refresh Button */}
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="action-button refresh-button"
                    >
                        <div className="button-content">
                            <span className="button-icon refresh-icon">
                                {isRefreshing ? '⟳' : '🔄'}
                            </span>
                            <span className="button-text">
                                {isRefreshing ? 'Refreshing...' : 'Refresh'}
                            </span>
                        </div>
                    </button>

                    {/* BINGO Button */}
                    <button
                        onClick={() => {
                            if (isWatchMode) {
                                showError('❌ You need to select a cartella to play!');
                                return;
                            }

                            // Check if player has a valid bingo before claiming
                            const yourCard = gameState.yourCard;
                            const calledNumbers = gameState.calledNumbers || [];

                            if (!yourCard) {
                                showError('❌ No cartella selected! Please select a cartella first.');
                                return;
                            }

                            // Check if player actually has bingo
                            const hasBingo = checkBingoPattern(yourCard, calledNumbers);

                            if (hasBingo) {
                                showSuccess('🎉 BINGO! Claiming your win...');
                                claimBingo();
                            } else {

                                // Count how many numbers are marked in each row/column for helpful feedback
                                const markedCounts = {
                                    rows: yourCard.map(row => row.filter(num => num === 0 || calledNumbers.includes(num)).length),
                                    cols: Array.from({ length: 5 }, (_, j) =>
                                        yourCard.filter(row => row[j] === 0 || calledNumbers.includes(row[j])).length
                                    )
                                };

                                const maxRow = Math.max(...markedCounts.rows);
                                const maxCol = Math.max(...markedCounts.cols);
                                const maxMarked = Math.max(maxRow, maxCol);

                                if (maxMarked >= 4) {
                                    showWarning(`❌ Almost there! You have ${maxMarked}/5 in a line. Keep playing!`);
                                } else if (maxMarked >= 3) {
                                    showWarning(`❌ Getting close! You have ${maxMarked}/5 in a line.`);
                                } else {
                                    showWarning('❌ No bingo yet! Keep playing to complete a line.');
                                }
                            }
                        }}
                        disabled={isWatchMode}
                        className={`action-button bingo-button ${isWatchMode ? 'disabled' : ''}`}
                    >
                        <div className="button-content">
                            <span className="button-icon bingo-icon">🎉</span>
                            <span className="button-text">BINGO!</span>
                        </div>
                        {!isWatchMode && (
                            <div className="bingo-overlay"></div>
                        )}
                    </button>
                </div>

                <BottomNav current="game" onNavigate={onNavigate} />

            </div>
        </div>
    );
}