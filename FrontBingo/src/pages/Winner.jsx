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
                <div className="w-full max-w-md rounded-2xl backdrop-blur-md border border-yellow-500/20 shadow-2xl p-6 text-white relative bg-gradient-to-br from-yellow-500/10 via-amber-500/5 to-yellow-600/10">

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
                        <div className="w-16 h-16 rounded-full background-color: rgba(226, 206, 26, 0.05) flex items-center justify-center shadow-lg">
                            <span className="text-slate-900 text-2xl">🎯</span>
                        </div>
                        <div className="text-yellow-300 font-extrabold text-3xl tracking-wide">BINGO!</div>
                        <div className="px-4 py-2 rounded-full bg-yellow-400/20 border border-yellow-400/50 text-yellow-300 font-bold text-lg">
                            No Winner This Game
                        </div>
                        <div className="text-lg text-white/90 text-center">
                            The game ended without a winner.<br />
                            Better luck next time!
                        </div>
                    </div>

                    <div className="rounded-xl border border-white/10 p-4 sm:p-6 bg-[rgba(238, 211, 10, 0.05)]">
                        <div className="text-center mb-4">
                            <div className="text-white/80 text-sm mb-2">
                                Game Completed
                            </div>
                            <div className="text-white/60 text-xs">
                                No player achieved a BINGO in this round.
                            </div>
                        </div>

                        <div className="w-full h-8 rounded-md bg-amber-700/70 text-amber-200 text-xs flex items-center justify-center">
                            አዲስ ጭዋታ ለመጀመር.....
                        </div>
                        <div className="w-full h-8 rounded-md bg-slate-800/80 text-slate-200 text-xs flex items-center justify-center mt-2">
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
            <div className="w-full max-w-md rounded-2xl backdrop-blur-md border border-yellow-500/20 shadow-2xl p-6 text-white relative bg-gradient-to-br from-yellow-500/10 via-amber-500/5 to-yellow-600/10">

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
                    <div className="w-16 h-16 rounded-full background-color: rgba(226, 206, 26, 0.05) flex items-center justify-center shadow-lg">
                        <span className="text-slate-900 text-2xl">👑</span>
                    </div>
                    <div className="text-yellow-300 font-extrabold text-3xl tracking-wide">BINGO!</div>
                    {isCurrentUserWinner && (
                        <div className="px-4 py-2 rounded-full bg-yellow-400/20 border border-yellow-400/50 text-yellow-300 font-bold text-lg animate-pulse">
                            🎉 CONGRATULATIONS! YOU WON! 🎉
                        </div>
                    )}
                    {isMulti ? (
                        <>
                            <div className="text-lg text-white/90">
                                🎉 {winners.length} player{winners.length > 1 ? 's' : ''} won!
                                {isCurrentUserWinner && <span className="block text-yellow-300 text-sm mt-1">(Including you!)</span>}
                            </div>
                            {typeof main.prize === 'number' && (
                                <div className="text-sm text-amber-300">
                                    Each wins: <span className="font-bold">{main.prize.toLocaleString()} ETB</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-lg text-white/90">
                            🎉 {main.name || main.playerName || main.firstName || `Cartella #${main.cartelaNumber || main.cardId || 'Winner'}`} WON! 🎉
                            {isCurrentUserWinner && <span className="block text-yellow-300 text-sm mt-1">That's you! 🎊</span>}
                        </div>
                    )}
                </div>


                {isMulti && (
                    <div className="flex flex-wrap gap-2 justify-center mb-6">
                        {winners.map((w, i) => (
                            <div key={i} className="px-3 py-2 rounded-full bg-white/10 border border-white/15 text-sm">
                                <span className="font-semibold mr-2">
                                    {w.name || w.playerName || w.firstName || `Cartella #${w.cartelaNumber || w.cardId || (i + 1)}`}
                                </span>
                                <span className="opacity-80">#{w.cartelaNumber || w.cardId}</span>
                            </div>
                        ))}
                    </div>
                )}


                <div className="rounded-xl border border-white/10 p-4 sm:p-6 bg-[rgba(238, 211, 10, 0.05)]">
                    <div className="text-sm mb-4 flex items-center justify-center gap-2">
                        <span className="text-white/80">Winning Cartella:</span>
                        <span className="font-bold text-yellow-300">#{main.cartelaNumber || main.cardId || '-'}</span>
                    </div>

                    {typeof main.prize === 'number' && (
                        <div className="text-sm mb-4 flex items-center justify-center gap-2 text-amber-300">
                            <span>💰</span>
                            <span>Prize per winner:</span>
                            <span className="font-bold">{main.prize.toLocaleString()} ETB</span>
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
                                <div className="text-center p-8 bg-white/10 rounded-lg border border-white/20">
                                    <div className="text-yellow-300 text-lg mb-2">🏆</div>
                                    <div className="text-white/80 text-sm font-semibold mb-1">
                                        Cartella #{main.cartelaNumber || main.cardId || 'Winner'}
                                    </div>
                                    <div className="text-white/60 text-xs mt-2">
                                        Card preview not available
                                    </div>
                                    {main.called && Array.isArray(main.called) && main.called.length > 0 && (
                                        <div className="text-white/50 text-xs mt-2">
                                            Called numbers: {main.called.length}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>

                    <div className="w-full h-8 rounded-md bg-amber-700/70 text-amber-200 text-xs flex items-center justify-center">
                        አዲስ ጭዋታ ለመጀመር.....
                    </div>
                    <div className="w-full h-8 rounded-md bg-slate-800/80 text-slate-200 text-xs flex items-center justify-center mt-2">
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
