import React from 'react';
import useCountUp from '../hooks/useCountUp';
import { useWebSocket } from '../contexts/WebSocketContext';

export default function StatsPanel() {
    const { gameState } = useWebSocket() || {};

    const rawPlayers = gameState?.playersCount ?? 0;
    const rawSelected = Array.isArray(gameState?.takenCards) ? gameState.takenCards.length : 0;
    const rawPrizePool = gameState?.prizePool ?? 0;

    const players = useCountUp(rawPlayers, 600);
    const selected = useCountUp(rawSelected, 600);
    const prizePool = useCountUp(rawPrizePool, 600);

    return (
        <section className="stats-panel mt-5">
            <div className="stat fade-in-up delay-1">
                <div className="stat-value">{players.toLocaleString()}</div>
                <div className="stat-label">Players in This Game</div>
            </div>
            <div className="stat fade-in-up delay-2">
                <div className="stat-value">{selected.toLocaleString()}</div>
                <div className="stat-label">Cartelas Selected</div>
            </div>
            <div className="stat fade-in-up delay-3">
                <div className="stat-value">ETB {prizePool.toLocaleString()}</div>
                <div className="stat-label">Current Prize Pool</div>
            </div>
        </section>
    );
}
