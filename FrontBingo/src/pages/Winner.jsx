import React, { useEffect, useState } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAuth } from '../lib/auth/AuthProvider';
import CartellaCard from '../components/CartellaCard';

export default function Winner({ onNavigate, onResetToGame }) {
    const { gameState } = useWebSocket();
    const { sessionId } = useAuth();
    const FALLBACK_TIMEOUT = 5; // seconds
    const [countdown, setCountdown] = useState(FALLBACK_TIMEOUT);

    // Server-synchronized countdown timer - updates based on server's nextRegistrationStart timestamp
    useEffect(() => {
        const updateCountdown = () => {
            if (gameState.nextRegistrationStart) {
                // Calculate remaining time until next registration starts (based on server timestamp)
                const remaining = Math.max(0, Math.ceil((gameState.nextRegistrationStart - Date.now()) / 1000));
                setCountdown(remaining);
            } else if (gameState.registrationEndTime) {
                // Fallback: Use registrationEndTime if nextRegistrationStart not available
                const remaining = Math.max(0, Math.ceil((gameState.registrationEndTime - Date.now()) / 1000));
                setCountdown(remaining);
            } else {
                // Final fallback: Use local countdown if server time not available
                setCountdown(FALLBACK_TIMEOUT);
            }
        };

        // Update immediately
        updateCountdown();

        // Update every second to keep countdown synchronized across all clients
        const interval = setInterval(updateCountdown, 1000);

        return () => clearInterval(interval);
    }, [gameState.nextRegistrationStart, gameState.registrationEndTime]);

    // Navigate immediately when backend starts new registration
    useEffect(() => {
        if (gameState.phase === 'registration') {
            console.log('Winner page - Backend started new registration, navigating to cartella selection immediately');
            onNavigate?.('cartela-selection');
        }
    }, [gameState.phase, onNavigate]);

    // Fallback: Navigate after timeout if backend doesn't send registration_open
    useEffect(() => {
        const fallbackTimer = setTimeout(() => {
            console.log(`Winner page - Fallback navigation after ${FALLBACK_TIMEOUT} seconds`);
            onNavigate?.('cartela-selection');
        }, FALLBACK_TIMEOUT * 1000);

        return () => clearTimeout(fallbackTimer);
    }, [onNavigate]);

    const winners = gameState.winners || [];
    const isMulti = winners.length > 1;
    const main = winners[0] || {};

    // Check if current user is a winner
    const isCurrentUserWinner = sessionId && winners.some(w =>
        w.userId === sessionId ||
        w.sessionId === sessionId ||
        (w.user && w.user.id && w.user.id.toString() === sessionId?.toString())
    );

    // Handle case when no winners (shouldn't happen, but handle gracefully)
    const hasWinners = winners.length > 0;

    // Show "no winner" state if no winners data
    if (!hasWinners) {
        return (
            <div className="app-container flex items-center justify-center min-h-screen py-8 px-4">
                <div className="w-full max-w-md rounded-3xl backdrop-blur-xl border-2 border-purple-300/40 shadow-2xl p-8 text-gray-800 relative bg-gradient-to-br from-white/90 via-purple-50/80 to-pink-50/70" style={{ boxShadow: '0 20px 60px rgba(139, 92, 246, 0.3), 0 0 0 1px rgba(196, 181, 253, 0.2)' }}>

                    {/* Back Button */}
                    <div className="flex items-center justify-end mb-4">
                        <button
                            onClick={() => onNavigate?.('cartela-selection')}
                            className="header-button"
                        >
                            ← Back
                        </button>
                    </div>

                    <div className="flex flex-col items-center gap-4 mb-6">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center shadow-xl" style={{ boxShadow: '0 10px 30px rgba(168, 85, 247, 0.4)' }}>
                            <span className="text-white text-3xl">🎯</span>
                        </div>
                        <div className="bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent font-extrabold text-4xl tracking-wide">BINGO!</div>
                        <div className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300/60 text-purple-700 font-bold text-lg shadow-lg">
                            No Winner This Game
                        </div>
                        <div className="text-lg text-gray-700 text-center font-medium">
                            The game ended without a winner.<br />
                            Better luck next time!
                        </div>
                    </div>

                    <div className="rounded-2xl border-2 border-purple-200/50 p-5 sm:p-6 bg-gradient-to-br from-white/60 to-purple-50/40 backdrop-blur-sm shadow-lg">
                        <div className="text-center mb-4">
                            <div className="text-purple-700 text-sm mb-2 font-semibold">
                                Game Completed
                            </div>
                            <div className="text-gray-600 text-xs">
                                No player achieved a BINGO in this round.
                            </div>
                        </div>

                        <div className="w-full h-10 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-semibold flex items-center justify-center shadow-md">
                            አዲስ ጭዋታ ለመጀመር.....
                        </div>
                        <div className="w-full h-10 rounded-lg bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300/50 text-purple-700 text-xs font-semibold flex items-center justify-center mt-3 shadow-sm">
                            {countdown > 0 ? (
                                <>Auto-starting next game in {countdown}s</>
                            ) : (
                                <>Navigating to next game...</>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }


    return (
        <div className="app-container flex items-center justify-center min-h-screen py-8 px-4">
            <div className="w-full max-w-md rounded-3xl backdrop-blur-xl border-2 border-purple-300/40 shadow-2xl p-8 text-gray-800 relative bg-gradient-to-br from-white/90 via-purple-50/80 to-pink-50/70" style={{ boxShadow: '0 20px 60px rgba(139, 92, 246, 0.3), 0 0 0 1px rgba(196, 181, 253, 0.2)' }}>

                {/* Back Button */}
                <div className="flex items-center justify-end mb-4">
                    <button
                        onClick={() => onNavigate?.('cartela-selection')}
                        className="header-button"
                    >
                        ← Back
                    </button>
                </div>

                <div className="flex flex-col items-center gap-4 mb-6">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-purple-600 flex items-center justify-center shadow-xl animate-pulse" style={{ boxShadow: '0 10px 40px rgba(168, 85, 247, 0.5)' }}>
                        <span className="text-white text-3xl">👑</span>
                    </div>
                    <div className="bg-gradient-to-r from-purple-600 via-pink-600 to-purple-700 bg-clip-text text-transparent font-extrabold text-4xl tracking-wide">BINGO!</div>
                    {isCurrentUserWinner && (
                        <div className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 border-2 border-purple-400/60 text-white font-bold text-lg animate-pulse shadow-lg" style={{ boxShadow: '0 8px 25px rgba(168, 85, 247, 0.4)' }}>
                            🎉 CONGRATULATIONS! YOU WON! 🎉
                        </div>
                    )}
                    {isMulti ? (
                        <>
                            <div className="text-lg text-gray-700 font-semibold text-center">
                                🎉 {winners.length} player{winners.length > 1 ? 's' : ''} won!
                                {isCurrentUserWinner && <span className="block text-purple-600 text-sm mt-1 font-bold">(Including you!)</span>}
                            </div>
                            {typeof main.prize === 'number' && (
                                <div className="text-sm bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent font-bold">
                                    Each wins: <span className="text-purple-700">{main.prize.toLocaleString()} ETB</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-lg text-gray-700 font-semibold text-center">
                            🎉 {main.name || main.playerName || main.firstName || `Cartella #${main.cartelaNumber || main.cardId || 'Winner'}`} WON! 🎉
                            {isCurrentUserWinner && <span className="block text-purple-600 text-sm mt-1 font-bold">That's you! 🎊</span>}
                        </div>
                    )}
                </div>


                {isMulti && (
                    <div className="flex flex-wrap gap-2 justify-center mb-6">
                        {winners.map((w, i) => (
                            <div key={i} className="px-4 py-2 rounded-full bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300/50 text-sm shadow-md">
                                <span className="font-semibold mr-2 text-purple-700">
                                    {w.name || w.playerName || w.firstName || `Cartella #${w.cartelaNumber || w.cardId || (i + 1)}`}
                                </span>
                                <span className="text-purple-600 opacity-80">#{w.cartelaNumber || w.cardId}</span>
                            </div>
                        ))}
                    </div>
                )}


                <div className="rounded-2xl border-2 border-purple-200/50 p-5 sm:p-6 bg-gradient-to-br from-white/60 to-purple-50/40 backdrop-blur-sm shadow-lg">
                    <div className="text-sm mb-4 flex items-center justify-center gap-2">
                        <span className="text-purple-700 font-semibold">Winning Cartella:</span>
                        <span className="font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">#{main.cartelaNumber || main.cardId || '-'}</span>
                    </div>

                    {typeof main.prize === 'number' && (
                        <div className="text-sm mb-4 flex items-center justify-center gap-2">
                            <span className="text-2xl">💰</span>
                            <span className="text-gray-700 font-medium">Prize per winner:</span>
                            <span className="font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">{main.prize.toLocaleString()} ETB</span>
                        </div>
                    )}

                    {/* Beautiful Cartella Card */}
                    <div className="flex justify-center mb-6">
                        {(() => {
                            // Try to get card data from various possible sources
                            let cardData = null;

                            try {
                                if (main.card && Array.isArray(main.card) && main.card.length === 5) {
                                    // Card is already in 5x5 format
                                    cardData = main.card;
                                } else if (main.cardNumbers && Array.isArray(main.cardNumbers) && main.cardNumbers.length === 25) {
                                    // Convert flat array to 5x5 grid
                                    cardData = [
                                        main.cardNumbers.slice(0, 5),
                                        main.cardNumbers.slice(5, 10),
                                        main.cardNumbers.slice(10, 15),
                                        main.cardNumbers.slice(15, 20),
                                        main.cardNumbers.slice(20, 25)
                                    ];
                                } else if (main.card && Array.isArray(main.card)) {
                                    // Card might be in different format, try to use as-is
                                    cardData = main.card;
                                }
                            } catch (error) {
                                console.error('Error processing card data:', error);
                                cardData = null;
                            }

                            if (cardData) {
                                try {
                                    return (
                                        <CartellaCard
                                            id={main.cartelaNumber || main.cardId || 'Winner'}
                                            card={cardData}
                                            called={main.called || gameState.calledNumbers || []}
                                            isPreview={false}
                                        />
                                    );
                                } catch (error) {
                                    console.error('Error rendering CartellaCard:', error);
                                    // Fall through to fallback UI
                                }
                            }

                            // Fallback UI when card data is missing or invalid
                            return (
                                <div className="text-center p-8 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border-2 border-purple-200/50 shadow-md">
                                    <div className="text-3xl mb-2">🏆</div>
                                    <div className="text-purple-700 text-sm font-semibold mb-1">
                                        Cartella #{main.cartelaNumber || main.cardId || 'Winner'}
                                    </div>
                                    <div className="text-gray-600 text-xs mt-2">
                                        Card preview not available
                                    </div>
                                    {main.called && Array.isArray(main.called) && main.called.length > 0 && (
                                        <div className="text-purple-600 text-xs mt-2 font-medium">
                                            Called numbers: {main.called.length}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>

                    <div className="w-full h-10 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-semibold flex items-center justify-center shadow-md">
                        አዲስ ጭዋታ ለመጀመር.....
                    </div>
                    <div className="w-full h-10 rounded-lg bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-300/50 text-purple-700 text-xs font-semibold flex items-center justify-center mt-3 shadow-sm">
                        {countdown > 0 ? (
                            <>Auto-starting next game in {countdown}s</>
                        ) : (
                            <>Navigating to next game...</>
                        )}
                    </div>
                </div>


            </div>


        </div>
    );


}
