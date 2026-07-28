import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api/client';

function defaultClosesAtLocal() {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function matchStatusLabel(status) {
    if (status === 'locked') return 'ዝግ';
    if (status === 'settled') return 'ተጠናቋል';
    return status;
}

export default function AdminBonus() {
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [form, setForm] = useState({
        team1Name: '',
        team1Flag: '🏳️',
        team2Name: '',
        team2Flag: '🏳️',
        closesAt: defaultClosesAtLocal(),
        openImmediately: true
    });
    const [settleScores, setSettleScores] = useState({});

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const data = await apiFetch('/admin/bonus/matches');
            setMatches(data?.matches || []);
        } catch (err) {
            console.error('Failed to load bonus matches:', err);
            alert('Could not load bonus matches.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const createMatch = async (e) => {
        e.preventDefault();
        if (!form.team1Name.trim() || !form.team2Name.trim()) {
            alert('Enter both team names.');
            return;
        }
        try {
            setBusyId('create');
            await apiFetch('/admin/bonus/matches', {
                method: 'POST',
                body: {
                    team1Name: form.team1Name.trim(),
                    team1Flag: form.team1Flag.trim() || '🏳️',
                    team2Name: form.team2Name.trim(),
                    team2Flag: form.team2Flag.trim() || '🏳️',
                    closesAt: new Date(form.closesAt).toISOString(),
                    openImmediately: form.openImmediately
                }
            });
            setForm({
                team1Name: '',
                team1Flag: '🏳️',
                team2Name: '',
                team2Flag: '🏳️',
                closesAt: defaultClosesAtLocal(),
                openImmediately: true
            });
            await load();
        } catch (err) {
            console.error('Create match failed:', err);
            alert(err?.message?.includes('INVALID') ? 'Invalid close time.' : 'Could not create match. Please try again.');
        } finally {
            setBusyId(null);
        }
    };

    const runAction = async (id, action, body) => {
        try {
            setBusyId(`${action}-${id}`);
            const path =
                action === 'open'
                    ? `/admin/bonus/matches/${id}/open`
                    : action === 'lock'
                        ? `/admin/bonus/matches/${id}/lock`
                        : `/admin/bonus/matches/${id}/settle`;
            await apiFetch(path, {
                method: action === 'settle' ? 'POST' : 'PATCH',
                body
            });
            await load();
        } catch (err) {
            console.error(`Bonus ${action} failed:`, err);
            alert(`${action} failed. Check match status and try again.`);
        } finally {
            setBusyId(null);
        }
    };

    const sortedMatches = useMemo(
        () => [...matches].sort((a, b) => new Date(b.settledAt || b.closesAt || 0) - new Date(a.settledAt || a.closesAt || 0)),
        [matches]
    );

    return (
        <div className="admin-container admin-home-container">
            <div className="admin-card">
                <h2 className="admin-title">⚽ BestBingo Bonus</h2>
                <p className="admin-subtitle">Create World Cup score predictions — 10 ETB entry, 80% pool split on exact score. Multiple matches can be open at the same time.</p>

                <form onSubmit={createMatch} className="admin-form">
                    <div className="admin-form-row">
                        <div className="admin-form-group">
                            <label className="admin-label">Team 1</label>
                            <input
                                className="admin-input"
                                value={form.team1Name}
                                onChange={(e) => setForm({ ...form, team1Name: e.target.value })}
                                placeholder="Spain"
                            />
                        </div>
                        <div className="admin-form-group admin-form-group-narrow">
                            <label className="admin-label">Flag</label>
                            <input
                                className="admin-input"
                                value={form.team1Flag}
                                onChange={(e) => setForm({ ...form, team1Flag: e.target.value })}
                                placeholder="🇪🇸"
                            />
                        </div>
                    </div>
                    <div className="admin-form-row">
                        <div className="admin-form-group">
                            <label className="admin-label">Team 2</label>
                            <input
                                className="admin-input"
                                value={form.team2Name}
                                onChange={(e) => setForm({ ...form, team2Name: e.target.value })}
                                placeholder="Argentina"
                            />
                        </div>
                        <div className="admin-form-group admin-form-group-narrow">
                            <label className="admin-label">Flag</label>
                            <input
                                className="admin-input"
                                value={form.team2Flag}
                                onChange={(e) => setForm({ ...form, team2Flag: e.target.value })}
                                placeholder="🇦🇷"
                            />
                        </div>
                    </div>
                    <div className="admin-form-group">
                        <label className="admin-label">Predictions close at</label>
                        <input
                            type="datetime-local"
                            className="admin-input"
                            value={form.closesAt}
                            onChange={(e) => setForm({ ...form, closesAt: e.target.value })}
                        />
                    </div>
                    <label className="admin-checkbox-row">
                        <input
                            type="checkbox"
                            checked={form.openImmediately}
                            onChange={(e) => setForm({ ...form, openImmediately: e.target.checked })}
                        />
                        Open for predictions immediately
                    </label>
                    <button type="submit" className="admin-create-match-btn" disabled={busyId === 'create'}>
                        <span className="admin-create-match-btn-icon" aria-hidden="true">⚽</span>
                        <span>{busyId === 'create' ? 'Creating match…' : 'Create match'}</span>
                    </button>
                </form>
            </div>

            <div className="admin-posts-section">
                <h3 className="admin-section-title">
                    <span>📋</span>
                    Matches
                </h3>
                {loading ? (
                    <div className="admin-empty-state">
                        <div className="admin-empty-title">Loading…</div>
                    </div>
                ) : sortedMatches.length === 0 ? (
                    <div className="admin-empty-state">
                        <div className="admin-empty-icon">⚽</div>
                        <div className="admin-empty-title">No matches yet</div>
                    </div>
                ) : (
                    <div className="admin-posts-list">
                        {sortedMatches.map((m) => {
                            const settle = settleScores[m.id] || { s1: 0, s2: 0 };
                            return (
                                <div key={m.id} className="admin-post-card">
                                    <div className="admin-post-header">
                                        <div className="admin-post-type">
                                            {m.team1Flag} {m.team1Name} vs {m.team2Name} {m.team2Flag}
                                        </div>
                                        <span className={`admin-status-badge admin-status-${m.status}`}>
                                            {matchStatusLabel(m.status)}
                                        </span>
                                    </div>
                                    <div className="admin-post-caption">
                                        Entries: {m.entryCount ?? 0} · Collected: {m.totalCollected ?? 0} ETB
                                        {m.status === 'settled' && (
                                            <> · Score {m.finalScore1}-{m.finalScore2} · Winners {m.winnerCount} · +{m.payoutEach} ETB</>
                                        )}
                                    </div>
                                    <div className="admin-post-actions admin-bonus-actions">
                                        {m.status === 'draft' && (
                                            <button
                                                type="button"
                                                className="admin-action-btn admin-action-btn--primary admin-btn-sm"
                                                disabled={!!busyId}
                                                onClick={() => runAction(m.id, 'open')}
                                            >
                                                Open
                                            </button>
                                        )}
                                        {m.status === 'open' && (
                                            <button
                                                type="button"
                                                className="admin-delete-button admin-btn-sm"
                                                disabled={!!busyId}
                                                onClick={() => runAction(m.id, 'lock')}
                                            >
                                                ዝግ
                                            </button>
                                        )}
                                        {(m.status === 'locked' || m.status === 'open') && (
                                            <div className="admin-bonus-settle">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={30}
                                                    className="admin-input admin-score-input"
                                                    value={settle.s1}
                                                    onChange={(e) =>
                                                        setSettleScores({
                                                            ...settleScores,
                                                            [m.id]: { ...settle, s1: Number(e.target.value) }
                                                        })
                                                    }
                                                />
                                                <span>-</span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={30}
                                                    className="admin-input admin-score-input"
                                                    value={settle.s2}
                                                    onChange={(e) =>
                                                        setSettleScores({
                                                            ...settleScores,
                                                            [m.id]: { ...settle, s2: Number(e.target.value) }
                                                        })
                                                    }
                                                />
                                                <button
                                                    type="button"
                                                    className="admin-action-btn admin-action-btn--primary admin-action-btn--settle admin-btn-sm"
                                                    disabled={!!busyId}
                                                    onClick={() =>
                                                        runAction(m.id, 'settle', {
                                                            finalScore1: settle.s1,
                                                            finalScore2: settle.s2
                                                        })
                                                    }
                                                >
                                                    የጨዋታ ውጤት
                                                </button>
                                            </div>
                                        )}
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
