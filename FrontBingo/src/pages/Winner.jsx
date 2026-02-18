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
            <div className="app-container flex items-center justify-center min-h-screen py-4 px-4" style={{ background: '#e9d5ff' }}>
                <div className="w-full max-w-md">
                    {/* Main Card Container with Light Purple Background */}
                    <div className="rounded-2xl overflow-hidden shadow-2xl" style={{ background: '#e9d5ff' }}>
                        {/* Large Orange BINGO! Banner */}
                        <div className="w-full bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-8" style={{ background: 'linear-gradient(to right, #f97316, #ea580c)' }}>
                            <div className="text-center">
                                <h1 className="text-white font-extrabold text-5xl md:text-6xl tracking-wider mb-4 drop-shadow-lg">
                                    BINGO!
                                </h1>
                                <div className="flex items-center justify-center gap-3">
                                    <div className="px-4 py-2 rounded-lg bg-gray-500 border-2 border-gray-600 flex items-center justify-center text-white font-bold text-lg shadow-lg" style={{ backgroundColor: '#6b7280', borderColor: '#4b5563', padding: '0.5rem 1rem' }}>
                                        🎯
                                    </div>
                                    <p className="text-white text-lg md:text-xl font-semibold">
                                        No Winner This Game
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Content Section with Light Purple Background */}
                        <div className="p-6" style={{ background: '#e9d5ff' }}>
                            {/* Icon and Message */}
                            <div className="flex flex-col items-center gap-4 mb-6">
                                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center shadow-xl" style={{ boxShadow: '0 10px 30px rgba(107, 114, 128, 0.4)' }}>
                                    <span className="text-white text-5xl">🎯</span>
                                </div>
                                <div className="text-center">
                                    <div className="text-gray-800 text-xl font-bold mb-2">
                                        Game Completed
                                    </div>
                                    <div className="text-gray-700 text-base font-medium">
                                        The game ended without a winner.<br />
                                        Better luck next time!
                                    </div>
                                </div>
                            </div>

                            {/* Info Card */}
                            <div className="rounded-xl border-2 border-gray-300/50 p-4 bg-white/60 backdrop-blur-sm shadow-md mb-4">
                                <div className="text-center">
                                    <div className="text-gray-700 text-sm font-semibold mb-1">
                                        No BINGO Achieved
                                    </div>
                                    <div className="text-gray-600 text-xs">
                                        No player achieved a winning pattern in this round.
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Countdown Section - Orange Background with Large Number */}
                        <div className="w-full bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-8" style={{ background: 'linear-gradient(to right, #f97316, #ea580c)' }}>
                            <div className="text-center">
                                <div className="text-white text-sm font-semibold mb-2">
                                    አዲስ ጭዋታ ለመጀመር
                                </div>
                                <div className="text-white font-extrabold text-6xl md:text-7xl tracking-wider drop-shadow-lg">
                                    {countdown > 0 ? countdown : '0'}
                                </div>
                                <div className="text-white text-xs font-medium mt-2 opacity-90">
                                    {countdown > 0 ? (
                                        <>Auto-starting next game in {countdown} second{countdown !== 1 ? 's' : ''}</>
                                    ) : (
                                        <>Navigating to next game...</>
                                    )}
                                </div>
                            </div>
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
                    <div className="w-full bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-8" style={{ background: 'linear-gradient(to right, #f97316, #ea580c)' }}>
                        <div className="text-center">
                            <h1 className="text-white font-extrabold text-5xl md:text-6xl tracking-wider mb-4 drop-shadow-lg">
                                BINGO!
                            </h1>
                            <div className="flex items-center justify-center gap-3">
                                <div className="px-4 py-2 rounded-lg bg-green-500 border-2 border-green-600 flex items-center justify-center text-white font-bold text-lg shadow-lg" style={{ backgroundColor: '#22c55e', borderColor: '#16a34a', padding: '0.5rem 1rem' }}>
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
                    <div className="w-full bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-8" style={{ background: 'linear-gradient(to right, #f97316, #ea580c)' }}>
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
