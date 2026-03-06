const { createDeck, shuffle, isValidPlay } = require('./game');
const { v4: uuidv4 } = require('uuid');

class Room {
    constructor(id) {
        this.id = id;
        this.players = [];
        this.status = 'waiting';
        this.deck = [];
        this.discardPile = [];
        this.currentColor = null;
        this.direction = 1;
        this.turnIndex = 0;
        this.winner = null;
        this.drawStack = 0;
    }

    addPlayer(socketId, name) {
        const player = {
            id: uuidv4(),
            socketId,
            name,
            hand: [],
            isHost: this.players.length === 0,
            unoCalled: false
        };
        this.players.push(player);
        return player;
    }

    removePlayer(socketId) {
        const index = this.players.findIndex(p => p.socketId === socketId);
        if (index !== -1) {
            const player = this.players[index];
            this.players.splice(index, 1);
            if (player.isHost && this.players.length > 0) {
                this.players[0].isHost = true;
            }
            if (this.status === 'playing') {
                this.deck.unshift(...player.hand);

                // If only 1 player left, they win
                if (this.players.length === 1) {
                    this.status = 'finished';
                    this.winner = this.players[0];
                    console.log(`[GAME-OVER] Only one player left: ${this.winner.name} wins by default.`);
                } else {
                    if (index < this.turnIndex) {
                        this.turnIndex--;
                    }
                    if (this.turnIndex >= this.players.length) {
                        this.turnIndex = 0;
                    }
                }
            }
            return player;
        }
        return null;
    }

    startGame() {
        if (this.players.length < 2) return false;

        this.deck = shuffle(createDeck());
        console.log(`[GAME-START] Deck shuffled. First 5 cards:`, this.deck.slice(0, 5).map(c => `${c.color} ${c.value}`));

        this.discardPile = [];
        this.status = 'playing';
        this.direction = 1;
        this.turnIndex = 0;
        this.winner = null;

        this.players.forEach(p => {
            p.hand = this.deck.splice(0, 7);
            p.unoCalled = false;
        });

        this.drawStack = 0; // Reset stack on start

        let firstCard = this.deck.shift();
        while (firstCard.value === 'wildDraw4') {
            this.deck.push(firstCard);
            firstCard = this.deck.shift();
        }
        this.discardPile.push(firstCard);

        if (firstCard.type === 'wild') {
            this.currentColor = 'red';
        } else {
            this.currentColor = firstCard.color;
        }

        this.applyCardEffect(firstCard, false);
        return true;
    }

    nextTurn() {
        this.turnIndex += this.direction;
        if (this.turnIndex >= this.players.length) {
            this.turnIndex = 0;
        } else if (this.turnIndex < 0) {
            this.turnIndex = this.players.length - 1;
        }
    }

    drawCards(count) {
        const drawn = [];
        for (let i = 0; i < count; i++) {
            if (this.deck.length === 0) {
                if (this.discardPile.length > 1) {
                    const top = this.discardPile.pop();
                    this.deck = shuffle(this.discardPile);
                    this.discardPile = [top];
                } else {
                    break;
                }
            }
            drawn.push(this.deck.shift());
        }
        return drawn;
    }

    applyCardEffect(card, isPlay = true) {
        if (card.value === 'reverse') {
            this.direction *= -1;
            if (this.players.length === 2 && isPlay) {
                this.nextTurn();
            }
        } else if (card.value === 'skip') {
            this.nextTurn();
        } else if (card.value === 'draw2') {
            this.drawStack += 2;
            // No nextTurn here, playCard handles it
        } else if (card.value === 'wildDraw4') {
            this.drawStack += 4;
            // No nextTurn here, playCard handles it
        }
    }

    playCard(playerId, cardIndex, declaredColor) {
        if (this.status !== 'playing') return { error: 'Game not playing' };

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1 || playerIndex !== this.turnIndex) {
            return { error: 'Not your turn' };
        }

        const player = this.players[playerIndex];
        const card = player.hand[cardIndex];
        if (!card) return { error: 'Invalid card' };

        const topCard = this.discardPile[this.discardPile.length - 1];

        // Stacking rules
        if (this.drawStack > 0) {
            // Must play same type of card to stack
            if (card.value !== topCard.value) {
                return { error: `You must stack a ${topCard.value} or draw ${this.drawStack} cards!` };
            }
        } else {
            if (!isValidPlay(card, topCard, this.currentColor)) {
                return { error: 'Invalid play' };
            }
        }

        player.hand.splice(cardIndex, 1);
        this.discardPile.push(card);

        if (card.type === 'wild' || card.value === 'wildDraw4') {
            this.currentColor = declaredColor || 'red';
        } else {
            this.currentColor = card.color;
        }

        this.applyCardEffect(card, true);

        if (player.hand.length === 0) {
            this.status = 'finished';
            this.winner = player;
            return { success: true, winner: player };
        }

        // Reset UNO call if no longer on 1 card
        if (player.hand.length > 1) {
            player.unoCalled = false;
        }

        this.nextTurn();
        return { success: true };
    }

    playerDrawCard(playerId) {
        if (this.status !== 'playing') return { error: 'Game not playing' };

        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1 || playerIndex !== this.turnIndex) {
            return { error: 'Not your turn' };
        }

        const player = this.players[playerIndex];

        let drawAmount = 1;
        let penaltySkip = false;

        if (this.drawStack > 0) {
            drawAmount = this.drawStack;
            this.drawStack = 0;
            penaltySkip = true;
        }

        const drawn = this.drawCards(drawAmount);
        if (drawn.length > 0) {
            player.hand.push(...drawn);
            player.unoCalled = false;
        }

        this.nextTurn();
        // If they drew a stack, they are skipped
        // Actually nextTurn() already skip them if we move it here?
        // Wait, if it was their turn and they draw, nextTurn moves it to the next person.
        // Usually in UNO if you draw 1 you can still play it if it matches.
        // But if you draw a STACK, your turn is definitely over.
        return { success: true, drawn };
    }

    catchUno(catcherId) {
        // Find players with 1 card who haven't called UNO
        const vulnerablePlayer = this.players.find(p => p.hand.length === 1 && !p.unoCalled);
        if (vulnerablePlayer) {
            const drawn = this.drawCards(2);
            vulnerablePlayer.hand.push(...drawn);
            return { success: true, caughtName: vulnerablePlayer.name };
        }
        return { success: false, error: 'No one to catch!' };
    }

    getState(playerId) {
        return {
            id: this.id,
            status: this.status,
            currentColor: this.currentColor,
            direction: this.direction,
            turnIndex: this.turnIndex,
            drawStack: this.drawStack,
            winner: this.winner ? { id: this.winner.id, name: this.winner.name } : null,
            topCard: this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null,
            players: this.players.map((p, idx) => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                handCount: p.hand.length,
                isMyTurn: idx === this.turnIndex,
                unoCalled: p.unoCalled
            })),
            myHand: this.players.find(p => p.id === playerId)?.hand || [],
            myId: playerId
        };
    }
}

module.exports = Room;
