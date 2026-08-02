import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import CartellaCard from '../components/CartellaCard';

function cardDataFromWinner(winner) {
    if (!winner) return null;
    try {
        if (winner.card && Array.isArray(winner.card) && winner.card.length === 5) {
            return winner.card;
        }
        if (winner.cardNumbers && Array.isArray(winner.cardNumbers) && winner.cardNumbers.length === 25) {
            return [
                winner.cardNumbers.slice(0, 5),
                winner.cardNumbers.slice(5, 10),
                winner.cardNumbers.slice(10, 15),
                winner.cardNumbers.slice(15, 20),
                winner.cardNumbers.slice(20, 25)
            ];
        }
    } catch (e) {
        console.error('Error processing card data:', e);
    }
    return null;
}

function calledNumbersForWinner(winner, gameCalledNumbers) {
    const winnerCalled = Array.isArray(winner?.called) ? winner.called : [];
    const gameCalled = Array.isArray(gameCalledNumbers) ? gameCalledNumbers : [];
    return winnerCalled.length > 0 ? winnerCalled : gameCalled;
}

/** One entry per distinct winning board (same user can appear twice with two cartelas). */
function dedupeWinningCartelas(winners) {
    const out = [];
    const seen = new Set();
    for (const w of winners) {
        const uid = String(w.userId ?? w.sessionId ?? '');
        const cid = String(w.cartelaNumber ?? w.cartela?.cartelaNumber ?? '');
        const key = `${uid}::${cid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(w);
    }
    return out;
}

function getWinnerDisplayName(winner) {
    return (
        winner.name ||
        winner.playerName ||
        winner.firstName ||
        (winner.cartelaNumber ? `Cartella #${winner.cartelaNumber}` : 'Winner')
    );
}

function uniqueWinnersByUser(winners) {
    const out = [];
    const seen = new Set();
    for (const w of winners) {
        const key =
            w.userId ||
            w.sessionId ||
            (w.user && w.user.id) ||
            getWinnerDisplayName(w);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(w);
    }
    return out;
}

function WinnerAnnouncement({ names }) {
    if (!names.length) return null;

    if (names.length === 1) {
        return (
            <p className="winner-announcement">
                <span className="winner-announcement-names">{names[0]}</span>
                <span className="winner-announcement-suffix"> has won!</span>
            </p>
        );
    }

    if (names.length === 2) {
        return (
            <p className="winner-announcement">
                <span className="winner-announcement-names">{names[0]} and {names[1]}</span>
                <span className="winner-announcement-suffix"> have won!</span>
            </p>
        );
    }

    return (
        <p className="winner-announcement">
            <span className="winner-announcement-names">{names[0]} and {names.length - 1} others</span>
            <span className="winner-announcement-suffix"> have won!</span>
        </p>
    );
}

