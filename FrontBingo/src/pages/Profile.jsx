import React, { useState, useEffect } from 'react';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../lib/auth/AuthProvider';
import { apiFetch } from '../lib/api/client';

export default function Profile({ onNavigate }) {
    const [sound, setSound] = useState(true);
    const [profileData, setProfileData] = useState({
        user: {
            firstName: 'User',
            lastName: '',
            phone: null,
            isRegistered: false,
            totalGamesPlayed: 0,
            totalGamesWon: 0,
            registrationDate: new Date()
        },
        wallet: {
            balance: 0,
            coins: 0,
            gamesWon: 0
        }
    });
    const [inviteStats, setInviteStats] = useState({
        totalInvites: 0,
        totalRewards: 0,
        totalDepositsFromInvited: 0,
        inviteCode: null
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { user, sessionId, isLoading: authLoading } = useAuth();

    const displayName = profileData.user?.firstName || user?.firstName || 'Player';
    const initials = displayName.charAt(0).toUpperCase();

    // Fetch profile data
    const fetchProfileData = React.useCallback(async () => {
        if (authLoading || !sessionId) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            setError(null);

            const [profileData, inviteData] = await Promise.all([
                apiFetch('/user/profile', { sessionId }),
                apiFetch('/user/invite-stats', { sessionId }).catch(() => null)
            ]);

            setProfileData(profileData);
            if (inviteData) {
                setInviteStats(inviteData);
            }
        } catch (error) {
            console.error('Failed to fetch profile data:', error);
            if (error.message === 'request_timeout') {
                setError('Request timeout - please try again');
            } else {
                setError('Failed to load profile. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    }, [sessionId, authLoading]);

    useEffect(() => {
        fetchProfileData();
    }, [fetchProfileData]);

    return (
        <div className="profile-page">
            {/* Header */}
            <header className="profile-header">
                <div className="profile-header-content">
                    <div className="profile-avatar">{initials}</div>
                    <h1 className="profile-name">{displayName}</h1>
                    {profileData.user?.isRegistered && (
                        <div className="profile-verified">
                            <span className="profile-verified-icon">✓</span>
                            <span className="profile-verified-text">Verified User</span>
                        </div>
                    )}
                </div>
            </header>

            {/* Main content */}
            <main className="profile-main">
                {loading ? (
                    <div className="profile-loading">
                        <div className="profile-spinner"></div>
                        <div className="profile-loading-text">Loading profile...</div>
                    </div>
                ) : error ? (
                    <div className="profile-error">
                        <div className="profile-error-icon">❌ Error Loading Data</div>
                        <div className="profile-error-text">{error}</div>
                        <button
                            onClick={fetchProfileData}
                            className="profile-retry-button"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Wallet & Statistics Cards */}
                        <div className="profile-cards">
                            {/* Main Wallet Balance */}
                            <div className="profile-card">
                                <div className="profile-card-title">
                                    <span className="profile-card-icon">💰</span>
                                    <span className="profile-card-label">Main Wallet</span>
                                </div>
                                <div className="profile-card-value">{profileData.wallet.main?.toLocaleString() || 0}</div>
                                <div className="profile-card-subtitle">Primary balance</div>
                            </div>

                            {/* Play Wallet Balance */}
                            <div className="profile-card">
                                <div className="profile-card-title">
                                    <span className="profile-card-icon">🎮</span>
                                    <span className="profile-card-label">Play Wallet</span>
                                </div>
                                <div className="profile-card-value profile-card-value-green">{profileData.wallet.play?.toLocaleString() || 0}</div>
                                <div className="profile-card-subtitle">Game funds</div>
                            </div>

                            {/* Credit */}
                            <div className="profile-card">
                                <div className="profile-card-title">
                                    <span className="profile-card-icon">📄</span>
                                    <span className="profile-card-label">Credit</span>
                                </div>
                                <div className="profile-card-value profile-card-value-blue">
                                    {profileData.wallet.creditAvailable?.toLocaleString() || 0}
                                </div>
                                <div className="profile-card-subtitle">
                                    Available Credit
                                    {((profileData.wallet.creditUsed || 0) > 0) && (
                                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-700 border border-orange-300">
                                            Used: {profileData.wallet.creditUsed}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Total Coins */}
                            <div className="profile-card">
                                <div className="profile-card-title">
                                    <span className="profile-card-icon">🪙</span>
                                    <span className="profile-card-label">Total Coins</span>
                                </div>
                                <div className="profile-card-value profile-card-value-yellow">{profileData.wallet.coins?.toLocaleString() || 0}</div>
                                <div className="profile-card-subtitle">Earned coins</div>
                            </div>

                            {/* Games Won */}
                            <div className="profile-card">
                                <div className="profile-card-title">
                                    <span className="profile-card-icon">🏆</span>
                                    <span className="profile-card-label">Games Won</span>
                                </div>
                                <div className="profile-card-value">{profileData.wallet.gamesWon?.toLocaleString() || 0}</div>
                                <div className="profile-card-subtitle">Victories</div>
                            </div>

                            {/* Invite Stats */}
                            <div className="profile-card">
                                <div className="profile-card-title">
                                    <span className="profile-card-icon">👥</span>
                                    <span className="profile-card-label">Invites</span>
                                </div>
                                <div className="profile-card-value">{inviteStats.totalInvites || 0}</div>
                                <div className="profile-card-subtitle">Friends invited</div>
                            </div>

                            {/* Invite Rewards */}
                            <div className="profile-card">
                                <div className="profile-card-title">
                                    <span className="profile-card-icon">🎁</span>
                                    <span className="profile-card-label">Invite Rewards</span>
                                </div>
                                <div className="profile-card-value profile-card-value-green">{inviteStats.totalRewards?.toLocaleString() || 0}</div>
                                <div className="profile-card-subtitle">
                                    ETB earned (play wallet)
                                    <br />
                                    <span className="text-xs text-gray-400">10% of invited users' deposits</span>
                                </div>
                            </div>

                            {/* Total Deposits from Invited Users */}
                            {inviteStats.totalDepositsFromInvited !== undefined && inviteStats.totalDepositsFromInvited > 0 && (
                                <div className="profile-card">
                                    <div className="profile-card-title">
                                        <span className="profile-card-icon">💰</span>
                                        <span className="profile-card-label">Invited Users Deposits</span>
                                    </div>
                                    <div className="profile-card-value profile-card-value-blue">{inviteStats.totalDepositsFromInvited?.toLocaleString() || 0}</div>
                                    <div className="profile-card-subtitle">Total deposits from invited users</div>
                                </div>
                            )}

                            {/* Invite Code */}
                            {inviteStats.inviteCode && (
                                <div className="profile-card">
                                    <div className="profile-card-title">
                                        <span className="profile-card-icon">🔗</span>
                                        <span className="profile-card-label">Invite Code</span>
                                    </div>
                                    <div className="profile-card-value profile-card-value-purple">{inviteStats.inviteCode}</div>
                                    <div className="profile-card-subtitle">Share with friends</div>
                                </div>
                            )}
                        </div>

                        {/* Settings Section */}
                        <div className="profile-settings">
                            <h2 className="profile-settings-title">Settings</h2>

                            {/* Sound Toggle */}
                            <div className="profile-settings-row">
                                <div className="profile-settings-content">
                                    <div className="profile-settings-label">
                                        <span className="profile-settings-icon">🔉</span>
                                        <span className="profile-settings-text">Sound</span>
                                    </div>
                                    <button onClick={() => setSound(!sound)} className={`profile-switch ${sound ? 'on' : ''}`} aria-pressed={sound}>
                                        <span className="profile-switch-knob"></span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </main>

            <BottomNav current="profile" onNavigate={onNavigate} />
        </div>
    );
}

