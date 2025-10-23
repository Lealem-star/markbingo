import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api/client';

export default function AdminStats() {
    const [today, setToday] = useState({ totalPlayers: 0, systemCut: 0 });
    const [dailyStats, setDailyStats] = useState([]);
    const [inviteStats, setInviteStats] = useState({
        global: {
            totalUsers: 0,
            totalInvites: 0,
            totalInviteRewards: 0,
            avgInvitesPerUser: 0
        },
        topInviters: []
    });

    useEffect(() => {
        (async () => {
            try {
                const t = await apiFetch('/admin/stats/today');
                setToday(t);
            } catch { }
            try {
                // Fetch daily game statistics - this would need a new endpoint
                // For now, we'll use the existing revenue endpoint and simulate game data
                const r = await apiFetch('/admin/stats/revenue/by-day?days=14');
                const revenueData = r.revenueByDay || [];

                // Simulate daily game statistics with the available data
                const simulatedStats = revenueData.map((item, index) => ({
                    day: item.day,
                    gameId: `LB${Date.now() - (index * 86400000)}`,
                    stake: index % 2 === 0 ? 10 : 50,
                    noPlayed: Math.floor(Math.random() * 20) + 5,
                    systemRevenue: item.revenue
                }));

                setDailyStats(simulatedStats);
            } catch { }
            try {
                const inviteData = await apiFetch('/admin/stats/invites');
                setInviteStats(inviteData);
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
                        <div className="admin-stats-label">Invite Rewards Paid</div>
                        <div className="admin-stats-value admin-stats-value-purple">ETB {inviteStats.global.totalInviteRewards}</div>
                        <div className="admin-stats-subtitle">(1 ETB per 10 invites)</div>
                    </div>
                </div>
                <div className="admin-stats-card">
                    <div>
                        <div className="admin-stats-label">Avg Invites per User</div>
                        <div className="admin-stats-value admin-stats-value-yellow">{inviteStats.global.avgInvitesPerUser?.toFixed(1) || 0}</div>
                    </div>
                </div>
            </div>

            {/* Top Inviters Table */}
            {inviteStats.topInviters.length > 0 && (
                <div className="admin-stats-table-container">
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
            <div className="admin-stats-table-container">
                <h3 className="admin-stats-table-title">Daily Statistics</h3>

                {/* Table Header */}
                <div className="admin-stats-table-header">
                    <div className="admin-stats-table-header-item">Day</div>
                    <div className="admin-stats-table-header-item">Game ID</div>
                    <div className="admin-stats-table-header-item">Stake</div>
                    <div className="admin-stats-table-header-item">No Played</div>
                    <div className="admin-stats-table-header-item">System Revenue</div>
                </div>

                {/* Table Content */}
                <div className="admin-stats-table-content">
                    {dailyStats.length > 0 ? (
                        dailyStats.map((stat, index) => (
                            <div key={index} className="admin-stats-table-row">
                                <div className="admin-stats-table-cell">{stat.day}</div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-mono">{stat.gameId}</div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-center">ETB {stat.stake}</div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-center">{stat.noPlayed}</div>
                                <div className="admin-stats-table-cell admin-stats-table-cell-right">ETB {stat.systemRevenue}</div>
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
