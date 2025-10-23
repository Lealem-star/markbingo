import React from 'react';

export default function CartellaCard({ id, card, called = [], selectedNumber = null, isPreview = false }) {
    // Use card prop if provided, otherwise fallback to null
    const grid = card || null;
    if (!grid) return <div className="text-xs opacity-60">Loading...</div>;

    const letters = ['B', 'I', 'N', 'G', 'O'];
    const letterColors = ['bg-blue-600', 'bg-purple-600', 'bg-green-600', 'bg-orange-600', 'bg-red-600'];

    return (
        <div className={`cartela-card ${isPreview ? 'cartela-preview' : 'cartela-full'}`}>
            <div className="cartela-header">
                <span className="cartela-title">Cartela No: {id}</span>
            </div>

            <div className="cartela-grid">
                {/* BINGO Header */}
                <div className="cartela-letters">
                    {letters.map((letter, index) => (
                        <div key={letter} className={`cartela-letter ${letterColors[index]}`}>
                            {letter}
                        </div>
                    ))}
                </div>

                {/* Numbers Grid */}
                <div className="cartela-numbers">
                    {grid.map((row, rowIndex) => (
                        <div key={rowIndex} className="cartela-row">
                            {row.map((number, colIndex) => {
                                const isFree = number === 0;
                                const isCalled = called.includes(number);
                                const isSelected = selectedNumber && number === selectedNumber;

                                return (
                                    <div
                                        key={`${rowIndex}-${colIndex}`}
                                        className={`cartela-cell ${isFree ? 'cartela-free' :
                                            isSelected ? 'cartela-selected' :
                                                isCalled ? 'cartela-called' : 'cartela-normal'
                                            }`}
                                    >
                                        {isFree ? (
                                            <span className="cartela-star">★</span>
                                        ) : (
                                            <span className="cartela-number">{number}</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
