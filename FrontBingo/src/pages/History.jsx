import React, { useState, useEffect, useMemo } from 'react';
import BottomNav from '../components/BottomNav';
import { useAuth } from '../lib/auth/AuthProvider';
import { apiFetch } from '../lib/api/client';

export default function History({ onNavigate }) {
    const { sessionId } = useAuth();
    const [transactions, setTransactions] = useState([]);
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('all');

    useEffect(() => {
        if (!sessionId) {
            console.log('No sessionId available for history fetch');
            return;
        }
        const fetchData = async () => {
            try {
                console.log('Fetching history data with sessionId:', sessionId);
                setLoading(true);
                const [transactionsData, gamesData] = await Promise.all([
                    apiFetch('/user/transactions', { sessionId }),
                    apiFetch('/user/games', { sessionId })
                ]);
                console.log('Transactions data received:', transactionsData);
                console.log('Games data received:', gamesData);
                setTransactions(transactionsData.transactions || []);
                setGames(gamesData.games || []);
            } catch (error) {
                console.error('Failed to fetch history data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
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
        <div className="min-h-screen overflow-y-auto pb-28 bg-gradient-to-br from-purple-900 via-purple-800 to-purple-900">
            <header className="p-6 pt-16">
                <h1 className="text-2xl font-extrabold text-white">Game History</h1>
            </header>

            <main className="p-6 space-y-5">
                {/* Stats cards */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="wallet-card">
                        <div className="text-slate-300 text-xs font-semibold">Total Games</div>
                        <div className="value mt-1">{totalGames}</div>
                    </div>
                    <div className="wallet-card">
                        <div className="text-slate-300 text-xs font-semibold">Games Won</div>
                        <div className="value green mt-1">{gamesWon}</div>
                    </div>
                </div>

                {/* Recent games */}
                <h3 className="history-title">Recent Games</h3>
                {loading ? (
                    <div className="flex justify-center items-center py-12">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-400"></div>
                    </div>
                ) : games.length === 0 ? (
                    <div className="rounded-2xl p-8 border border-white/10 bg-slate-900/40 text-center">
                        <div className="text-slate-400">No games yet</div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {games.map((g) => (
                            <div key={g.id} className="history-item">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="icon">🎮</div>
                                        <div>
                                            <div className="text-white font-semibold">Game {g.gameId}</div>
                                            <div className="text-slate-400 text-xs mt-0.5">{g.finishedAt ? new Date(g.finishedAt).toLocaleString() : ''}</div>
                                        </div>
                                    </div>
                                    <div>
                                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${g.userResult?.won ? 'bg-emerald-600/90 text-white' : 'bg-rose-600/90 text-white'}`}>{g.userResult?.won ? 'Won' : 'Lost'}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-5 text-slate-300 text-sm mt-3">
                                    <div>Stake: <span className="text-white font-semibold">{g.stake}</span></div>
                                    <div>Prize: <span className="text-white font-semibold">{g.userResult?.prize || 0}</span></div>
                                    <div>Status: <span className="text-white font-semibold">{g.status}</span></div>
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

