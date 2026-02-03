import React, { useState, useEffect, useMemo } from 'react';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../lib/auth/AuthProvider';
import { apiFetch } from '../lib/api/client';

export default function History({ onNavigate }) {
    const { sessionId } = useAuth();
    const [transactions, setTransactions] = useState([]);
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('all');

    useEffect(() => {
        if (!sessionId) {
            console.log('No sessionId available for history fetch');
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort('timeout'), 12000);

        const fetchData = async () => {
            try {
                console.log('Fetching history data with sessionId:', sessionId);
                setLoading(true);
                setError(null);

                const [transactionsData, gamesData] = await Promise.all([
                    apiFetch('/user/transactions', { sessionId, signal: controller.signal }),
                    apiFetch('/user/games', { sessionId, signal: controller.signal })
                ]);

                console.log('Transactions data received:', transactionsData);
                console.log('Games data received:', gamesData);

                setTransactions(transactionsData?.transactions || []);
                setGames(gamesData?.games || []);
            } catch (error) {
                if (error?.name === 'AbortError') {
                    console.error('History fetch timed out');
                    setError('Request timed out. Please try again.');
                } else {
                    console.error('Failed to fetch history data:', error);
                    setError('Unable to load your history right now.');
                }
            } finally {
                clearTimeout(timeoutId);
                setLoading(false);
            }
        };

        fetchData();

        return () => {
            controller.abort();
            clearTimeout(timeoutId);
        };
    }, [sessionId]);

    const filteredTransactions = transactions.filter(transaction => {
        if (activeTab === 'all') return true;
        if (activeTab === 'deposits') return transaction.type === 'deposit';
        if (activeTab === 'games') return ['game_bet', 'game_win'].includes(transaction.type);
        return true;
    });

    const totalGames = games.length;
    const gamesWon = games.filter(g => g.userResult?.won).length;

    const getTransactionIcon = (type) => {
        switch (type) {
            case 'deposit': return '💰';
            case 'game_win': return '🏆';
            case 'game_bet': return '🎮';
            case 'coin_conversion': return '🔄';
            default: return '📝';
        }
    };

    const getTransactionColor = (type) => {
        switch (type) {
            case 'deposit': return 'text-green-400';
            case 'game_win': return 'text-yellow-400';
            case 'game_bet': return 'text-red-400';
            case 'coin_conversion': return 'text-blue-400';
            default: return 'text-gray-400';
        }
    };

    return (
        <div className="min-h-screen overflow-y-auto pb-28" style={{ backgroundColor: '#e6e6fa' }}>
            <header className="p-6 pt-16">
                <h1 className="text-2xl font-extrabold text-gray-800">Game History</h1>
            </header>

            <main className="p-6 space-y-5">
                {error && !loading && (
                    <div className="rounded-2xl p-4 border border-red-500/30 bg-red-900/30 text-red-100 text-sm">
                        <div>{error}</div>
                        <button
                            className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-red-600/80 text-white text-xs font-semibold"
                            onClick={() => window.location.reload()}
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Stats cards */}
                {!loading && (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="wallet-card">
                            <div className="text-gray-600 text-xs font-semibold">Total Games</div>
                            <div className="value mt-1">{totalGames}</div>
                        </div>
                        <div className="wallet-card">
                            <div className="text-gray-600 text-xs font-semibold">Games Won</div>
                            <div className="value green mt-1">{gamesWon}</div>
                        </div>
                    </div>
                )}

                {/* Recent games */}
                <h3 className="history-title">Recent Games</h3>
                {loading ? (
                    <div className="flex flex-col justify-center items-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mb-4"></div>
                        <div className="text-gray-700 text-sm">Loading game history...</div>
                    </div>
                ) : games.length === 0 ? (
                    <div className="rounded-2xl p-8 border-2 border-purple-200/50 bg-white/60 backdrop-blur-sm text-center shadow-md">
                        <div className="text-gray-600">No games yet</div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {games.map((g) => (
                            <div key={g.id} className="history-item">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="icon">🎮</div>
                                        <div>
                                            <div className="text-gray-800 font-semibold">Game {g.gameId}</div>
                                            <div className="text-gray-600 text-xs mt-0.5">{g.finishedAt ? new Date(g.finishedAt).toLocaleString() : ''}</div>
                                        </div>
                                    </div>
                                    <div>
                                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${g.userResult?.won ? 'bg-emerald-600/90 text-white' : 'bg-rose-600/90 text-white'}`}>{g.userResult?.won ? 'Won' : 'Lost'}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-5 text-gray-700 text-sm mt-3">
                                    <div>Stake: <span className="text-gray-800 font-semibold">{g.stake}</span></div>
                                    <div>Prize: <span className="text-gray-800 font-semibold">{g.userResult?.prize || 0}</span></div>
                                    <div>Status: <span className="text-gray-800 font-semibold">{g.status}</span></div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
            <BottomNav current="history" onNavigate={onNavigate} />
        </div>
    );
}

