const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

// roomCode → [ ...messages ]
const pigeonRooms = {};
// ownerUsername → Set of senderAliases
const pigeonInbox = {};
// ownerUsername → socketId
const ownerSockets = {};

const MAX_MSGS = 500;

// Room name = "owner__alias" for private 1-on-1
function roomKey(owner, alias) {
    return `${owner}__${alias}`;
}

io.on('connection', (socket) => {

    // LOGIN
    socket.on('loginUser', (username) => {
        username = username.trim().toLowerCase();
        if (!pigeonInbox[username]) pigeonInbox[username] = {};
        ownerSockets[username] = socket.id;
        socket.emit('loginSuccess', { username });
    });

    // GET INBOX — returns list of { alias, lastMsg, count }
    socket.on('getInbox', (username) => {
        const inbox = pigeonInbox[username] || {};
        const result = Object.entries(inbox).map(([alias, msgs]) => ({
            alias,
            lastMsg: msgs[msgs.length - 1],
            count: msgs.length
        }));
        // Sort by latest message time
        result.sort((a, b) => (b.lastMsg.ts || 0) - (a.lastMsg.ts || 0));
        socket.emit('inboxData', result);
    });

    // JOIN ROOM
    // data = { owner, alias, isOwner }
    socket.on('joinRoom', ({ owner, alias, isOwner }) => {
        const key = roomKey(owner, alias);
        socket.join(key);

        if (isOwner) {
            ownerSockets[owner] = socket.id;
        }

        if (!pigeonRooms[key]) pigeonRooms[key] = [];
        socket.emit('loadChats', pigeonRooms[key]);
    });

    // SEND MESSAGE
    socket.on('sendMessage', ({ owner, alias, message, senderId }) => {
        const key = roomKey(owner, alias);
        const now = Date.now();

        const chatData = {
            message,
            senderId,
            ts: now,
            time: new Date(now).toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit',
                timeZone: 'Asia/Kolkata'
            })
        };

        // Store in room
        if (!pigeonRooms[key]) pigeonRooms[key] = [];
        if (pigeonRooms[key].length >= MAX_MSGS) pigeonRooms[key].shift();
        pigeonRooms[key].push(chatData);

        // Store in inbox (owner's inbox, grouped by alias)
        if (!pigeonInbox[owner]) pigeonInbox[owner] = {};
        if (!pigeonInbox[owner][alias]) pigeonInbox[owner][alias] = [];
        if (pigeonInbox[owner][alias].length >= MAX_MSGS) pigeonInbox[owner][alias].shift();
        pigeonInbox[owner][alias].push(chatData);

        // Broadcast to room
        io.to(key).emit('receiveMessage', chatData);

        // Notify owner if not in this chat
        const ownerSid = ownerSockets[owner];
        if (ownerSid) {
            io.to(ownerSid).emit('newNotification', { alias, ...chatData });
        }
    });

    socket.on('disconnect', () => {
        for (const [u, sid] of Object.entries(ownerSockets)) {
            if (sid === socket.id) delete ownerSockets[u];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🕊️  Pigeon Live → http://localhost:${PORT}`));
