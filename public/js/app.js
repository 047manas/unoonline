const socket = io();

// DOM Elements
const landingScreen = document.getElementById('landing-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameScreen = document.getElementById('game-screen');
const toastContainer = document.getElementById('toast-container');

// Landing
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('join-room-code');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');

// Lobby
const lobbyRoomCode = document.getElementById('lobby-room-code');
const playerList = document.getElementById('player-list');
const btnStartGame = document.getElementById('btn-start-game');
const waitingMsg = document.getElementById('waiting-msg');

// Game Board
const opponentsContainer = document.getElementById('opponents-container');
const drawPile = document.getElementById('draw-pile');
const discardPileContainer = document.getElementById('discard-pile-container');
const playerHand = document.getElementById('player-hand');
const turnText = document.getElementById('turn-text');
const directionArrow = document.getElementById('direction-arrow');
const btnUno = document.getElementById('btn-uno');

// Modals
const colorPickerModal = document.getElementById('color-picker-modal');
const gameOverModal = document.getElementById('game-over-modal');
const winnerText = document.getElementById('winner-text');
const btnPlayAgain = document.getElementById('btn-play-again');

// Reactions
const reactionBtns = document.querySelectorAll('.reaction-btn');
const floatingEmojisContainer = document.getElementById('floating-emojis');

// State
let myId = null;
let currentRoomId = null;
let isMyTurn = false;
let pendingPlayCardIndex = null; // For wild cards

// Audio (Optional, simple beeps)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(freq, type = 'sine', duration = 0.1) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function switchScreen(screen) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

// --- Connection & Room Logic ---

btnCreateRoom.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Player';
    socket.emit('create-room', { name }, (res) => {
        if (res.success) {
            myId = res.playerId;
            currentRoomId = res.roomId;
            lobbyRoomCode.innerText = res.roomId;
            switchScreen(lobbyScreen);
        } else {
            showToast(res.error);
        }
    });
});

btnJoinRoom.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Player';
    const roomId = roomCodeInput.value.trim().toUpperCase();
    if (!roomId) return showToast('Enter a room code');

    socket.emit('join-room', { name, roomId }, (res) => {
        if (res.success) {
            myId = res.playerId;
            currentRoomId = res.roomId;
            lobbyRoomCode.innerText = res.roomId;
            switchScreen(lobbyScreen);
        } else {
            showToast(res.error);
        }
    });
});

socket.on('room-update', (state) => {
    if (state.status === 'playing') return; // Handled by game-update

    playerList.innerHTML = '';
    let iAmHost = false;

    state.players.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.name;
        if (p.isHost) {
            li.classList.add('host');
            if (p.id === myId) iAmHost = true;
        }
        playerList.appendChild(li);
    });

    if (iAmHost) {
        btnStartGame.classList.remove('hidden');
        if (state.players.length >= 2) {
            btnStartGame.disabled = false;
            btnStartGame.innerText = 'Start Game';
            waitingMsg.classList.add('hidden');
        } else {
            btnStartGame.disabled = true;
            btnStartGame.innerText = 'Start Game (Need 2+)';
            waitingMsg.classList.remove('hidden');
            waitingMsg.innerText = 'Waiting for more players...';
        }
    } else {
        btnStartGame.classList.add('hidden');
        waitingMsg.classList.remove('hidden');
        waitingMsg.innerText = 'Waiting for host to start...';
    }
});

btnStartGame.addEventListener('click', () => {
    socket.emit('start-game');
});

// --- Game Logic ---

socket.on('game-update', (state) => {
    if (landingScreen.classList.contains('active') || lobbyScreen.classList.contains('active')) {
        switchScreen(gameScreen);
        playSound(440, 'triangle', 0.5); // Game start sound
    }

    renderOpponents(state.players, state.turnIndex);
    renderCenter(state);
    renderHand(state.myHand, state);

    const myPlayer = state.players.find(p => p.id === myId);
    isMyTurn = myPlayer && myPlayer.isMyTurn;

    if (isMyTurn) turnText.innerText = 'Your Turn!';
    else turnText.innerText = `${state.players[state.turnIndex].name}'s Turn`;

    directionArrow.className = `arrow ${state.direction === 1 ? 'clockwise' : 'counter-clockwise'}`;
});

function renderOpponents(players, turnIndex) {
    opponentsContainer.innerHTML = '';
    players.forEach((p, idx) => {
        if (p.id === myId) return; // Note: doesn't show self in top row

        const box = document.createElement('div');
        box.className = `opponent-box ${idx === turnIndex ? 'active-turn' : ''}`;
        box.id = `opponent-${p.id}`;

        box.innerHTML = `
            ${p.unoCalled ? '<div class="uno-warning">UNO!</div>' : ''}
            <div class="opponent-name">${p.name}</div>
            <div class="opponent-cards">🂠 ${p.handCount}</div>
        `;
        opponentsContainer.appendChild(box);
    });
}

