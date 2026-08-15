const fs = require('fs');
const path = require('path');

const TARGET_COUNT = 1200;
const RANGES = [
    [1, 15],
    [16, 30],
    [31, 45],
    [46, 60],
    [61, 75]
];

function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function generateCard() {
    const card = Array.from({ length: 5 }, () => Array(5).fill(0));

    for (let col = 0; col < 5; col++) {
        const [min, max] = RANGES[col];
        const pool = [];
        for (let n = min; n <= max; n++) pool.push(n);
        const picks = shuffle(pool).slice(0, col === 2 ? 4 : 5);
        let pickIdx = 0;

        for (let row = 0; row < 5; row++) {
            if (col === 2 && row === 2) {
                card[row][col] = 0;
            } else {
                card[row][col] = picks[pickIdx++];
            }
        }
    }

    return card;
}

function cardKey(card) {
    return card.map((row) => row.join(',')).join('|');
}

function formatCard(card) {
    const lines = card.map((row) => `        [${row.join(', ')}],`);
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
    return `      [\n${lines.join('\n')}\n      ]`;
}

const cartellasPath = path.join(__dirname, '..', 'data', 'cartellas.js');
const BingoCards = require(cartellasPath);
const existingKeys = new Set(BingoCards.cards.map(cardKey));

let attempts = 0;
while (BingoCards.cards.length < TARGET_COUNT) {
    attempts++;
    const card = generateCard();
    const key = cardKey(card);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    BingoCards.cards.push(card);
}

const cardsBody = BingoCards.cards.map(formatCard).join(',\n');
const fileContents = `const BingoCards = {
    cards: [
${cardsBody}
    ]
  };
  module.exports = BingoCards;
`;

fs.writeFileSync(cartellasPath, fileContents, 'utf8');
console.log(`Extended cartellas to ${BingoCards.cards.length} cards (${attempts} generation attempts).`);
