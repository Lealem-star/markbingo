import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth/AuthProvider';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../lib/api/client';

const ENTRY_FEE = 10;

function ScoreStepper({ label, value, onChange, disabled }) {
    const dec = () => onChange(Math.max(0, value - 1));
    const inc = () => onChange(Math.min(15, value + 1));

    return (
        <div className="bonus-score-stepper">
            <span className="bonus-score-label">{label}</span>
            <div className="bonus-score-controls">
                <button type="button" className="bonus-score-btn" onClick={dec} disabled={disabled || value <= 0}>−</button>
                <span className="bonus-score-value">{value}</span>
                <button type="button" className="bonus-score-btn" onClick={inc} disabled={disabled || value >= 15}>+</button>
            </div>
        </div>
    );
}

function HistoryCard({ item }) {
    return (
        <article className="bonus-history-card">
            <div className="bonus-history-card-top">
                <span className="bonus-history-status">🎉 Match Concluded</span>
                <span className="bonus-history-pool">Pool: {item.prizePool?.toLocaleString()} ETB</span>
            </div>
            <div className="bonus-history-matchup">
                <span className="bonus-history-team">{item.team1Flag} {item.team1Name}</span>
                <span className="bonus-history-score">{item.finalScore1} - {item.finalScore2}</span>
                <span className="bonus-history-team bonus-history-team-right">{item.team2Name} {item.team2Flag}</span>
            </div>
            <div className="bonus-history-card-bottom">
                <span>Winners: {item.winnerCount ?? 0}</span>
                {item.winnerCount > 0 ? (
                    <span className="bonus-history-payout">Payout: +{item.payoutEach} ETB each</span>
                ) : (
                    <span className="bonus-history-no-winners">No exact-score winners</span>
                )}
            </div>
        </article>
    );
}

