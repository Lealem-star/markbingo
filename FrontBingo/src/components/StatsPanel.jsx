import React from 'react';
import useCountUp from '../hooks/useCountUp';

export default function StatsPanel() {
    const players = useCountUp(1000, 1200);
    const games = useCountUp(2000, 1400);
    const winners = useCountUp(100, 1200);

    return (
        <section className="stats-panel mt-5">
            <div className="stat fade-in-up delay-1">
                <div className="stat-value">{players.toLocaleString()}+</div>
                <div className="stat-label">Active Players</div>
            </div>
            <div className="stat fade-in-up delay-2">
                <div className="stat-value">{games.toLocaleString()}+</div>
                <div className="stat-label">Games Played</div>
            </div>
            <div className="stat fade-in-up delay-3">
                <div className="stat-value">{winners.toLocaleString()}+</div>
                <div className="stat-label">Winners Daily</div>
            </div>
        </section>
    );
}


