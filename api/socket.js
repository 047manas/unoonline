const express = require('express');
const { Server } = require('socket.io');
const Room = require('../server/room');

const app = express();
const rooms = new Map();
const socketToPlayerMap = new Map();

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
    } while (rooms.has(code));
    return code;
}

const SocketHandler = (req, res) => {
    if (!res.socket.server.io) {
        console.log('Initializing new Socket.io server...');
        const io = new Server(res.socket.server, {
            path: '/api/socket',
            addTrailingSlash: false,
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });

        io.on('connection', (socket) => {
            console.log('User connected:', socket.id);

            socket.on('create-room', ({ name }, callback) => {
                const roomId = generateRoomCode();
                const room = new Room(roomId);
                rooms.set(roomId, room);

                const player = room.addPlayer(socket.id, name);
                socketToPlayerMap.set(socket.id, { roomId, playerId: player.id, name });

                socket.join(roomId);
                callback({ success: true, roomId, playerId: player.id });
                io.to(roomId).emit('room-update', room.getState(null));
            });

            socket.on('join-room', ({ name, roomId }, callback) => {
                const room = rooms.get(roomId);
                if (!room) return callback({ error: 'Room not found' });
                if (room.status !== 'waiting') return callback({ error: 'Game already started' });
                if (room.players.length >= 10) return callback({ error: 'Room is full' });

                const player = room.addPlayer(socket.id, name);
                socketToPlayerMap.set(socket.id, { roomId, playerId: player.id, name });

                socket.join(roomId);
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
            });

            socket.on('call-uno', () => {
                const user = socketToPlayerMap.get(socket.id);
                if (!user) return;
                const room = rooms.get(user.roomId);
                if (!room) return;

                const player = room.players.find(p => p.id === user.playerId);
                if (player && player.hand.length <= 2) {
                    player.unoCalled = true;
                    io.to(user.roomId).emit('notification', { message: `${player.name} called UNO!` });
                    room.players.forEach(p => {
                        io.to(p.socketId).emit('game-update', room.getState(p.id));
                    });
                }
            });

            socket.on('send-reaction', ({ emoji }) => {
                const user = socketToPlayerMap.get(socket.id);
                if (!user) return;
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
                                room.players.forEach(p => {
                                    io.to(p.socketId).emit('room-update', room.getState(p.id));
                                    if (room.status === 'playing') {
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

        res.socket.server.io = io;
    } else {
        console.log('Socket.io already attached');
    }
    res.end();
};

module.exports = SocketHandler;
