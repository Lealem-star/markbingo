import React, { useState, useEffect } from 'react';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../lib/auth/AuthProvider';
import { apiFetch } from '../lib/api/client';

export default function Scores({ onNavigate }) {
    const { sessionId, user } = useAuth();
    const [userStats, setUserStats] = useState({
        totalGamesPlayed: 0,
        totalGamesWon: 0,
        totalWinnings: 0,
        winRate: 0
    });
    const [loading, setLoading] = useState(true);
    const [topFilter, setTopFilter] = useState('newyear'); // newyear | alltime | monthly | weekly | daily
    const [leaderboardRows, setLeaderboardRows] = useState([]);
    const [leadersLoading, setLeadersLoading] = useState(false);

    useEffect(() => {
        if (!sessionId) {
            setLoading(false);
            return;
        }
        const fetchUserStats = async () => {
            try {
                setLoading(true);

                // Add timeout to prevent infinite loading
                const timeoutId = setTimeout(() => {
                    setLoading(false);
                }, 10000); // 10 second timeout

                const data = await apiFetch('/user/profile', { sessionId });
                const stats = data.user;
                setUserStats({
                    totalGamesPlayed: stats.totalGamesPlayed || 0,
                    totalGamesWon: stats.totalGamesWon || 0,
                    totalWinnings: stats.totalWinnings || 0,
                    winRate: stats.totalGamesPlayed > 0 ? Math.round((stats.totalGamesWon / stats.totalGamesPlayed) * 100) : 0
                });
                clearTimeout(timeoutId);
            } catch (error) {
                console.error('Failed to fetch user stats:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchUserStats();
    }, [sessionId]);

    // Fetch leaderboard data for selected period
    useEffect(() => {
        const fetchLeaderboard = async () => {
            try {
                setLeadersLoading(true);
                // Try a couple of likely endpoints; normalize response shape
                const tryEndpoints = async () => {
                    const endpoints = [
                        `/api/leaderboard?period=${topFilter}`,
                        `/leaderboard?period=${topFilter}`,
                        `/stats/leaderboard?period=${topFilter}`,
                        `/leaderboard/${topFilter}`
                    ];
                    for (const path of endpoints) {
                        try {
                            const res = await apiFetch(path, { sessionId });
                            return res;
                        } catch (e) {
                            // continue to next
                        }
                    }
                    return null;
                };

                const data = await tryEndpoints();
                // Expected shapes supported:
                // 1) { leaders: [{ name, wins, played }, ...] }
                // 2) [{ name, wins, played }, ...]
                const rows = Array.isArray(data)
                    ? data
                    : Array.isArray(data?.leaders)
                        ? data.leaders
                        : [];

                // Fallback: keep previous rows if API empty to avoid flash
                setLeaderboardRows(rows.map((r) => ({
                    name: r.name || r.username || r.player || 'Player',
                    wins: Number(r.wins ?? r.totalWins ?? 0),
                    played: Number(r.played ?? r.gamesPlayed ?? r.totalGames ?? 0)
                })));
            } catch (e) {
                console.error('Failed to fetch leaderboard:', e);
                setLeaderboardRows([]);
            } finally {
                setLeadersLoading(false);
            }
        };
        fetchLeaderboard();
    }, [topFilter, sessionId]);

    return (
        <div className="scores-page">
            <main className="scores-main">
                {loading ? (
                    <div className="scores-loading">
                        <div className="scores-spinner"></div>
                    </div>
                ) : (
                    <>
                        {/* Leaderboard header */}
                        <section
                            className="scores-section cursor-pointer"
                            onClick={() => onNavigate?.('history')}
                            role="button"
                            aria-label="Open history"
                            title="Open history"
                        >
                            <h2 className="scores-title">Leaderboard</h2>
                            <div className="scores-user-card">
                                <div className="scores-user-info">
                                    <div className="scores-user-avatar">
                                        {String(user?.firstName || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <div className="scores-user-details">
                                        <div className="scores-user-name">{user?.firstName || 'User'}</div>
                                        <div className="scores-user-stats">{userStats.totalGamesPlayed} Played • {userStats.totalGamesWon} wins</div>
                                    </div>
                                </div>
                                <div className="scores-user-rank">Unranked</div>
                            </div>
                        </section>

                        {/* Top Players filter bar + list */}
                        <section className="scores-section">
                            <h3 className="scores-subtitle">Top Players</h3>
                            <div className="scores-segmented">
                                <button onClick={() => setTopFilter('newyear')} className={`scores-seg ${topFilter === 'newyear' ? 'active' : ''}`}>New year</button>
                                <button onClick={() => setTopFilter('alltime')} className={`scores-seg ${topFilter === 'alltime' ? 'active' : ''}`}>All time</button>
                                <button onClick={() => setTopFilter('monthly')} className={`scores-seg ${topFilter === 'monthly' ? 'active' : ''}`}>Monthly</button>
                                <button onClick={() => setTopFilter('weekly')} className={`scores-seg ${topFilter === 'weekly' ? 'active' : ''}`}>Weekly</button>
                                <button onClick={() => setTopFilter('daily')} className={`scores-seg ${topFilter === 'daily' ? 'active' : ''}`}>Daily</button>
                            </div>
                            <div className="scores-leaderboard">
                                {leadersLoading ? (
                                    <div className="scores-leaderboard-loading">Loading...</div>
                                ) : leaderboardRows.length === 0 ? (
                                    <div className="scores-leaderboard-empty">No leaderboard data</div>
                                ) : leaderboardRows.map((p, i) => (
                                    <div key={`${p.name}-${i}`} className="scores-leaderboard-item">
                                        <div className="scores-leaderboard-content">
                                            <div className="scores-leaderboard-rank">{i + 1}</div>
                                            <div className="scores-leaderboard-details">
                                                <div className="scores-leaderboard-name">{p.name}</div>
                                                <div className="scores-leaderboard-wins">{p.wins} wins</div>
                                            </div>
                                            <div className="scores-leaderboard-played">{p.played}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </>
                )}
            </main>
            <BottomNav current="scores" onNavigate={onNavigate} />
        </div>
    );
}

