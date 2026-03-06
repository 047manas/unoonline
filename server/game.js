function createDeck() {
    const colors = ['red', 'blue', 'green', 'yellow'];
    const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];
    let deck = [];

    for (const color of colors) {
        for (const value of values) {
            deck.push({ id: Math.random().toString(36).substr(2, 9), color, value, type: 'number' });
            if (value !== '0') {
                deck.push({ id: Math.random().toString(36).substr(2, 9), color, value, type: 'number' });
            }
        }
    }

    // Add Wilds
    for (let i = 0; i < 4; i++) {
        deck.push({ id: Math.random().toString(36).substr(2, 9), color: 'black', value: 'wild', type: 'wild' });
        deck.push({ id: Math.random().toString(36).substr(2, 9), color: 'black', value: 'wildDraw4', type: 'wild' });
    }

    return deck;
}

function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function isValidPlay(playCard, topCard, declaredColor) {
    if (!playCard || !topCard) return false;
    if (playCard.type === 'wild' || playCard.value === 'wildDraw4') return true;
    if (playCard.color === topCard.color || playCard.value === topCard.value) return true;
    if ((topCard.type === 'wild' || topCard.value === 'wildDraw4') && playCard.color === declaredColor) return true;
    return false;
}

module.exports = { createDeck, shuffle, isValidPlay };
