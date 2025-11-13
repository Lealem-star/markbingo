import React, { useMemo, useState } from 'react';
import { apiFetch } from '../lib/api/client';

export default function AdminUserBalanceAccess() {
    const [query, setQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState([]);
    const [searchError, setSearchError] = useState(null);
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [adjustment, setAdjustment] = useState({
        mainDelta: '',
        playDelta: '',
        coinsDelta: '',
        reason: ''
    });
    const [isAdjusting, setIsAdjusting] = useState(false);
    const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', message: string }

    const selectedUser = useMemo(
        () => results.find(user => user.id === selectedUserId) || null,
        [results, selectedUserId]
    );

    const throttledSearchRef = React.useRef(null);

    const performSearch = React.useCallback(async (term) => {
        const trimmed = term.trim();
        if (!trimmed) {
            setResults([]);
            setSelectedUserId(null);
            setSearchError(null);
            return;
        }

        setIsSearching(true);
        setSearchError(null);
        setFeedback(null);

        try {
            const response = await apiFetch(`/admin/users/search?query=${encodeURIComponent(trimmed)}`);
            const users = response?.users || [];
            setResults(users);
        } catch (error) {
            console.error('Admin user search failed:', error);
            setSearchError('Search failed. Please try again.');
            setResults([]);
            setSelectedUserId(null);
        } finally {
            setIsSearching(false);
        }
    }, []);

    const handleSearchInput = (value) => {
        setQuery(value);
        if (throttledSearchRef.current) {
            clearTimeout(throttledSearchRef.current);
        }
        throttledSearchRef.current = setTimeout(() => performSearch(value), 250);
    };

    const handleSelectUser = (userId) => {
        setSelectedUserId(userId);
        setAdjustment({
            mainDelta: '',
            playDelta: '',
            coinsDelta: '',
            reason: ''
        });
        setFeedback(null);
    };

    const updateAdjustmentField = (field, value) => {
        setAdjustment(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const adjustBy = (field, delta) => {
        setAdjustment(prev => {
            const current = Number(prev[field]) || 0;
            const next = Math.round((current + delta) * 100) / 100;
            return {
                ...prev,
                [field]: next === 0 ? '' : next.toString()
            };
        });
    };

    const adjustCoinsBy = (delta) => {
        setAdjustment(prev => {
            const current = Number.isFinite(Number(prev.coinsDelta)) ? Number(prev.coinsDelta) : 0;
            const next = current + delta;
            return {
                ...prev,
                coinsDelta: next === 0 ? '' : next.toString()
            };
        });
    };

    const getNumber = (value) => {
        if (value === '' || value === null || value === undefined) {
            return 0;
        }
        const num = Number(value);
        return Number.isNaN(num) ? NaN : num;
    };

    const handleAdjustmentSubmit = async (event) => {
        event.preventDefault();
        if (!selectedUser) return;

        const mainDelta = getNumber(adjustment.mainDelta);
        const playDelta = getNumber(adjustment.playDelta);
        const coinsDelta = getNumber(adjustment.coinsDelta);

        if (Number.isNaN(mainDelta) || Number.isNaN(playDelta) || Number.isNaN(coinsDelta)) {
            setFeedback({ type: 'error', message: 'Amounts must be valid numbers.' });
            return;
        }

        if (mainDelta === 0 && playDelta === 0 && coinsDelta === 0) {
            setFeedback({ type: 'error', message: 'Add or subtract at least one amount before saving.' });
            return;
        }

        setIsAdjusting(true);
        setFeedback(null);

        try {
            const response = await apiFetch(`/admin/users/${selectedUser.id}/wallet-adjust`, {
                method: 'POST',
                body: {
                    mainDelta,
                    playDelta,
                    coinsDelta,
                    reason: adjustment.reason || ''
                }
            });

            const updatedWallet = response?.wallet;
            if (updatedWallet) {
                setResults(prev =>
                    prev.map(user =>
                        user.id === selectedUser.id
                            ? { ...user, wallet: updatedWallet }
                            : user
                    )
                );
            }

            setAdjustment(prev => ({
                ...prev,
                mainDelta: '',
                playDelta: '',
                coinsDelta: ''
            }));

            setFeedback({ type: 'success', message: 'Wallet updated successfully.' });
        } catch (error) {
            console.error('Admin wallet adjustment failed:', error);
            setFeedback({ type: 'error', message: error?.message === 'api_error_400' ? 'Update rejected. Check the entered values.' : 'Failed to update wallet. Please try again.' });
        } finally {
            setIsAdjusting(false);
        }
    };

    const hasPendingChanges = () => {
        const mainDelta = getNumber(adjustment.mainDelta);
        const playDelta = getNumber(adjustment.playDelta);
        const coinsDelta = getNumber(adjustment.coinsDelta);
        return (
            !Number.isNaN(mainDelta) && mainDelta !== 0 ||
            !Number.isNaN(playDelta) && playDelta !== 0 ||
            !Number.isNaN(coinsDelta) && coinsDelta !== 0
        );
    };

    const canReset =
        adjustment.mainDelta !== '' ||
        adjustment.playDelta !== '' ||
        adjustment.coinsDelta !== '' ||
        (adjustment.reason || '').trim() !== '';

    return (
        <div className="admin-card admin-user-balance-access">
            <div className="admin-user-search-bar">
                <input
                    id="admin-user-search-input"
                    type="text"
                    className="admin-user-search-input"
                    placeholder="Search name, username, or Telegram ID..."
                    value={query}
                    onChange={(event) => handleSearchInput(event.target.value)}
                />
                <div className="admin-user-search-indicator">
                    {isSearching ? (
                        <div className="admin-spinner admin-spinner-inline"></div>
                    ) : (
                        <span>🔎</span>
                    )}
                </div>
            </div>

            {searchError && (
                <div className="admin-feedback admin-feedback-error">{searchError}</div>
            )}

            {selectedUser && (
                <div className="admin-user-editor">
                    <div className="admin-user-editor-header">
                        <div className="admin-user-editor-identity">
                            <span className="admin-user-avatar">{selectedUser.firstName?.[0]?.toUpperCase() || '👤'}</span>
                            <div className="admin-user-editor-meta">
                                <span className="admin-user-editor-name">
                                    {selectedUser.firstName} {selectedUser.lastName}
                                </span>
                                <div className="admin-user-editor-tags">
                                    {selectedUser.username ? <span>@{selectedUser.username}</span> : null}
                                    <span>ID: {selectedUser.telegramId}</span>
                                </div>
                            </div>
                        </div>
                        <div className="admin-user-editor-wallet">
                            <span>Main: {Number(selectedUser.wallet?.main || 0).toLocaleString()}</span>
                            <span>Play: {Number(selectedUser.wallet?.play || 0).toLocaleString()}</span>
                            <span>Coins: {Number(selectedUser.wallet?.coins || 0).toLocaleString()}</span>
                        </div>
                    </div>

                    <form className="admin-user-editor-form" onSubmit={handleAdjustmentSubmit}>
                        <div className="admin-user-editor-grid">
                            <div className="admin-adjustment-slot">
                                <label htmlFor="admin-adjust-main">Main Wallet</label>
                                <div className="admin-adjustment-controls">
                                    <button type="button" onClick={() => adjustBy('mainDelta', -10)}>−10</button>
                                    <button type="button" onClick={() => adjustBy('mainDelta', -1)}>−1</button>
                                    <input
                                        id="admin-adjust-main"
                                        type="number"
                                        step="0.01"
                                        value={adjustment.mainDelta}
                                        onChange={(event) => updateAdjustmentField('mainDelta', event.target.value)}
                                        placeholder="+/- amount"
                                    />
                                    <button type="button" onClick={() => adjustBy('mainDelta', 1)}>+1</button>
                                    <button type="button" onClick={() => adjustBy('mainDelta', 10)}>+10</button>
                                </div>
                            </div>
                            <div className="admin-adjustment-slot">
                                <label htmlFor="admin-adjust-play">Play Wallet</label>
                                <div className="admin-adjustment-controls">
                                    <button type="button" onClick={() => adjustBy('playDelta', -10)}>−10</button>
                                    <button type="button" onClick={() => adjustBy('playDelta', -1)}>−1</button>
                                    <input
                                        id="admin-adjust-play"
                                        type="number"
                                        step="0.01"
                                        value={adjustment.playDelta}
                                        onChange={(event) => updateAdjustmentField('playDelta', event.target.value)}
                                        placeholder="+/- amount"
                                    />
                                    <button type="button" onClick={() => adjustBy('playDelta', 1)}>+1</button>
                                    <button type="button" onClick={() => adjustBy('playDelta', 10)}>+10</button>
                                </div>
                            </div>
                            <div className="admin-adjustment-slot">
                                <label htmlFor="admin-adjust-coins">Coins</label>
                                <div className="admin-adjustment-controls">
                                    <button type="button" onClick={() => adjustCoinsBy(-100)}>−100</button>
                                    <button type="button" onClick={() => adjustCoinsBy(-10)}>−10</button>
                                    <input
                                        id="admin-adjust-coins"
                                        type="number"
                                        step="1"
                                        value={adjustment.coinsDelta}
                                        onChange={(event) => updateAdjustmentField('coinsDelta', event.target.value)}
                                        placeholder="+/- coins"
                                    />
                                    <button type="button" onClick={() => adjustCoinsBy(10)}>+10</button>
                                    <button type="button" onClick={() => adjustCoinsBy(100)}>+100</button>
                                </div>
                            </div>
                        </div>

                        <textarea
                            className="admin-user-editor-reason"
                            rows={2}
                            placeholder="Reason (optional)"
                            value={adjustment.reason}
                            onChange={(event) => updateAdjustmentField('reason', event.target.value)}
                        />

                        <div className="admin-user-editor-actions">
                            <button
                                type="button"
                                className="admin-button admin-adjust-reset"
                                onClick={() => {
                                    setAdjustment({
                                        mainDelta: '',
                                        playDelta: '',
                                        coinsDelta: '',
                                        reason: ''
                                    });
                                    setFeedback(null);
                                }}
                                disabled={isAdjusting || !canReset}
                            >
                                <span className="admin-button-content">
                                    <span>♻️</span>
                                    Reset
                                </span>
                            </button>
                            <button
                                type="submit"
                                className="admin-button admin-adjust-save"
                                disabled={isAdjusting || !hasPendingChanges()}
                            >
                                {isAdjusting ? (
                                    <span className="admin-button-content">
                                        <div className="admin-spinner"></div>
                                        Saving...
                                    </span>
                                ) : (
                                    <span className="admin-button-content">
                                        <span>💾</span>
                                        Save
                                    </span>
                                )}
                            </button>
                        </div>
                    </form>
                    {feedback && (
                        <div className={`admin-feedback ${feedback.type === 'error' ? 'admin-feedback-error' : 'admin-feedback-success'}`}>
                            {feedback.message}
                        </div>
                    )}
                </div>
            )}

            <div className="admin-user-results-table">
                <div className="admin-user-results-header">
                    <span>Name</span>
                    <span>Main</span>
                    <span>Play</span>
                    <span>Coins</span>
                    <span></span>
                </div>

                {results.length === 0 && query.trim() !== '' && !isSearching ? (
                    <div className="admin-empty-state admin-user-empty-state">
                        <div className="admin-empty-icon">👥</div>
                        <div className="admin-empty-title">No results</div>
                        <div className="admin-empty-subtitle">Try a different name or username.</div>
                    </div>
                ) : (
                    <div className="admin-user-results-body">
                        {results.map(user => {
                            const main = Number(user.wallet?.main || 0).toLocaleString();
                            const play = Number(user.wallet?.play || 0).toLocaleString();
                            const coins = Number(user.wallet?.coins || 0).toLocaleString();

                            return (
                                <div
                                    key={user.id}
                                    className={`admin-user-result-row ${selectedUserId === user.id ? 'admin-user-result-row-active' : ''}`}
                                >
                                    <div className="admin-user-result-cell admin-user-result-name-cell">
                                        <span className="admin-user-result-name">{user.firstName} {user.lastName}</span>
                                        {user.username ? <span className="admin-user-result-username">@{user.username}</span> : null}
                                    </div>
                                    <div className="admin-user-result-cell">{main}</div>
                                    <div className="admin-user-result-cell">{play}</div>
                                    <div className="admin-user-result-cell">{coins}</div>
                                    <div className="admin-user-result-cell admin-user-result-action">
                                        <button
                                            type="button"
                                            className="admin-button admin-user-edit-button"
                                            onClick={() => handleSelectUser(user.id)}
                                        >
                                            {selectedUserId === user.id ? 'Editing' : 'Edit'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

