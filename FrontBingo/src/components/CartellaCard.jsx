import React from 'react';

// Helper: cell is marked if free (0) or its number was called (number/string tolerant).
function cellIsMarked(num, calledNums) {
    const n = Number(num);
    if (n === 0) return true;
    return calledNums.has(n);
}

function cellsToKeySet(cells) {
    const s = new Set();
    cells.forEach((c) => s.add(`${c.row}-${c.col}`));
    return s;
}

/** True if any non-free cell in this pattern equals the last called number. */
function patternIncludesLastCall(card, patternKeys, lastCallNum) {
    if (!Number.isInteger(lastCallNum)) return false;
    for (const key of patternKeys) {
        const [r, c] = key.split('-').map(Number);
        const v = Number(card[r][c]);
        if (v !== 0 && v === lastCallNum) return true;
    }
    return false;
}

// Collect all valid winning patterns, then prefer one that includes the latest draw
// so the winner screen matches "the call that made BINGO" (not an older completed line).
function detectWinningPattern(card, called) {
    if (!card || !called || called.length === 0) return new Set();

    const calledNums = new Set(called.map((x) => Number(x)));
    const lastCallNum = Number(called[called.length - 1]);

    const candidates = [];

    // Rows
    for (let row = 0; row < 5; row++) {
        let allCalled = true;
        const rowCells = [];
        for (let col = 0; col < 5; col++) {
            const num = card[row][col];
            if (!cellIsMarked(num, calledNums)) {
                allCalled = false;
                break;
            }
            rowCells.push({ row, col });
        }
        if (allCalled) candidates.push(cellsToKeySet(rowCells));
    }

    // Columns
    for (let col = 0; col < 5; col++) {
        let allCalled = true;
        const colCells = [];
        for (let row = 0; row < 5; row++) {
            const num = card[row][col];
            if (!cellIsMarked(num, calledNums)) {
                allCalled = false;
                break;
            }
            colCells.push({ row, col });
        }
        if (allCalled) candidates.push(cellsToKeySet(colCells));
    }

    // Main diagonal
    let mainDiagAllCalled = true;
    const mainDiagCells = [];
    for (let i = 0; i < 5; i++) {
        const num = card[i][i];
        if (!cellIsMarked(num, calledNums)) {
            mainDiagAllCalled = false;
            break;
        }
        mainDiagCells.push({ row: i, col: i });
    }
    if (mainDiagAllCalled) candidates.push(cellsToKeySet(mainDiagCells));

    // Anti-diagonal
    let antiDiagAllCalled = true;
    const antiDiagCells = [];
    for (let i = 0; i < 5; i++) {
        const num = card[i][4 - i];
        if (!cellIsMarked(num, calledNums)) {
            antiDiagAllCalled = false;
            break;
        }
        antiDiagCells.push({ row: i, col: 4 - i });
    }
    if (antiDiagAllCalled) candidates.push(cellsToKeySet(antiDiagCells));

    // Four corners
    const corners = [
        { row: 0, col: 0 },
        { row: 0, col: 4 },
        { row: 4, col: 0 },
        { row: 4, col: 4 }
    ];
    let allCornersCalled = true;
    for (const corner of corners) {
        const num = card[corner.row][corner.col];
        if (!cellIsMarked(num, calledNums)) {
            allCornersCalled = false;
            break;
        }
    }
    if (allCornersCalled) candidates.push(cellsToKeySet(corners));

    if (candidates.length === 0) return new Set();

    const withLast = candidates.find((keys) => patternIncludesLastCall(card, keys, lastCallNum));
    return withLast || candidates[0];
}

export default function CartellaCard({ 
    id, 
    card, 
    called = [], 
    selectedNumber = null, 
    isPreview = false, 
    showWinningPattern = false,
    /** When set, cells in the winning pattern at this call snapshot are shown in red (missed BINGO window). */
    missedWinningCalledNumbers = null,
    onNumberToggle = null,
    showHeader = false
}) {
    // Use card prop if provided, otherwise fallback to null
    const grid = card || null;
    if (!grid) return <div className="text-xs opacity-60">Loading...</div>;

    const letters = ['B', 'I', 'N', 'G', 'O'];
    const letterColors = ['cartela-letter-b', 'cartela-letter-i', 'cartela-letter-n', 'cartela-letter-g', 'cartela-letter-o'];
    
    // Detect winning pattern if needed
    const winningPattern = showWinningPattern ? detectWinningPattern(grid, called) : new Set();
    const missedWinPattern =
        Array.isArray(missedWinningCalledNumbers)
            ? detectWinningPattern(grid, missedWinningCalledNumbers)
            : new Set();

    // Mark a cell only if that cell's number was actually drawn (1–75). Free center (0) is never "drawn".
    const rawDrawn = Array.isArray(called) ? called : [];
    const drawnSet = new Set(
        rawDrawn
            .map((x) => Number(x))
            .filter((x) => Number.isInteger(x) && x >= 1 && x <= 75)
    );

    // Handle cell click for manual marking
    const handleCellClick = (number) => {
        if (onNumberToggle && number !== 0) {
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
                                const n = Number(number);
                                const isFree = n === 0;
                                const isCalled = !isFree && drawnSet.has(n);
                                const isSelected = selectedNumber && number === selectedNumber;
                                const isWinningCell = winningPattern.has(`${rowIndex}-${colIndex}`);
                                const isMissedWinCell = missedWinPattern.has(`${rowIndex}-${colIndex}`);

                                // Priority: missed winning (red) > winning pattern > selected > called > normal
                                let cellClass = 'cartela-normal';
                                if (isFree) {
                                    cellClass = 'cartela-free';
                                    if (isMissedWinCell) {
                                        cellClass += ' cartela-missed-winning';
                                    } else if (isWinningCell) {
                                        cellClass += ' cartela-winning';
                                    }
                                } else if (isMissedWinCell) {
                                    cellClass = 'cartela-missed-winning';
                                } else if (isWinningCell) {
                                    cellClass = 'cartela-winning';
                                } else if (isSelected) {
                                    cellClass = 'cartela-selected';
                                } else if (isCalled) {
                                    // Winner screen: drawn but not part of the winning line → yellow; in-game → green
                                    cellClass =
                                        showWinningPattern ? 'cartela-called-secondary' : 'cartela-called';
                                }

                                const isClickable = onNumberToggle && !isFree;
                                
                                return (
                                    <div
                                        key={`${rowIndex}-${colIndex}`}
                                        className={`cartela-cell ${cellClass} ${isClickable ? 'cartela-clickable' : ''}`}
                                        onClick={() => handleCellClick(number)}
                                        style={isClickable ? { cursor: 'pointer' } : {}}
                                        title={isClickable ? 'Click to mark/unmark' : ''}
                                    >
                                        {isFree ? (
                                            <span className="cartela-star" aria-label="Free">⭐</span>
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
