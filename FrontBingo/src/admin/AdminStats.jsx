import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api/client';

export default function AdminStats() {
    const [today, setToday] = useState({ totalPlayers: 0, systemCut: 0 });
    const [dailyStats, setDailyStats] = useState([]);
    const [todayFinance, setTodayFinance] = useState({ totalGames: 0, totalDeposit: 0, totalWithdraw: 0 });
    const [totalMainWallet, setTotalMainWallet] = useState(0);
    const [totalPlayWallet, setTotalPlayWallet] = useState(0);
    const [totalSystemRevenue, setTotalSystemRevenue] = useState(0);

    useEffect(() => {
        (async () => {
            try {
                const t = await apiFetch('/admin/stats/today');
                setToday(t);
            } catch { }
            try {
                // Fetch real daily game statistics
                const gamesData = await apiFetch('/admin/stats/games?days=14');
                const games = gamesData?.games || [];

                // Group games by day and format for display
                const statsByDay = {};
                games.forEach(game => {
                    if (game.finishedAt) {
                        const day = new Date(game.finishedAt).toISOString().slice(0, 10);
                        if (!statsByDay[day]) {
                            statsByDay[day] = {
                                day: day,
                                games: []
                            };
                        }
                        statsByDay[day].games.push(game);
                    }
                });

                // Convert to array format and calculate totals per day
                const dailyStatsList = Object.values(statsByDay)
                    .map(dayData => {
                        const dayGames = dayData.games;
                        
                        // Calculate total system revenue for this day (sum of all 20% cuts)
                        const totalRevenue = dayGames.reduce((sum, g) => sum + (g.systemCut || 0), 0);
                        
                        // Calculate unique players for this day
                        const uniquePlayerIds = new Set();
                        dayGames.forEach(game => {
                            if (game.players && Array.isArray(game.players)) {
                                game.players.forEach(playerId => {
                                    if (playerId) {
                                        uniquePlayerIds.add(playerId.toString());
                                    }
                                });
                            }
                        });
                        const totalUniquePlayers = uniquePlayerIds.size;

                        // Collect all unique stakes for this day
                        const uniqueStakes = [...new Set(dayGames.map(g => g.stake || 0).filter(s => s > 0))];
                        // Sort stakes in ascending order for display
                        uniqueStakes.sort((a, b) => a - b);
                        // Format stakes as comma-separated string
                        const stakesDisplay = uniqueStakes.length > 0
                            ? uniqueStakes.map(s => `ETB ${s}`).join(', ')
                            : 'N/A';

                        return {
                            day: dayData.day,
                            stakes: uniqueStakes,
                            stakesDisplay: stakesDisplay,
                            noPlayed: totalUniquePlayers,
                            systemRevenue: totalRevenue,
                            totalGames: dayGames.length
                        };
                    })
                    .sort((a, b) => a.day.localeCompare(b.day))
                    .reverse(); // Most recent first

                // Calculate total system revenue (sum of all 20% cuts)
                const totalRevenue = games.reduce((sum, game) => sum + (game.systemCut || 0), 0);

                setDailyStats(dailyStatsList);
                setTotalSystemRevenue(totalRevenue);
            } catch (error) {
                console.error('Error fetching daily game stats:', error);
                setDailyStats([]);
            }
            try {
                // Today's totals: games played, deposits, withdrawals
                // Use UTC+3 (Africa/Addis_Ababa) timezone to match server
                const now = new Date();
                const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
                const addisAbabaTime = new Date(utcTime + (3 * 3600000)); // UTC+3
                
                const start = new Date(addisAbabaTime);
                start.setHours(0, 0, 0, 0);
                const startUTC = new Date(start.getTime() - (3 * 3600000)); // Convert back to UTC
                
                const end = new Date(addisAbabaTime);
                end.setHours(23, 59, 59, 999);
                const endUTC = new Date(end.getTime() - (3 * 3600000)); // Convert back to UTC
                
                const from = startUTC.toISOString();
                const to = endUTC.toISOString();

                const [overview, depositsRes, withdrawalsCompletedRes] = await Promise.all([
                    apiFetch('/admin/stats/overview'),
                    apiFetch(`/admin/balances/deposits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
                    apiFetch('/admin/balances/withdrawals?status=completed')
                ]);

                const totalGames = overview?.today?.totalGames || 0;

                const deposits = depositsRes?.deposits || [];
                const totalDeposit = deposits
                    .filter(d => (d.status || 'completed') === 'completed' && d.createdAt && new Date(d.createdAt) >= startUTC && new Date(d.createdAt) <= endUTC)
                    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

                const withdrawalsCompleted = withdrawalsCompletedRes?.withdrawals || [];
                const totalWithdraw = withdrawalsCompleted
                    .filter(w => {
                        // Check processedBy.processedAt (where bot stores the approval date)
                        const processedDate = w.processedBy?.processedAt || w.processedAt;
                        return processedDate && new Date(processedDate) >= startUTC && new Date(processedDate) <= endUTC;
                    })
                    .reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

                setTodayFinance({ totalGames, totalDeposit, totalWithdraw });
            } catch { }
            try {
                const walletData = await apiFetch('/admin/stats/wallets/total-main');
                setTotalMainWallet(walletData?.totalMain || 0);
            } catch { }
            try {
                const playWalletData = await apiFetch('/admin/stats/wallets/total-play');
                setTotalPlayWallet(playWalletData?.totalPlay || 0);
            } catch { }
        })();
    }, []);

    const weeklyStats = dailyStats.slice(0, 7);

    return (
        <div className="admin-stats-container admin-stats-page">
            {/* Today's Stats Section */}
            <div className="admin-stats-grid">
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Today's System Revenue</div>
                        <div className="admin-stats-value admin-stats-value-amber">ETB {today.systemCut}</div>
                    </div>
                </div>
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Total Players Today</div>
                        <div className="admin-stats-value admin-stats-value-green">{today.totalPlayers}</div>
                    </div>
                </div>
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Total Games Today</div>
                        <div className="admin-stats-value admin-stats-value-blue">{todayFinance.totalGames}</div>
                    </div>
                </div>
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Total Deposits Today</div>
                        <div className="admin-stats-value admin-stats-value-green">ETB {todayFinance.totalDeposit}</div>
                    </div>
                </div>
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Total Withdrawals Today</div>
                        <div className="admin-stats-value admin-stats-value-red">ETB {todayFinance.totalWithdraw}</div>
                    </div>
                </div>
            </div>

            {/* Finance Section */}
            <div className="admin-stats-grid">
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Total Sum of All User Main Wallet</div>
                        <div className="admin-stats-value admin-stats-value-purple">ETB {totalMainWallet.toFixed(2)}</div>
                    </div>
                </div>
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Total Sum of All User play Wallet</div>
                        <div className="admin-stats-value admin-stats-value-purple">ETB {totalPlayWallet.toFixed(2)}</div>
                    </div>
                </div>
            </div>

            {/* Daily Statistics Table */}
            <div
                className="admin-stats-table-container"
                style={{ '--stats-table-cols': 5, minHeight: '360px' }}
            >
                <h3 className="admin-stats-table-title">Daily Statistics</h3>

                <div className="admin-stats-table-wrapper">
                    {/* Table Header */}
                    <div className="admin-stats-table-header">
                        <div className="admin-stats-table-header-item">Day</div>
                        <div className="admin-stats-table-header-item">Games</div>
                        <div className="admin-stats-table-header-item">Stake</div>
                        <div className="admin-stats-table-header-item">Total Players</div>
                        <div className="admin-stats-table-header-item">System Revenue</div>
                    </div>

                    {/* Table Content */}
                    <div className="admin-stats-table-content">
                        {weeklyStats.length > 0 ? (
                            weeklyStats.map((stat, index) => (
                                <div key={index} className="admin-stats-table-row">
                                    <div className="admin-stats-table-cell">{new Date(stat.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                                    <div className="admin-stats-table-cell admin-stats-table-cell-center">{stat.totalGames || 0}</div>
                                    <div className="admin-stats-table-cell admin-stats-table-cell-center">{stat.stakesDisplay}</div>
                                    <div className="admin-stats-table-cell admin-stats-table-cell-center">{stat.noPlayed || 0}</div>
                                    <div className="admin-stats-table-cell admin-stats-table-cell-right">ETB {(stat.systemRevenue || 0).toFixed(2)}</div>
                                </div>
                            ))
                        ) : (
                            <div className="admin-stats-empty">No data available</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
