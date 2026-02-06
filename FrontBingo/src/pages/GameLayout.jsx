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


    // Determine game phase display
    const gamePhaseDisplay = gameState.phase === 'playing' ? 'STARTED' : gameState.phase === 'registration' ? 'REGISTRATION' : 'WAITING';

    return (
        <div className="app-container relative overflow-hidden joy-bingo-bg">
            <div className="max-w-md mx-auto px-3 py-3 relative z-10">
                {/* Top Information Bar - Light Purple Style */}
                <div className="game-info-bar-light flex items-stretch rounded-lg flex-nowrap mobile-info-bar" style={{ marginBottom: '1rem' }}>
                    <div className="info-box flex-1">
                        <div className="info-label">Derash</div>
                        <div className="info-value">{currentPrizePool}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Players</div>
                        <div className="info-value">{currentPlayersCount}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Bet</div>
                        <div className="info-value">{stake}</div>
                    </div>
                    <div className="info-box flex-1">
                        <div className="info-label">Call</div>
                        <div className="info-value">{calledNumbers.length}</div>
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
                        {/* STARTED Status Box */}
                        <div className="game-status-box">
                            <span className="game-status-text">{gamePhaseDisplay}</span>
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

                        {/* Recently Called Numbers - Green Ovals */}
                        <div className="recent-numbers-joy">
                            {(() => {
                                // Get recently called numbers (excluding current)
                                const recent = calledNumbers.slice(-3);
                                return recent.map((n, index) => {
                                    const letter = n <= 15 ? 'B' : n <= 30 ? 'I' : n <= 45 ? 'N' : n <= 60 ? 'G' : 'O';
                                    return (
                                        <div key={`recent-${n}-${index}`} className="recent-number-oval">
                                            {`${letter}${n}`}
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>
                </div>

                {/* User Cartelas - Below Both Columns */}
                <div className="user-cartelas-container-full">
                    {yourCards.length === 0 ? (
                        <div className="waiting-message-box">
                            <p className="waiting-message-text">Please wait for this game to be completed</p>
                        </div>
                    ) : (
                        <div className="user-cartelas-list">
                            {yourCards.map(({ cardNumber, card }) => (
                                <CartellaCard
                                    key={cardNumber}
                                    id={cardNumber}
                                    card={card}
                                    called={calledNumbers}
                                    isPreview={false}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <BottomNav current="game" onNavigate={onNavigate} />

            </div>
        </div>
    );
}