function renderCenter(state) {
    discardPileContainer.innerHTML = '';
    if (state.topCard) {
        state.topCard.isDiscardTop = true;

        // If it's a wild, show the selected color on the card slightly
        if (state.topCard.type === 'wild' || state.topCard.value === 'wildDraw4') {
            state.topCard.declaredColor = state.currentColor;
        }

        discardPileContainer.innerHTML = createCardHTML(state.topCard, undefined, false, true);
    }

    // Update draw pile color outline based on current color to give a hint
    if (state.currentColor) {
        drawPile.style.boxShadow = `0 0 20px var(--uno-${state.currentColor})`;
    }

    // Set up drop zone
    discardPileContainer.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
        discardPileContainer.style.transform = 'scale(1.1)';
    });

    discardPileContainer.addEventListener('dragleave', () => {
        discardPileContainer.style.transform = '';
    });

    discardPileContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        discardPileContainer.style.transform = '';
        const indexStr = e.dataTransfer.getData('text/plain');
        if (indexStr !== '') {
            const index = parseInt(indexStr);
            const cardEl = document.querySelector(`.uno-card[data-index="${index}"]`);

            // Re-use click logic for validation and visual feedback
            const myPlayer = state.players.find(p => p.id === myId);
            if (myPlayer && myPlayer.hand[index]) {
                handleCardClick(myPlayer.hand[index], index, cardEl);
            }
        }
    });
}

function renderHand(hand, state) {
    playerHand.innerHTML = '';

    hand.forEach((card, index) => {
        // Determine if playable
        const topCard = state.topCard;
        let playable = false;
        if (isMyTurn && topCard) {
            if (card.type === 'wild' || card.value === 'wildDraw4') playable = true;
            else if (card.color === topCard.color || card.value === topCard.value) playable = true;
            else if ((topCard.type === 'wild' || topCard.value === 'wildDraw4') && card.color === state.currentColor) playable = true;
        }

        const cardHtml = createCardHTML(card, index, playable, false);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHtml.trim();
        const cardEl = tempDiv.firstChild;

        if (playable) {
            // Click to play
            cardEl.addEventListener('click', () => handleCardClick(card, index, cardEl));

            // Drag to play
            cardEl.setAttribute('draggable', 'true');
            cardEl.setAttribute('data-index', index);
            cardEl.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', index.toString());
                cardEl.style.opacity = '0.5';
            });
            cardEl.addEventListener('dragend', () => {
                cardEl.style.opacity = '1';
                // Reset drop zone style in case dragleave didn't fire
                discardPileContainer.style.transform = '';
            });
        }

        playerHand.appendChild(cardEl);
    });

    // Spread cards manually a bit if needed, css handles margin-left
}

function handleCardClick(card, index, cardEl) {
    if (!isMyTurn) return;

    if (card.type === 'wild' || card.value === 'wildDraw4') {
        pendingPlayCardIndex = index;
        colorPickerModal.classList.remove('hidden');
    } else {
        // Visual feedback immediately
        if (cardEl) {
            cardEl.style.transform = 'translateY(-100px) scale(0.5)';
            cardEl.style.opacity = '0';
        }

        socket.emit('play-card', { cardIndex: index });
        playSound(600, 'sine', 0.1);
    }
}

drawPile.addEventListener('click', () => {
    if (isMyTurn) {
        // Immediate visual scale
        drawPile.style.transform = 'scale(0.9)';
        setTimeout(() => drawPile.style.transform = '', 150);

        socket.emit('draw-card');
        playSound(800, 'sine', 0.1);
    }
});

btnUno.addEventListener('click', () => {
    socket.emit('call-uno');
});

// Wild Card Color Selection
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const color = e.target.dataset.color;
        colorPickerModal.classList.add('hidden');
        if (pendingPlayCardIndex !== null) {
            socket.emit('play-card', { cardIndex: pendingPlayCardIndex, declaredColor: color });
            playSound(600, 'sine', 0.1);
            pendingPlayCardIndex = null;
        }
    });
});

socket.on('notification', ({ message }) => {
    showToast(message);
    if (message.includes('UNO')) playSound(800, 'square', 0.3);
});

socket.on('game-error', (err) => {
    showToast(`Error: ${err}`);
});

socket.on('game-over', ({ winner }) => {
    winnerText.innerText = `${winner} won the game!`;
    gameOverModal.classList.remove('hidden');
    playSound(400, 'square', 0.5);
    setTimeout(() => playSound(600, 'square', 1), 600);
});

btnPlayAgain.addEventListener('click', () => {
    window.location.reload();
});

// --- Emoji Reactions Logic ---

// Send reaction
reactionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        socket.emit('send-reaction', { emoji });

        // Anti-spam: disable button briefly
        btn.disabled = true;
        setTimeout(() => { btn.disabled = false; }, 1000);
    });
});

// Receive reaction
socket.on('show-reaction', ({ playerId, emoji }) => {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.innerText = emoji;

    // Determine start position based on who sent it
    if (playerId === myId) {
        // Start from bottom center (player area)
        el.style.left = `calc(50% + ${Math.random() * 40 - 20}px)`;
        el.style.bottom = '150px';
    } else {
        // Find opponent box
        const opponentBox = document.getElementById(`opponent-${playerId}`);
        if (opponentBox) {
            const rect = opponentBox.getBoundingClientRect();
            el.style.left = `${rect.left + rect.width / 2}px`;
            el.style.top = `${rect.top + 20}px`;
        } else {
            // Fallback to center screen
            el.style.left = '50%';
            el.style.top = '30%';
        }
    }

    // Add slight random horizontal drift and rotation
    const drift = Math.random() * 80 - 40;
    const rot = Math.random() * 40 - 20;
    el.style.left = `calc(${el.style.left || '50%'} + ${drift}px)`;
    el.style.setProperty('--rot', `${rot}deg`);

    floatingEmojisContainer.appendChild(el);

    // Play a subtle pop sound
    playSound(700 + Math.random() * 200, 'sine', 0.05);

    // Cleanup after animation (2s)
    setTimeout(() => {
        el.remove();
    }, 2000);
});