function WinnerModalShell({ children, countdown, initialCountdown, overlay = false }) {
    const progress =
        initialCountdown > 0
            ? Math.min(100, Math.max(0, ((initialCountdown - countdown) / initialCountdown) * 100))
            : 100;

    return (
        <div className={`winner-page${overlay ? ' winner-page--overlay' : ''}`} role="dialog" aria-modal="true">
            <div className="winner-backdrop" aria-hidden="true" />
            <div className="winner-modal">
                {children}
                <div className="winner-next-round">
                    <div
                        className="winner-next-round-fill"
                        style={{ width: `${progress}%` }}
                    />
                    <span className="winner-next-round-text">
                        NEXT ROUND: {countdown > 0 ? `${countdown}S` : '0S'}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default function Winner({ onNavigate, overlay = false }) {
    const { gameState } = useWebSocket();
    const [countdown, setCountdown] = useState(0);
    const [carouselIndex, setCarouselIndex] = useState(0);
    const initialCountdownRef = useRef(0);

    useEffect(() => {
        const updateCountdown = () => {
            if (gameState.nextRegistrationStart) {
                const remaining = Math.max(0, Math.ceil((gameState.nextRegistrationStart - Date.now()) / 1000));
                if (initialCountdownRef.current === 0 && remaining > 0) {
                    initialCountdownRef.current = remaining;
                }
                setCountdown(remaining);
            } else {
                setCountdown(0);
            }
        };

        updateCountdown();
        const interval = setInterval(updateCountdown, 1000);
        return () => clearInterval(interval);
    }, [gameState.nextRegistrationStart]);

    useEffect(() => {
        if (gameState.phase === 'registration') {
            onNavigate?.('cartela-selection');
        }
    }, [gameState.phase, onNavigate]);

    const winners = gameState.winners || [];
    const displayWinners = dedupeWinningCartelas(winners);
    const uniqueWinners = uniqueWinnersByUser(winners);
    const winnerNames = uniqueWinners.map(getWinnerDisplayName);
    const gameCalled = Array.isArray(gameState.calledNumbers) ? gameState.calledNumbers : [];

    const totalPrizePool = gameState.prizePool || 0;
    const prizePerWinner =
        uniqueWinners.length > 0
            ? Math.floor(totalPrizePool / uniqueWinners.length)
            : 0;

    const goToSlide = useCallback(
        (index) => {
            if (displayWinners.length === 0) return;
            const next = ((index % displayWinners.length) + displayWinners.length) % displayWinners.length;
            setCarouselIndex(next);
        },
        [displayWinners.length]
    );

    useEffect(() => {
        if (carouselIndex >= displayWinners.length) {
            setCarouselIndex(0);
        }
    }, [carouselIndex, displayWinners.length]);

    if (winners.length === 0) {
        return (
            <WinnerModalShell countdown={countdown} initialCountdown={initialCountdownRef.current} overlay={overlay}>
                <header className="winner-modal-header">
                    <div className="winner-count">
                        <span className="winner-count-num">0</span>
                        <span className="winner-count-label">አሸናፊዎች</span>
                    </div>
                </header>
                <p className="winner-announcement">
                    <span className="winner-announcement-suffix">No winner this round.</span>
                </p>
                <div className="winner-pool-box">
                    <span className="winner-pool-label">TOTAL PRIZE POOL</span>
                    <span className="winner-pool-value">{totalPrizePool} ETB</span>
                </div>
                <div className="winner-watch-panel">
                    <p className="winner-watch-text">Please wait for the next buying round.</p>
                </div>
            </WinnerModalShell>
        );
    }

    const activeWinner = displayWinners[carouselIndex] || displayWinners[0];
    const activeCardData = cardDataFromWinner(activeWinner);
    const activeCalled = calledNumbersForWinner(activeWinner, gameCalled);
    const activeBoardNumber = activeWinner?.cartelaNumber || activeWinner?.cardId || 'N/A';
    const activeLabel = getWinnerDisplayName(activeWinner);
    const hasCarousel = displayWinners.length > 1;

    return (
        <WinnerModalShell countdown={countdown} initialCountdown={initialCountdownRef.current} overlay={overlay}>
            <header className="winner-modal-header">
                <div className="winner-count">
                    <span className="winner-count-num">{uniqueWinners.length}</span>
                    <span className="winner-count-label">አሸናፊዎች</span>
                </div>
                <div className="winner-prize-share">{prizePerWinner} ETB</div>
            </header>

            <WinnerAnnouncement names={winnerNames} />

            <div className="winner-pool-box">
                <span className="winner-pool-label">TOTAL PRIZE POOL</span>
                <span className="winner-pool-value">{totalPrizePool} ETB</span>
            </div>

            <div className="winner-card-carousel">
                <div className="winner-card-frame">
                    <div className="winner-card-frame-header">
                        <span className="winner-card-id">CARD #{activeBoardNumber}</span>
                        <span className="winner-card-name">{activeLabel}</span>
                    </div>

                    <div className="winner-card-body">
                        {activeCardData ? (
                            <CartellaCard
                                id={activeBoardNumber}
                                card={activeCardData}
                                called={activeCalled}
                                isPreview={false}
                                showWinningPattern={true}
                                fullCardWin={gameState.isSuperBingo}
                                showHeader={false}
                            />
                        ) : (
                            <div className="winner-card-fallback">
                                <div className="winner-card-fallback-icon">🏆</div>
                                <div className="winner-card-fallback-title">Cartella #{activeBoardNumber}</div>
                                <div className="winner-card-fallback-sub">Card preview not available</div>
                            </div>
                        )}

                        {hasCarousel && (
                            <>
                                <button
                                    type="button"
                                    className="winner-carousel-prev"
                                    onClick={() => goToSlide(carouselIndex - 1)}
                                    aria-label="Previous winning card"
                                >
                                    ‹
                                </button>
                                <button
                                    type="button"
                                    className="winner-carousel-next"
                                    onClick={() => goToSlide(carouselIndex + 1)}
                                    aria-label="Next winning card"
                                >
                                    ›
                                </button>
                            </>
                        )}
                    </div>

                    {hasCarousel && (
                        <div className="winner-carousel-dots">
                            {displayWinners.map((w, idx) => (
                                <button
                                    key={`${String(w.userId)}-${w.cartelaNumber}-${idx}`}
                                    type="button"
                                    className={`winner-carousel-dot ${idx === carouselIndex ? 'is-active' : ''}`}
                                    onClick={() => goToSlide(idx)}
                                    aria-label={`Show card ${idx + 1}`}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </WinnerModalShell>
    );
}
