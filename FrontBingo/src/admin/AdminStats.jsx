import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api/client';

export default function AdminStats() {
    const [today, setToday] = useState({ totalPlayers: 0, systemCut: 0 });
    const [dailyStats, setDailyStats] = useState([]);
    const [todayFinance, setTodayFinance] = useState({ totalGames: 0, totalDeposit: 0, totalWithdraw: 0 });
    const [inviteStats, setInviteStats] = useState({
        global: {
            totalUsers: 0,
            totalInvites: 0,
            totalInviteRewards: 0,
            avgInvitesPerUser: 0
        },
        topInviters: []
    });
    const [totalMainWallet, setTotalMainWallet] = useState(0);

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
                        const totalRevenue = dayGames.reduce((sum, g) => sum + (g.systemCut || 0), 0);
                        const totalPlayers = dayGames.reduce((sum, g) => sum + (g.playersCount || 0), 0);

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
                            noPlayed: totalPlayers,
                            systemRevenue: totalRevenue,
                            totalGames: dayGames.length
                        };
                    })
                    .sort((a, b) => a.day.localeCompare(b.day))
                    .reverse(); // Most recent first

                setDailyStats(dailyStatsList);
            } catch (error) {
                console.error('Error fetching daily game stats:', error);
                setDailyStats([]);
            }
            try {
                // Today's totals: games played, deposits, withdrawals
                const start = new Date(); start.setHours(0, 0, 0, 0);
                const end = new Date(); end.setHours(23, 59, 59, 999);
                const from = start.toISOString();
                const to = end.toISOString();

                const [overview, depositsRes, withdrawalsCompletedRes] = await Promise.all([
                    apiFetch('/admin/stats/overview'),
                    apiFetch(`/admin/balances/deposits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
                    apiFetch('/admin/balances/withdrawals?status=completed')
                ]);

                const totalGames = overview?.today?.totalGames || 0;

                const deposits = depositsRes?.deposits || [];
                const totalDeposit = deposits
                    .filter(d => (d.status || 'completed') === 'completed' && d.createdAt && new Date(d.createdAt) >= start && new Date(d.createdAt) <= end)
                    .reduce((sum, d) => sum + (Number(d.amount) || 0), 0);

                const withdrawalsCompleted = withdrawalsCompletedRes?.withdrawals || [];
                const totalWithdraw = withdrawalsCompleted
                    .filter(w => {
                        // Check processedBy.processedAt (where bot stores the approval date)
                        const processedDate = w.processedBy?.processedAt || w.processedAt;
                        return processedDate && new Date(processedDate) >= start && new Date(processedDate) <= end;
                    })
                    .reduce((sum, w) => sum + (Number(w.amount) || 0), 0);

                setTodayFinance({ totalGames, totalDeposit, totalWithdraw });
            } catch { }
            try {
                const inviteData = await apiFetch('/admin/stats/invites');
                setInviteStats(inviteData);
            } catch { }
            try {
                const walletData = await apiFetch('/admin/stats/wallets/total-main');
                setTotalMainWallet(walletData?.totalMain || 0);
            } catch { }
        })();
    }, []);

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

            {/* Invite Statistics Section */}
            <div className="admin-stats-grid">
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Total Invites</div>
                        <div className="admin-stats-value admin-stats-value-blue">{inviteStats.global.totalInvites}</div>
                    </div>
                </div>
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Total Sum of All User Main Wallet</div>
                        <div className="admin-stats-value admin-stats-value-purple">ETB {totalMainWallet.toFixed(2)}</div>
                    </div>
                </div>
            </div>

            {/* Top Inviters Table */}
            {inviteStats.topInviters.length > 0 && (
                <div className="admin-stats-table-container" style={{ '--stats-table-cols': 3 }}>
                    <h3 className="admin-stats-table-title">Top Inviters</h3>

                    {/* Table Header */}
                    <div className="admin-stats-table-header">
                        <div className="admin-stats-table-header-item">User</div>
                        <div className="admin-stats-table-header-item">Invites</div>
                        <div className="admin-stats-table-header-item">Rewards (Play Wallet)</div>
                    </div>

                    {/* Table Content */}
                    <div className="admin-stats-table-content">
                        {inviteStats.topInviters.map((inviter, index) => (
                            <div key={index} className="admin-stats-table-row">
                                <div className="admin-stats-table-cell">
                                    {inviter.firstName} {inviter.lastName}
                                </div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-center">
                                    {inviter.totalInvites}
                                </div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-right">
                                    ETB {inviter.inviteRewards || 0}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Daily Statistics Table */}
            <div className="admin-stats-table-container" style={{ '--stats-table-cols': 5 }}>
                <h3 className="admin-stats-table-title">Daily Statistics</h3>

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
                    {dailyStats.length > 0 ? (
                        dailyStats.map((stat, index) => (
                            <div key={index} className="admin-stats-table-row">
                                <div className="admin-stats-table-cell">{new Date(stat.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-center">{stat.totalGames || 0}</div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-center">{stat.stakesDisplay}</div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-center">{stat.noPlayed}</div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-right">ETB {stat.systemRevenue.toFixed(2)}</div>
                            </div>
                        ))
                    ) : (
                        <div className="admin-stats-empty">No data available</div>
                    )}
                </div>
            </div>
        </div>
    );
}
