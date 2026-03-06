const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Room = require('./room');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    connectTimeout: 10000,
    pingTimeout: 5000,
    pingInterval: 10000,
    transports: ['websocket'],
    cors: {
        origin: "*"
    }
});

app.use(express.static(path.join(__dirname, '../public')));

const rooms = new Map();
const socketToPlayerMap = new Map(); // socket.id -> { roomId, playerId, name }

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms.has(code));
    return code;
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('create-room', ({ name }, callback) => {
        console.log(`[CREATE-ROOM] Player: ${name}, Socket: ${socket.id}`);
        const roomId = generateRoomCode();
        const room = new Room(roomId);
        rooms.set(roomId, room);

        const player = room.addPlayer(socket.id, name);
        socketToPlayerMap.set(socket.id, { roomId, playerId: player.id, name });

        socket.join(roomId);
        console.log(`[ROOM-CREATED] ID: ${roomId}, Player: ${name} (${player.id})`);
        callback({ success: true, roomId, playerId: player.id });
        io.to(roomId).emit('room-update', room.getState(null));
    });

    socket.on('join-room', ({ name, roomId }, callback) => {
        console.log(`[JOIN-ROOM] Player: ${name}, Room: ${roomId}, Socket: ${socket.id}`);
        const room = rooms.get(roomId);
        if (!room) {
            console.log(`[JOIN-FAILED] Room ${roomId} not found`);
            return callback({ error: 'Room not found' });
        }
        if (room.status !== 'waiting') {
            console.log(`[JOIN-FAILED] Game already started in Room ${roomId}`);
            return callback({ error: 'Game already started' });
        }
        if (room.players.length >= 10) {
            console.log(`[JOIN-FAILED] Room ${roomId} is full`);
            return callback({ error: 'Room is full' });
        }

        const player = room.addPlayer(socket.id, name);
        socketToPlayerMap.set(socket.id, { roomId, playerId: player.id, name });

        socket.join(roomId);
        console.log(`[JOIN-SUCCESS] Player ${name} joined Room ${roomId}`);
        callback({ success: true, roomId, playerId: player.id });
        io.to(roomId).emit('room-update', room.getState(null));
    });

    socket.on('start-game', () => {
        const user = socketToPlayerMap.get(socket.id);
        if (!user) return;
        const room = rooms.get(user.roomId);
        if (!room) return;

        const player = room.players.find(p => p.id === user.playerId);
        if (!player || !player.isHost) return;

        if (room.startGame()) {
            room.players.forEach(p => {
                io.to(p.socketId).emit('game-update', room.getState(p.id));
            });
            io.to(user.roomId).emit('notification', { message: 'Game started!' });
        }
    });

    socket.on('play-card', ({ cardIndex, declaredColor }) => {
        const user = socketToPlayerMap.get(socket.id);
        if (!user) return;
        const room = rooms.get(user.roomId);
        if (!room) return;

        const result = room.playCard(user.playerId, cardIndex, declaredColor);
        if (result.error) {
            socket.emit('game-error', result.error);
        } else {
            room.players.forEach(p => {
                io.to(p.socketId).emit('game-update', room.getState(p.id));
            });
            if (result.winner) {
                io.to(user.roomId).emit('game-over', { winner: result.winner.name });
            }
        }
    });

    socket.on('draw-card', () => {
        const user = socketToPlayerMap.get(socket.id);
        if (!user) return;
        const room = rooms.get(user.roomId);
        if (!room) return;

        const result = room.playerDrawCard(user.playerId);
        if (result.error) {
            socket.emit('game-error', result.error);
        } else {
            room.players.forEach(p => {
                io.to(p.socketId).emit('game-update', room.getState(p.id));
            });
        }
    }
    });

socket.on('call-uno', () => {
    const user = socketToPlayerMap.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === user.playerId);
    if (player) {
        if (player.hand.length <= 2) {
            player.unoCalled = true;
            io.to(user.roomId).emit('notification', { message: `${player.name} called UNO!` });
            room.players.forEach(p => {
                io.to(p.socketId).emit('game-update', room.getState(p.id));
            });
        } else {
            socket.emit('game-error', 'You can only call UNO when you have 2 or fewer cards!');
        }
    }
});

socket.on('catch-uno', () => {
    const user = socketToPlayerMap.get(socket.id);
    if (!user) return;
    const room = rooms.get(user.roomId);
    if (!room) return;

    const result = room.catchUno(user.playerId);
    if (result.success) {
        io.to(user.roomId).emit('notification', { message: `${user.name} caught ${result.caughtName} forgetting UNO! +2 penalty cards.` });
        room.players.forEach(p => {
            io.to(p.socketId).emit('game-update', room.getState(p.id));
        });
    } else {
        socket.emit('game-error', result.error || 'No one to catch!');
    }
});

socket.on('reconnect-player', ({ playerId, roomId, name }, callback) => {
    console.log(`[RECONNECT-ATTEMPT] Player: ${name}, Room: ${roomId}, ID: ${playerId}`);
    const room = rooms.get(roomId);
    if (!room) {
        console.log(`[RECONNECT-FAILED] Room ${roomId} not found`);
        return callback({ success: false, error: 'Room not found' });
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        console.log(`[RECONNECT-FAILED] Player ${playerId} not found in room ${roomId}`);
        return callback({ success: false, error: 'Player not found' });
    }

    // Update socket ID
    player.socketId = socket.id;
    socketToPlayerMap.set(socket.id, { roomId, playerId: player.id, name: player.name });
    socket.join(roomId);

    console.log(`[RECONNECT-SUCCESS] Player ${player.name} reconnected to Room ${roomId}`);
    callback({ success: true });

    // Send full state update
    if (room.status === 'playing') {
        socket.emit('game-update', room.getState(player.id));
    } else {
        io.to(roomId).emit('room-update', room.getState(null));
    }
});

socket.on('send-reaction', ({ emoji }) => {
    const user = socketToPlayerMap.get(socket.id);
    if (!user) return;

    // Broadcast the reaction to everyone in the room (including sender)
    io.to(user.roomId).emit('show-reaction', {
        playerId: user.playerId,
        emoji
    });
});

socket.on('disconnect', () => {
    const user = socketToPlayerMap.get(socket.id);
    if (user) {
        const room = rooms.get(user.roomId);
        if (room) {
            const removedPlayer = room.removePlayer(socket.id);
            if (removedPlayer) {
                io.to(user.roomId).emit('notification', { message: `${removedPlayer.name} disconnected.` });
                if (room.players.length === 0) {
                    rooms.delete(user.roomId);
                } else {
                    if (room.status === 'finished' && room.winner) {
                        io.to(user.roomId).emit('game-over', { winner: room.winner.name });
                    }

                    room.players.forEach(p => {
                        io.to(p.socketId).emit('room-update', room.getState(p.id));
                        if (room.status === 'playing' || room.status === 'finished') {
                            io.to(p.socketId).emit('game-update', room.getState(p.id));
                        }
                    });
                }
            }
        }
        socketToPlayerMap.delete(socket.id);
    }
});
});

const PORT = process.env.PORT || 3000;

// Get local IP address for LAN play instruction
const os = require('os');
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal (i.e. 127.0.0.1) and non-ipv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log(`\nUNO Server is running!`);
    console.log(`=======================`);
    console.log(`🕹️ Play on this computer: http://localhost:${PORT}`);
    console.log(`📱 Play on phone/other devices on same WiFi: http://${localIP}:${PORT}`);
    console.log(`=======================\n`);
});
