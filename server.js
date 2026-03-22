const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const pigeonRooms  = {};
const pigeonInbox  = {};
const ownerSockets = {};
const MAX_MSGS = 500;

function roomKey(owner, alias) {
    return `${owner}__${alias}`;
}

io.on('connection', (socket) => {

    socket.on('loginUser', (username) => {
        username = username.trim().toLowerCase();
        if (!pigeonInbox[username]) pigeonInbox[username] = {};
        ownerSockets[username] = socket.id;
        socket.emit('loginSuccess', { username });
    });

    socket.on('getInbox', (username) => {
        const inbox = pigeonInbox[username] || {};
        const result = Object.entries(inbox).map(([alias, msgs]) => ({
            alias,
            lastMsg: msgs[msgs.length - 1],
            count: msgs.length
        }));
        result.sort((a, b) => (b.lastMsg.ts || 0) - (a.lastMsg.ts || 0));
        socket.emit('inboxData', result);
    });

    // DELETE a thread from inbox
    socket.on('deleteThread', ({ owner, alias }) => {
        if (pigeonInbox[owner]) {
            delete pigeonInbox[owner][alias];
        }
        const key = roomKey(owner, alias);
        if (pigeonRooms[key]) delete pigeonRooms[key];

        // Send updated inbox back
        const inbox = pigeonInbox[owner] || {};
        const result = Object.entries(inbox).map(([a, msgs]) => ({
            alias: a,
            lastMsg: msgs[msgs.length - 1],
            count: msgs.length
        }));
        result.sort((a, b) => (b.lastMsg.ts || 0) - (a.lastMsg.ts || 0));
        socket.emit('inboxData', result);
    });

    socket.on('joinRoom', ({ owner, alias, isOwner }) => {
        const key = roomKey(owner, alias);
        socket.join(key);
        if (isOwner) ownerSockets[owner] = socket.id;
        if (!pigeonRooms[key]) pigeonRooms[key] = [];
        socket.emit('loadChats', pigeonRooms[key]);
    });

    socket.on('sendMessage', ({ owner, alias, message, senderId }) => {
        const key = roomKey(owner, alias);
        const now = Date.now();
        const chatData = {
            message, senderId, ts: now,
            time: new Date(now).toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
            })
        };
        if (!pigeonRooms[key]) pigeonRooms[key] = [];
        if (pigeonRooms[key].length >= MAX_MSGS) pigeonRooms[key].shift();
        pigeonRooms[key].push(chatData);

        if (!pigeonInbox[owner]) pigeonInbox[owner] = {};
        if (!pigeonInbox[owner][alias]) pigeonInbox[owner][alias] = [];
        if (pigeonInbox[owner][alias].length >= MAX_MSGS) pigeonInbox[owner][alias].shift();
        pigeonInbox[owner][alias].push(chatData);

        io.to(key).emit('receiveMessage', chatData);

        const ownerSid = ownerSockets[owner];
        if (ownerSid) io.to(ownerSid).emit('newNotification', { alias, ...chatData });
    });

    socket.on('disconnect', () => {
        for (const [u, sid] of Object.entries(ownerSockets)) {
            if (sid === socket.id) delete ownerSockets[u];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🕊️  Pigeon Live → http://localhost:${PORT}`));
