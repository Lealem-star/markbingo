import React, { useEffect, useState } from 'react';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../lib/auth/AuthProvider.jsx';
import { apiFetch } from '../lib/api/client.js';

export default function Wallet({ onNavigate }) {
    const { sessionId, user, isLoading: authLoading } = useAuth();
    const [wallet, setWallet] = useState({ main: 0, play: 0, coins: 0 });
    const [coins, setCoins] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('balance');
    const [transactions, setTransactions] = useState([]);
    const [profileData, setProfileData] = useState(null);
    const [displayPhone, setDisplayPhone] = useState(null);
    const [displayRegistered, setDisplayRegistered] = useState(false);

    // Transfer functionality removed - main and play wallets serve different purposes

    // History loading state
    const [historyLoading, setHistoryLoading] = useState(false);

    // Listen for wallet updates from WebSocket
    useEffect(() => {
        const handleWalletUpdate = (event) => {
            if (event.detail && event.detail.type === 'wallet_update') {
                const { main, play, coins, source } = event.detail.payload;
                setWallet(prev => ({
                    ...prev,
                    main: main || prev.main,
                    play: play || prev.play,
                    coins: coins || prev.coins
                }));

                // Show notification based on source
                if (source === 'win') {
                    showSuccess('Congratulations! You won the game!');
                } else if (source === 'completion') {
                    showSuccess('Game completed! You received 10 coins!');
                } else if (source === 'main' || source === 'play') {
                    showSuccess(`Stake deducted from ${source} wallet`);
                }
            }
        };

        window.addEventListener('walletUpdate', handleWalletUpdate);
        return () => window.removeEventListener('walletUpdate', handleWalletUpdate);
    }, []);

    // Helper function to show success messages
    const showSuccess = (message) => {
        // You can implement a toast notification here
        console.log('Success:', message);
    };

    // Fetch wallet and profile data once
    useEffect(() => {
        if (authLoading || !sessionId) {
            setLoading(false);
            return;
        }
        const fetchData = async () => {
            try {
                setLoading(true);

                // Fetch profile data which includes wallet information
                try {
                    const profile = await apiFetch('/user/profile', { sessionId });
                    setProfileData(profile);
                    setDisplayPhone(profile?.user?.phone || null);
                    setDisplayRegistered(!!profile?.user?.isRegistered);

                    // Extract wallet data from profile response
                    if (profile?.wallet) {
                        setWallet({
                            main: profile.wallet.main || 0,
                            play: profile.wallet.play || 0,
                            coins: profile.wallet.coins || 0
                        });
                    }
                } catch (e) {
                    console.error('Profile fetch error:', e);
                    // Fallback to direct wallet fetch if profile fails
                    try {
                        const walletData = await apiFetch('/wallet', { sessionId });
                        setWallet(walletData);
                    } catch (walletError) {
                        console.error('Wallet fetch error:', walletError);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch wallet data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [sessionId, authLoading]); // Removed activeTab dependency

    // Fetch transactions only when history tab is active
    useEffect(() => {
        if (!sessionId || activeTab !== 'history') return;

        const fetchTransactions = async () => {
            try {
                setHistoryLoading(true);
                const transactionData = await apiFetch('/user/transactions', { sessionId });
                // Backend returns { transactions: { transactions: [...], total: 50 } }
                setTransactions(transactionData.transactions?.transactions || []);
            } catch (error) {
                console.error('Failed to fetch transactions:', error);
                setTransactions([]); // Ensure we have an empty array on error
            } finally {
                setHistoryLoading(false);
            }
        };
        fetchTransactions();
    }, [sessionId, activeTab]);

    const convert = async () => {
        if (!sessionId) return;
        const amt = Number(coins || 0);
        if (!amt) return;
        try {
            // Convert coins to Birr and add to Play Wallet
            const out = await apiFetch('/wallet/convert', {
                method: 'POST',
                body: {
                    coins: amt,
                    targetWallet: 'play' // Add to Play Wallet instead of Main
                },
                sessionId
            });
            setWallet(out.wallet);
            setCoins('');
            // Refresh transactions if on history tab
            if (activeTab === 'history') {
                const transactionData = await apiFetch('/user/transactions', { sessionId });
                setTransactions(transactionData.transactions?.transactions || []);
            }
        } catch (error) {
            console.error('Coin conversion failed:', error);
            alert('Coin conversion failed. Please try again.');
        }
    };

    // Transfer functions removed - main and play wallets serve different purposes
    return (
        <div className="wallet-page">
            {/* Header */}
            <header className="wallet-header">
                <div className="wallet-header-content">
                    <h1 className="wallet-title">Wallet</h1>
                </div>
            </header>

            <main className="wallet-main">
                {/* User Info Section */}
                <div className="wallet-panel">
                    <div className="wallet-user-info">
                        <div className="wallet-user-details">
                            <div className="wallet-user-icon">👤</div>
                            <div className="wallet-user-text">
                                <span className="wallet-user-name">
                                    {profileData?.user?.firstName || user?.firstName || 'Player'}
                                </span>
                                {displayPhone && (
                                    <span className="wallet-user-phone">{displayPhone}</span>
                                )}
                            </div>
                        </div>
                        {displayRegistered ? (
                            <div className="wallet-status-verified">
                                <span className="wallet-status-icon">✓</span>
                                <span className="wallet-status-text">Verified</span>
                            </div>
                        ) : (
                            <div className="wallet-status-unverified">
                                <span className="wallet-status-icon">!</span>
                                <span className="wallet-status-text">Not registered</span>
                            </div>
                        )}
                    </div>

                    {/* Tabs */}
                    <div className="wallet-segmented">
                        <button
                            onClick={() => setActiveTab('balance')}
                            className={`wallet-seg ${activeTab === 'balance' ? 'active' : ''}`}
                        >
                            Balance
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`wallet-seg ${activeTab === 'history' ? 'active' : ''}`}
                        >
                            History
                        </button>
                    </div>
                </div>

                {loading ? (
                    <div className="wallet-loading">
                        <div className="wallet-spinner"></div>
                    </div>
                ) : activeTab === 'balance' ? (
                    /* Wallet Balances */
                    <div className="wallet-balances">
                        {/* Main Wallet */}
                        <div className="wallet-card">
                            <div className="wallet-card-content">
                                <div className="wallet-card-label">
                                    <span className="wallet-label-text">Main Wallet</span>
                                    <span className="wallet-label-icon">💰</span>
                                </div>
                                <span className="wallet-value">{wallet.main?.toLocaleString() || 0}</span>
                            </div>
                            <div className="wallet-card-description">
                                Primary balance for deposits and withdrawals
                            </div>
                        </div>

                        {/* Play Wallet */}
                        <div className="wallet-card">
                            <div className="wallet-card-content">
                                <div className="wallet-card-label">
                                    <span className="wallet-label-text">Play Wallet</span>
                                    <span className="wallet-label-icon">🎮</span>
                                </div>
                                <span className="wallet-value wallet-value-green">{wallet.play?.toLocaleString() || 0}</span>
                            </div>
                            <div className="wallet-card-description">
                                Gaming funds for placing bets and invite rewards
                            </div>
                        </div>

                        {/* Coins */}
                        <div className="wallet-card">
                            <div className="wallet-card-content">
                                <div className="wallet-card-label">
                                    <span className="wallet-label-text">Coins</span>
                                    <span className="wallet-label-icon">🪙</span>
                                </div>
                                <span className="wallet-value wallet-value-yellow">{wallet.coins?.toLocaleString() || 0}</span>
                            </div>
                            <div className="wallet-card-description">
                                Earned coins that can be converted to wallet funds
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Transaction History */
                    <div className="wallet-history">
                        <h3 className="wallet-history-title">Recent Transactions</h3>
                        {historyLoading ? (
                            <div className="wallet-loading">
                                <div className="wallet-spinner"></div>
                                <div className="wallet-loading-text">Loading transactions...</div>
                            </div>
                        ) : transactions.length === 0 ? (
                            <div className="wallet-empty-state">
                                <div className="wallet-empty-icon">📝</div>
                                <div className="wallet-empty-text">No transactions yet</div>
                            </div>
                        ) : (
                            transactions.map((transaction) => (
                                <div key={transaction.id} className="wallet-transaction">
                                    <div className="wallet-transaction-content">
                                        <div className="wallet-transaction-info">
                                            <div className="wallet-transaction-icon">📄</div>
                                            <div className="wallet-transaction-details">
                                                <div className="wallet-transaction-description">{transaction.description || (transaction.type === 'deposit' ? 'Deposit' : 'Transaction')}</div>
                                                <div className="wallet-transaction-date">
                                                    {new Date(transaction.createdAt).toLocaleString()}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="wallet-transaction-amount">
                                            <div className={`wallet-transaction-value ${transaction.amount > 0 ? 'positive' : 'negative'}`}>{transaction.amount > 0 ? `+${transaction.amount}` : `${transaction.amount}`}</div>
                                            <div className={`wallet-transaction-status ${transaction.status === 'Approved' || transaction.amount > 0 ? 'approved' : 'pending'}`}>{transaction.status || (transaction.amount > 0 ? 'Approved' : '')}</div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* Transfer Section removed - main and play wallets serve different purposes */}

                {/* Convert Section - show only on Balance tab */}
                {activeTab === 'balance' && (
                    <div className="wallet-convert">
                        <h3 className="wallet-convert-title">Convert Coins to Birr</h3>
                        <div className="wallet-convert-description">
                            Convert your earned coins to Birr and add to your Play Wallet for gaming
                        </div>
                        <div className="wallet-convert-controls">
                            <input
                                value={coins}
                                onChange={(e) => setCoins(e.target.value)}
                                className="wallet-convert-input"
                                placeholder="Enter coins to convert to Birr"
                            />
                            <button
                                onClick={convert}
                                className="wallet-convert-button"
                            >
                                <span>🪙→💰</span>
                                <span>Convert to Play Wallet</span>
                            </button>
                        </div>
                    </div>
                )}
            </main>
            <BottomNav current="wallet" onNavigate={onNavigate} />
        </div>
    );
}

