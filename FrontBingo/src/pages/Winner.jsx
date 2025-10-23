import React, { useEffect, useState } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import CartellaCard from '../components/CartellaCard';

export default function Winner({ onNavigate }) {
    const { gameState } = useWebSocket();
    const [countdown, setCountdown] = useState(10);

    // Countdown timer for display
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => {
                setCountdown(countdown - 1);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown]);

    // Navigate when backend starts new registration (instead of fixed timer)
    useEffect(() => {
        if (gameState.phase === 'registration') {
            console.log('Winner page - Backend started new registration, navigating to cartella selection');
            onNavigate?.('cartela-selection');
        }
    }, [gameState.phase, onNavigate]);

    // Fallback: Navigate after 15 seconds if backend doesn't send registration_open
    useEffect(() => {
        const fallbackTimer = setTimeout(() => {
            console.log('Winner page - Fallback navigation after 15 seconds');
            onNavigate?.('cartela-selection');
        }, 15000);

        return () => clearTimeout(fallbackTimer);
    }, [onNavigate]);

    const winners = gameState.winners || [];
    const isMulti = winners.length > 1;
    const main = winners[0] || {};

    return (
        <div className="app-container flex items-gicenter justify-center">
            <div className="w-full max-w-md rounded-2xl backdrop-blur-md border border-yellow-500/10 shadow-2xl p-6 m-8 text-white relative background-color: rgba(235, 217, 58, 0.05)">

                <div className="flex flex-col items-center gap-4 mb-6">
                    <div className="w-16 h-16 rounded-full background-color: rgba(226, 206, 26, 0.05) flex items-center justify-center shadow-lg">
                        <span className="text-slate-900 text-2xl">👑</span>
                    </div>
                    <div className="text-yellow-300 font-extrabold text-3xl tracking-wide">BINGO!</div>
                    {isMulti ? (
                        <>
                            <div className="text-lg text-white/90">🎉 {winners.length} players won!</div>
                            {typeof main.prize === 'number' && (
                                <div className="text-sm text-amber-300">Each wins: <span className="font-bold">{main.prize}</span></div>
                            )}
                        </>
                    ) : (
                        <div className="text-lg text-white/90">🎉 {main.name || main.playerName || main.firstName || `Cartella #${main.cartelaNumber || main.cardId || 'Winner'}`} WON! 🎉</div>
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


                <div className="rounded-xl border border-white/10 p-20 bg-[rgba(238, 211, 10, 0.05)]">
                    <div className="text-sm mb-4 flex items-center gap-2">
                        <span className='flex items-center justify-center'> {main.cartelaNumber || main.cardId || '-'}</span>
                    </div>

                    {typeof main.prize === 'number' && (
                        <div className="text-sm mb-4 flex items-center gap-2 text-amber-300">
                            <span>💰</span>
                            <span className='flex items-center justify-center'>Prize per winner:</span>
                            <span className="font-bold">{main.prize}</span>
                        </div>
                    )}

                    {/* Beautiful Cartella Card */}
                    <div className="flex justify-center mb-6">
                        {(() => {
                            // Try to get card data from various possible sources
                            let cardData = null;

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

                            if (cardData) {
                                return (
                                    <CartellaCard
                                        id={main.cartelaNumber || main.cardId || 'Winner'}
                                        card={cardData}
                                        called={main.called || []}
                                        isPreview={false}
                                    />
                                );
                            } else {
                                return (
                                    <div className="text-center p-8 bg-white/10 rounded-lg border border-white/20">
                                        <div className="text-yellow-300 text-lg mb-2">🏆</div>
                                        <div className="text-white/80 text-sm">
                                            Cartella #{main.cartelaNumber || main.cardId || 'Winner'}
                                        </div>
                                        <div className="text-white/60 text-xs mt-2">
                                            Card data not available
                                        </div>
                                        <div className="text-white/40 text-xs mt-1">
                                            Debug: cardNumbers={main.cardNumbers?.length}, card={main.card?.length}
                                        </div>
                                    </div>
                                );
                            }
                        })()}
                    </div>

                    <div className="w-full h-8 rounded-md bg-amber-700/70 text-amber-200 text-xs flex items-center justify-center">
                        አዲስ ጭዋታ ለመጀመር.....
                    </div>
                    <div className="w-full h-8 rounded-md bg-slate-800/80 text-slate-200 text-xs flex items-center justify-center mt-2">
                        Auto-starting next game in {countdown}s
                    </div>
                </div>


            </div>
        </div>
    );
}
