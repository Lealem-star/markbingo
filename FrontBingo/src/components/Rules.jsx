import React, { useState } from 'react';
import BottomNav from './BottomNav';

export default function Rules({ onNavigate }) {
    const [activeTab, setActiveTab] = useState('cards');

    const renderTabContent = () => {
        switch (activeTab) {
            case 'cards':
                return (
                    <>
                        <h3 className="section-title">Registration Guide</h3>
                        <section className="step-card">
                            <div className="step-badge green">1</div>
                            <div>
                                <div className="step-title">Choose Your Card</div>
                                <p className="step-text">Pick any available card from 1-100 during registration.</p>
                            </div>
                        </section>
                        <section className="step-card">
                            <div className="step-badge red">2</div>
                            <div>
                                <div className="step-title">Card Status Indicator</div>
                                <p className="step-text">Unavailable cards are marked in red. Select only green cards.</p>
                            </div>
                        </section>
                        <section className="step-card">
                            <div className="step-badge blue">3</div>
                            <div>
                                <div className="step-title">Card Preview</div>
                                <p className="step-text">Preview the numbers on your card before confirming.</p>
                            </div>
                        </section>
                        <section className="tip-card">
                            <div className="tip-title">Card Selection Tips</div>
                            <ul className="tips">
                                <li>Choose cards that are not marked in red</li>
                                <li>Preview your card before confirming</li>
                                <li>Select quickly before registration time ends</li>
                            </ul>
                        </section>
                        <section className="panel">
                            <div className="panel-title">Registration Timer</div>
                            <p className="panel-text">Registration lasts a short time. Be ready to choose and confirm your card before the timer runs out.</p>
                        </section>
                    </>
                );
            case 'play':
                return (
                    <>
                        <div className="play-center">
                            <div className="play-button-large">
                                <div className="play-icon-large">▶</div>
                            </div>
                            <h3 className="play-title">Play</h3>
                        </div>

                        <section className="step-card">
                            <div className="step-badge green">1</div>
                            <div>
                                <div className="step-title">Game Entry</div>
                                <p className="step-text">When we enter the game, we get a playing card based on the card number we selected.</p>
                            </div>
                        </section>

                        <section className="step-card">
                            <div className="step-badge orange">2</div>
                            <div>
                                <div className="step-title">Game Timer</div>
                                <p className="step-text">The game starts counting down the remaining seconds at the top right.</p>
                            </div>
                        </section>

                        <section className="step-card">
                            <div className="step-badge green">3</div>
                            <div>
                                <div className="step-title">Number Calling</div>
                                <p className="step-text">When the game starts, it begins calling out different numbers from 1 to 75.</p>
                            </div>
                        </section>

                        <section className="step-card">
                            <div className="step-badge blue">4</div>
                            <div>
                                <div className="step-title">Marking Numbers</div>
                                <p className="step-text">If the called number is inside our playing card, we can select it by clicking on the called number.</p>
                            </div>
                        </section>

                        <section className="step-card">
                            <div className="step-badge yellow">5</div>
                            <div>
                                <div className="step-title">Unmarking Numbers</div>
                                <p className="step-text">If we want to erase the number we selected, we can erase it by clicking on the number itself again.</p>
                            </div>
                        </section>

                        <section className="mechanics-card">
                            <div className="mechanics-header">
                                <div className="mechanics-icon">⊞</div>
                                <div className="mechanics-title">Game Mechanics</div>
                            </div>
                            <div className="mechanics-grid">
                                <div className="mechanics-item">
                                    <div className="mechanics-item-title">Number Range</div>
                                    <div className="mechanics-item-text">Numbers called are from 1 to 75</div>
                                </div>
                                <div className="mechanics-item">
                                    <div className="mechanics-item-title">Marking</div>
                                    <div className="mechanics-item-text">Click to mark/unmark numbers</div>
                                </div>
                                <div className="mechanics-item">
                                    <div className="mechanics-item-title">Card Layout</div>
                                    <div className="mechanics-item-text">5x5 grid with center FREE space</div>
                                </div>
                                <div className="mechanics-item">
                                    <div className="mechanics-item-title">Timer</div>
                                    <div className="mechanics-item-text">Countdown shows game start time</div>
                                </div>
                            </div>
                        </section>
                    </>
                );
            case 'prizes':
                return (
                    <>
                        <div className="prizes-center">
                            <div className="trophy-icon-large">
                                <div className="trophy-symbol">🏆</div>
                            </div>
                            <h3 className="prizes-title">Prizes</h3>
                        </div>

                        <section className="winning-rule-card">
                            <div className="winning-rule-header">
                                <div className="star-icon">⭐</div>
                                <div className="winning-rule-title">Main Winning Rule</div>
                            </div>
                            <p className="winning-rule-text">
                                When numbers are called, by selecting from our playing card either horizontally, vertically, diagonally, or all four corners, we can immediately win by pressing the <span className="bingo-highlight">bingo</span> button at the bottom.
                            </p>
                        </section>

                        <section className="prize-category-card">
                            <div className="prize-category-header">
                                <div className="prize-icon">→</div>
                                <div className="prize-category-title">Horizontal</div>
                            </div>
                            <p className="prize-category-text">Completing any horizontal row (5 numbers in a line)</p>
                        </section>

                        <section className="prize-category-card">
                            <div className="prize-category-header">
                                <div className="prize-icon">↓</div>
                                <div className="prize-category-title">Vertical</div>
                            </div>
                            <p className="prize-category-text">Completing any vertical column (5 numbers in a line)</p>
                        </section>

                        <section className="prize-category-card">
                            <div className="prize-category-header">
                                <div className="prize-icon">↘</div>
                                <div className="prize-category-title">Diagonal</div>
                            </div>
                            <p className="prize-category-text">Completing any diagonal line (5 numbers in a line)</p>
                        </section>

                        <section className="multiple-winners-card">
                            <div className="multiple-winners-header">
                                <div className="multiple-icon">👥</div>
                                <div className="multiple-winners-title">Multiple Winners</div>
                            </div>
                            <p className="multiple-winners-text">If two or more players win equally, the prize will be shared among them.</p>
                        </section>

                        <section className="prize-category-card">
                            <div className="prize-category-header">
                                <div className="prize-icon">▶</div>
                                <div className="prize-category-title">Four Corners</div>
                            </div>
                            <p className="prize-category-text">Marking the four corner numbers of the card</p>
                        </section>

                        <section className="prize-category-card">
                            <div className="prize-category-header">
                                <div className="prize-icon">▶</div>
                                <div className="prize-category-title">One Line</div>
                            </div>
                            <p className="prize-category-text">Marking one line of numbers on the card</p>
                        </section>
                    </>
                );
            case 'fair':
                return (
                    <>
                        <div className="fair-center">
                            <div className="fair-icon-large">
                                <div className="fair-symbol">🚫</div>
                            </div>
                            <h3 className="fair-title">Fair</h3>
                        </div>

                        <section className="penalty-card">
                            <div className="penalty-header">
                                <div className="penalty-alert">⚠</div>
                                <div className="penalty-title">False BINGO Penalty</div>
                            </div>
                            <div className="penalty-section-title">Rule Violation</div>
                            <p className="penalty-text">Claiming BINGO without a valid winning pattern is considered a violation and may result in penalties.</p>

                            <div className="consequences">
                                <div className="consequences-title">Consequences:</div>
                                <ul>
                                    <li>🚫 Immediate removal from current game</li>
                                    <li>💲 Loss of entry fee/stake</li>
                                    <li>⏱ Temporary ban from joining new games</li>
                                </ul>
                            </div>
                        </section>

                        <section className="valid-card">
                            <div className="valid-title">✔ Valid BINGO Conditions</div>
                            <ul>
                                <li>Complete horizontal line (5 numbers)</li>
                                <li>Complete vertical line (5 numbers)</li>
                                <li>Complete diagonal line (5 numbers)</li>
                                <li>All four corners marked</li>
                            </ul>
                        </section>

                        <section className="invalid-card">
                            <div className="invalid-title">🚫 Invalid BINGO Attempts</div>
                            <ul>
                                <li>Incomplete lines or patterns</li>
                                <li>Random marked numbers</li>
                                <li>Premature BINGO calls</li>
                                <li>False pattern claims</li>
                            </ul>
                        </section>

                        <section className="tips-card-blue">
                            <div className="tips-blue-title">✨ Pro Tips to Avoid Penalties</div>
                            <ul>
                                <li>Double-check your pattern before clicking BINGO</li>
                                <li>Make sure you have exactly 5 numbers in a line</li>
                                <li>Verify all four corners are marked for corner wins</li>
                                <li>Take your time — there's no rush to call BINGO</li>
                                <li>If unsure, wait for more numbers to be called</li>
                            </ul>
                        </section>
                    </>
                );
            default:
                return null;
        }
    };

    return (
        <div className="app-container">
            <header className="p-4">
                <div className="rules-header">
                    <button type="button" className="back-button" onClick={() => onNavigate?.('game')}>
                        ← Back
                    </button>
                    <h2 className="rules-title">Game Rules</h2>
                </div>
            </header>

            <main className="p-4 space-y-4">
                <section className="panel">
                    <div className="tabbar">
                        <div
                            className={`tab ${activeTab === 'cards' ? 'active' : ''}`}
                            onClick={() => setActiveTab('cards')}
                        >
                            Cards
                        </div>
                        <div
                            className={`tab ${activeTab === 'play' ? 'active' : ''}`}
                            onClick={() => setActiveTab('play')}
                        >
                            Play
                        </div>
                        <div
                            className={`tab ${activeTab === 'prizes' ? 'active' : ''}`}
                            onClick={() => setActiveTab('prizes')}
                        >
                            Prizes
                        </div>
                        <div
                            className={`tab ${activeTab === 'fair' ? 'active' : ''}`}
                            onClick={() => setActiveTab('fair')}
                        >
                            Fair
                        </div>
                    </div>

                    <div className="progress-wrap">
                        <div className="progress" style={{ width: activeTab === 'cards' ? '25%' : activeTab === 'play' ? '50%' : activeTab === 'prizes' ? '75%' : '100%' }} />
                    </div>
                </section>

                {renderTabContent()}
            </main>
            <BottomNav current="game" onNavigate={onNavigate} />
        </div>
    );
}