function ActiveMatchCard({ match, sessionId, onUpdated, showSuccess, showError }) {
    const [score1, setScore1] = useState(0);
    const [score2, setScore2] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    const canPredict =
        match?.status === 'open' &&
        !match?.userPrediction &&
        new Date(match.closesAt) > new Date();

    const closesAtLabel = match?.closesAt
        ? new Date(match.closesAt).toLocaleString()
        : '';

    const handlePredict = async () => {
        if (!match?.id || submitting) return;
        try {
            setSubmitting(true);
            const result = await apiFetch('/bonus/predict', {
                method: 'POST',
                sessionId,
                body: {
                    matchId: match.id,
                    score1,
                    score2
                }
            });
            onUpdated?.(result.match);
            showSuccess(`Prediction locked: ${score1} - ${score2}`);
        } catch (err) {
            const msg = String(err?.message || '');
            if (msg.includes('402')) {
                showError('Insufficient balance. You need 10 ETB to predict.');
            } else if (msg.includes('409')) {
                showError('You already submitted a prediction for this match.');
            } else if (msg.includes('400')) {
                showError('Predictions are closed for this match.');
            } else {
                showError('Failed to submit prediction. Please try again.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="bonus-active-card">
            <div className="bonus-active-teams">
                <span>{match.team1Flag} {match.team1Name}</span>
                <span className="bonus-vs">VS</span>
                <span>{match.team2Name} {match.team2Flag}</span>
            </div>

            <div className="bonus-active-meta">
                <span>Entry: {match.entryFee || ENTRY_FEE} ETB</span>
                <span>Pool: {match.livePrizePool?.toLocaleString()} ETB</span>
                <span>{match.entryCount || 0} predictions</span>
                {match.status === 'locked' && <span className="bonus-status-locked">Locked</span>}
            </div>

            {match.userPrediction ? (
                <div className="bonus-prediction-locked">
                    <p className="bonus-prediction-title">Your prediction</p>
                    <p className="bonus-prediction-score">
                        {match.userPrediction.predictedScore1} - {match.userPrediction.predictedScore2}
                    </p>
                    <p className="bonus-prediction-note">Locked — good luck!</p>
                </div>
            ) : canPredict ? (
                <div className="bonus-predict-form">
                    <p className="bonus-predict-prompt">Predict the exact final score</p>
                    <div className="bonus-score-row">
                        <ScoreStepper label={match.team1Name} value={score1} onChange={setScore1} disabled={submitting} />
                        <span className="bonus-score-dash">-</span>
                        <ScoreStepper label={match.team2Name} value={score2} onChange={setScore2} disabled={submitting} />
                    </div>
                    <p className="bonus-closes-at">Closes: {closesAtLabel}</p>
                    <button
                        type="button"
                        className="bonus-submit-btn"
                        onClick={handlePredict}
                        disabled={submitting}
                    >
                        {submitting ? 'Submitting...' : `Predict & Pay ${ENTRY_FEE} ETB`}
                    </button>
                </div>
            ) : (
                <div className="bonus-locked-msg">
                    {match.status === 'locked'
                        ? 'Predictions closed — waiting for final score.'
                        : 'Prediction window has ended.'}
                </div>
            )}
        </div>
    );
}

export default function Bonus({ onNavigate }) {
    const { sessionId } = useAuth();
    const { showSuccess, showError } = useToast();
    const [loading, setLoading] = useState(true);
    const [activeMatches, setActiveMatches] = useState([]);
    const [history, setHistory] = useState([]);

    const loadData = useCallback(async () => {
        if (!sessionId) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const [activeData, historyData] = await Promise.all([
                apiFetch('/bonus/active', { sessionId }),
                apiFetch('/bonus/history', { sessionId })
            ]);
            const matches = activeData?.matches || (activeData?.match ? [activeData.match] : []);
            setActiveMatches(Array.isArray(matches) ? matches : []);
            setHistory(historyData?.history || []);
        } catch (err) {
            console.error('Failed to load bonus data:', err);
            showError('Could not load BestBingo Bonus.');
        } finally {
            setLoading(false);
        }
    }, [sessionId, showError]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleMatchUpdated = useCallback((updatedMatch) => {
        if (!updatedMatch?.id) return;
        setActiveMatches((prev) =>
            prev.map((m) => (m.id === updatedMatch.id ? updatedMatch : m))
        );
    }, []);

    return (
        <div className="bonus-page">
            <header className="bonus-header">
                <div className="bonus-logo">
                    <span className="bonus-logo-icon">⚽</span>
                    <span className="bonus-logo-text">
                        <span className="bonus-logo-good">Good</span>Bingo Bonus
                    </span>
                </div>
                <div className="bonus-header-actions">
                    <button
                        type="button"
                        className="bonus-back-btn"
                        onClick={() => onNavigate?.('game', true)}
                    >
                        🏠 BACK TO BINGO
                    </button>
                    <button
                        type="button"
                        className="bonus-back-btn"
                        onClick={() => loadData()}
                    >
                        ↻ REFRESH
                    </button>
                </div>
            </header>

            <main className="bonus-main">
                {loading ? (
                    <div className="bonus-loading">Loading...</div>
                ) : (
                    <>
                        <section className="bonus-active-section">
                            {activeMatches.length > 0 ? (
                                <div className="bonus-active-list">
                                    {activeMatches.map((match) => (
                                        <ActiveMatchCard
                                            key={match.id}
                                            match={match}
                                            sessionId={sessionId}
                                            onUpdated={handleMatchUpdated}
                                            showSuccess={showSuccess}
                                            showError={showError}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="bonus-empty-card">
                                    <div className="bonus-empty-icon">💤</div>
                                    <h2 className="bonus-empty-title">No Active Matches</h2>
                                    <p className="bonus-empty-text">
                                        The host hasn&apos;t scheduled a World Cup prediction game yet. Keep checking!
                                    </p>
                                </div>
                            )}
                        </section>

                        <section className="bonus-history-section">
                            <h2 className="bonus-history-heading">📜 MATCH PREDICTION HISTORY</h2>
                            <div className="bonus-history-list">
                                {history.length === 0 ? (
                                    <p className="bonus-history-empty">No concluded matches yet.</p>
                                ) : (
                                    history.map((item) => (
                                        <HistoryCard key={item.id} item={item} />
                                    ))
                                )}
                            </div>
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}
