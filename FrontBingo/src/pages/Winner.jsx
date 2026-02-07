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


    // Get winner name/identifier
    const winnerName = main.name || main.playerName || main.firstName || (main.cartelaNumber ? `Cartella #${main.cartelaNumber}` : 'Winner');
    const winnerInitial = winnerName.charAt(0).toUpperCase();

    // Try to get card data
                            let cardData = null;
                            try {
                                if (main.card && Array.isArray(main.card) && main.card.length === 5) {
                                    cardData = main.card;
                                } else if (main.cardNumbers && Array.isArray(main.cardNumbers) && main.cardNumbers.length === 25) {
                                    cardData = [
                                        main.cardNumbers.slice(0, 5),
                                        main.cardNumbers.slice(5, 10),
                                        main.cardNumbers.slice(10, 15),
                                        main.cardNumbers.slice(15, 20),
                                        main.cardNumbers.slice(20, 25)
                                    ];
                                } else if (main.card && Array.isArray(main.card)) {
                                    cardData = main.card;
                                }
                            } catch (error) {
                                console.error('Error processing card data:', error);
                            }

    const calledNumbers = main.called || gameState.calledNumbers || [];
    const boardNumber = main.cartelaNumber || main.cardId || 'N/A';

                                    return (
        <div className="app-container flex items-center justify-center min-h-screen py-4 px-4" style={{ background: '#e9d5ff' }}>
            <div className="w-full max-w-md">
                {/* Main Card Container with Light Purple Background */}
                <div className="rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#e9d5ff' }}>
                    {/* Large Orange BINGO! Banner */}
                    <div className="w-full bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-8">
                        <div className="text-center">
                            <h1 className="text-white font-extrabold text-5xl md:text-6xl tracking-wider mb-4 drop-shadow-lg">
                                BINGO!
                            </h1>
                            <div className="flex items-center justify-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                                    {winnerInitial}
                                </div>
                                <p className="text-white text-lg md:text-xl font-semibold">
                                    {winnerName} {isMulti ? `and ${winners.length - 1} other${winners.length > 2 ? 's' : ''} have won` : 'has won the game'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Card Section with Light Purple Background */}
                    <div className="p-6" style={{ background: '#e9d5ff' }}>
                        {/* Cartella Card */}
                        <div className="flex justify-center mb-4">
                            {cardData ? (
                                        <CartellaCard
                                    id={boardNumber}
                                            card={cardData}
                                    called={calledNumbers}
                                            isPreview={false}
                                    showWinningPattern={true}
                                />
                            ) : (
                                <div className="text-center p-8 rounded-xl border-2 border-purple-200/50 shadow-md" style={{ background: '#e9d5ff' }}>
                                    <div className="text-3xl mb-2">🏆</div>
                                    <div className="text-purple-700 text-sm font-semibold mb-1">
                                        Cartella #{boardNumber}
                                    </div>
                                    <div className="text-gray-600 text-xs mt-2">
                                        Card preview not available
                                    </div>
                                        </div>
                                    )}
                                </div>

                        {/* Board Number */}
                        <div className="text-center mt-4">
                            <p className="text-purple-800 text-sm font-semibold">
                                Board number {boardNumber}
                            </p>
                        </div>
                    </div>

                    {/* Countdown Section - Orange Background with Large Number */}
                    <div className="w-full bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-8">
                        <div className="text-center">
                            <div className="text-white font-extrabold text-6xl md:text-7xl tracking-wider drop-shadow-lg">
                                {countdown > 0 ? countdown : '0'}
                            </div>
                    </div>
                    </div>
                </div>
            </div>
        </div>
    );


}
