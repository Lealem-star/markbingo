import React from 'react';

// Helper function to detect winning pattern
function detectWinningPattern(card, called) {
    if (!card || !called || called.length === 0) return new Set();
    
    const winningCells = new Set();
    const calledSet = new Set(called);
    
    // Check rows
    for (let row = 0; row < 5; row++) {
        let allCalled = true;
        const rowCells = [];
        for (let col = 0; col < 5; col++) {
            const num = card[row][col];
            const isFree = num === 0;
            const isCalled = isFree || calledSet.has(num);
            if (!isCalled) {
                allCalled = false;
                break;
            }
            rowCells.push({ row, col });
        }
        if (allCalled) {
            rowCells.forEach(cell => winningCells.add(`${cell.row}-${cell.col}`));
        }
    }
    
    // Check columns
    for (let col = 0; col < 5; col++) {
        let allCalled = true;
        const colCells = [];
        for (let row = 0; row < 5; row++) {
            const num = card[row][col];
            const isFree = num === 0;
            const isCalled = isFree || calledSet.has(num);
            if (!isCalled) {
                allCalled = false;
                break;
            }
            colCells.push({ row, col });
        }
        if (allCalled) {
            colCells.forEach(cell => winningCells.add(`${cell.row}-${cell.col}`));
        }
    }
    
    // Check main diagonal (top-left to bottom-right)
    let mainDiagAllCalled = true;
    const mainDiagCells = [];
    for (let i = 0; i < 5; i++) {
        const num = card[i][i];
        const isFree = num === 0;
        const isCalled = isFree || calledSet.has(num);
        if (!isCalled) {
            mainDiagAllCalled = false;
            break;
        }
        mainDiagCells.push({ row: i, col: i });
    }
    if (mainDiagAllCalled) {
        mainDiagCells.forEach(cell => winningCells.add(`${cell.row}-${cell.col}`));
    }
    
    // Check anti-diagonal (top-right to bottom-left)
    let antiDiagAllCalled = true;
    const antiDiagCells = [];
    for (let i = 0; i < 5; i++) {
        const num = card[i][4 - i];
        const isFree = num === 0;
        const isCalled = isFree || calledSet.has(num);
        if (!isCalled) {
            antiDiagAllCalled = false;
            break;
        }
        antiDiagCells.push({ row: i, col: 4 - i });
    }
    if (antiDiagAllCalled) {
        antiDiagCells.forEach(cell => winningCells.add(`${cell.row}-${cell.col}`));
    }
    
    // Check four corners
    const corners = [
        { row: 0, col: 0 }, // top-left
        { row: 0, col: 4 }, // top-right
        { row: 4, col: 0 }, // bottom-left
        { row: 4, col: 4 }  // bottom-right
    ];
    let allCornersCalled = true;
    for (const corner of corners) {
        const num = card[corner.row][corner.col];
        const isFree = num === 0;
        const isCalled = isFree || calledSet.has(num);
        if (!isCalled) {
            allCornersCalled = false;
            break;
        }
    }
    if (allCornersCalled) {
        corners.forEach(corner => winningCells.add(`${corner.row}-${corner.col}`));
    }
    
    return winningCells;
}

export default function CartellaCard({ 
    id, 
    card, 
    called = [], 
    selectedNumber = null, 
    isPreview = false, 
    showWinningPattern = false,
    isAutoMarkOn = true,
    onNumberToggle = null,
    showHeader = false
}) {
    // Use card prop if provided, otherwise fallback to null
    const grid = card || null;
    if (!grid) return <div className="text-xs opacity-60">Loading...</div>;

    const letters = ['B', 'I', 'N', 'G', 'O'];
    const letterColors = ['bg-yellow-500', 'bg-green-500', 'bg-purple-500', 'bg-red-500', 'bg-pink-500'];
    
    // Detect winning pattern if needed
    const winningPattern = showWinningPattern ? detectWinningPattern(grid, called) : new Set();
    
    // Handle cell click for manual marking
    const handleCellClick = (number) => {
        if (!isAutoMarkOn && onNumberToggle && number !== 0) {
            onNumberToggle(number);
        }
    };

    return (
        <div className={`cartela-card ${isPreview ? 'cartela-preview' : 'cartela-full'}`}>

            <div className="cartela-grid">
                {/* BINGO Header (only when explicitly enabled, e.g. in GameLayout) */}
                {showHeader && (
                    <div className="cartela-letters">
                        {letters.map((letter, index) => (
                            <div key={letter} className={`cartela-letter ${letterColors[index]}`}>
                                {letter}
                            </div>
                        ))}
                    </div>
                )}

                {/* Numbers Grid */}
                <div className="cartela-numbers">
                    {grid.map((row, rowIndex) => (
                        <div key={rowIndex} className="cartela-row">
                            {row.map((number, colIndex) => {
                                const isFree = number === 0;
                                const isCalled = called.includes(number);
                                const isSelected = selectedNumber && number === selectedNumber;
                                const isWinningCell = winningPattern.has(`${rowIndex}-${colIndex}`);
                                
                                // Priority: winning pattern > selected > called > normal
                                let cellClass = 'cartela-normal';
                                if (isFree) {
                                    cellClass = 'cartela-free';
                                    if (isWinningCell) {
                                        cellClass += ' cartela-winning';
                                    }
                                } else if (isWinningCell) {
                                    cellClass = 'cartela-winning';
                                } else if (isSelected) {
                                    cellClass = 'cartela-selected';
                                } else if (isCalled) {
                                    cellClass = 'cartela-called';
                                }

                                // Make cell clickable if auto-mark is OFF and it's not a free space
                                const isClickable = !isAutoMarkOn && onNumberToggle && !isFree;
                                
                                return (
                                    <div
                                        key={`${rowIndex}-${colIndex}`}
                                        className={`cartela-cell ${cellClass} ${isClickable ? 'cartela-clickable' : ''}`}
                                        onClick={() => handleCellClick(number)}
                                        style={isClickable ? { cursor: 'pointer' } : {}}
                                        title={isClickable ? 'Click to mark/unmark' : ''}
                                    >
                                        {isFree ? (
                                            <span className="cartela-star">🇪🇹</span>
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
