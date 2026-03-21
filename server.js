const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// ── In-memory storage ──────────────────────────────
const pigeonRooms = {};   // roomCode → [ ...messages ]
const pigeonUsers = {};   // username → { username, createdAt }
const ownerSockets = {};  // username → socketId  (for push notifications)
const MAX_MSGS = 500;
// ──────────────────────────────────────────────────

io.on('connection', (socket) => {

    // ── LOGIN (username only, no password) ─────────
    socket.on('loginUser', (username) => {
        username = username.trim().toLowerCase();
        if (!pigeonUsers[username]) {
            pigeonUsers[username] = { username, createdAt: Date.now() };
        }
        if (!pigeonRooms[username]) {
            pigeonRooms[username] = [];
        }
        ownerSockets[username] = socket.id;
        socket.emit('loginSuccess', { username });
    });

    // ── INBOX: owner fetches all messages ──────────
    socket.on('getInbox', (username) => {
        const msgs = pigeonRooms[username] || [];
        socket.emit('inboxData', msgs);
    });

    // ── JOIN ROOM ──────────────────────────────────
    // data = { roomCode, isOwner, ownerUsername }
    socket.on('joinRoom', (data) => {
        const { roomCode, isOwner, ownerUsername } = data;
        socket.join(roomCode);
        if (isOwner) {
            socket.join('owner:' + roomCode);
            ownerSockets[ownerUsername] = socket.id;
        }
        if (!pigeonRooms[roomCode]) pigeonRooms[roomCode] = [];
        socket.emit('loadChats', pigeonRooms[roomCode]);
    });

    // ── SEND MESSAGE ───────────────────────────────
    socket.on('sendMessage', ({ roomCode, message, senderId }) => {
        const chatData = {
            message,
            senderId,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        if (!pigeonRooms[roomCode]) pigeonRooms[roomCode] = [];

        // 500 message cap — drop oldest
        if (pigeonRooms[roomCode].length >= MAX_MSGS) {
            pigeonRooms[roomCode].shift();
        }

        pigeonRooms[roomCode].push(chatData);
        io.to(roomCode).emit('receiveMessage', chatData);

        // Push notification to owner if they're NOT in chat
        const ownerSocketId = ownerSockets[roomCode];
        if (ownerSocketId) {
            io.to(ownerSocketId).emit('newNotification', chatData);
        }
    });

    // ── DISCONNECT ─────────────────────────────────
    socket.on('disconnect', () => {
        for (const [user, sid] of Object.entries(ownerSockets)) {
            if (sid === socket.id) delete ownerSockets[user];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🕊️  Pigeon Live → http://localhost:${PORT}`));
