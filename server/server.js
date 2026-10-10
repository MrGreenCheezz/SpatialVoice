"use strict";
// SpatialVoice relay: a zero-dependency WebSocket server that shares room positions
// between plugin users sitting in the same Discord voice channel.
//
// Protocol (JSON text frames):
//   client -> server  {t:"join", room, user, x, y, a}   room = hashed channel id
//                     {t:"pos", x, y, a}                 my own position
//                     {t:"place", user, x, y}            position of a user without the plugin
//   server -> client  {t:"state", users:{id:{x,y,a}}, placed:{id:{x,y}}}
//                     {t:"pos", user, x, y, a}
//                     {t:"place", user, x, y}
//                     {t:"leave", user}

const http = require("http");
const crypto = require("crypto");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PAYLOAD = 4096;
const MAX_CLIENTS = 2000;
const MAX_ROOM_CLIENTS = 50;
const MAX_PLACED = 100;
const COORD_LIMIT = 1000;
const RATE_PER_SEC = 40;
const RATE_BURST = 80;
const HEARTBEAT_MS = 30_000;

const ROOM_RE = /^[a-f0-9]{16,64}$/;
const USER_RE = /^\d{15,22}$/;

function frame(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

function readPos(m, withAngle = true) {
    if (typeof m.x !== "number" || typeof m.y !== "number" || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return null;
    const clamp = v => Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, v));
    const p = { x: clamp(m.x), y: clamp(m.y) };
    if (withAngle) {
        const a = typeof m.a === "number" && Number.isFinite(m.a) ? m.a : 0;
        p.a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    }
    return p;
}

class Client {
    constructor(socket) {
        this.socket = socket;
        this.buf = Buffer.alloc(0);
        this.room = null;
        this.user = null;
        this.pos = null;
        this.alive = true;
        this.closing = false;
        this.tokens = RATE_BURST;
        this.refilledAt = Date.now();
    }

    send(obj) {
        if (this.closing || this.socket.destroyed) return;
        this.socket.write(frame(0x1, Buffer.from(JSON.stringify(obj))));
    }

    close(code = 1000) {
        if (this.closing) return;
        this.closing = true;
        const payload = Buffer.alloc(2);
        payload.writeUInt16BE(code, 0);
        if (!this.socket.destroyed) this.socket.end(frame(0x8, payload));
    }

    takeToken() {
        const now = Date.now();
        this.tokens = Math.min(RATE_BURST, this.tokens + (now - this.refilledAt) * RATE_PER_SEC / 1000);
        this.refilledAt = now;
        if (this.tokens < 1) return false;
        this.tokens--;
        return true;
    }
}

function createRelay() {
    const rooms = new Map(); // roomId -> { clients: Set<Client>, placed: Map<userId, {x, y}> }
    const clients = new Set();

    function broadcast(room, msg, except) {
        for (const c of room.clients) if (c !== except) c.send(msg);
    }

    function leave(c) {
        const room = c.room;
        if (!room) return;
        c.room = null;
        room.clients.delete(c);
        if (room.clients.size === 0) rooms.delete(c.roomId);
        else broadcast(room, { t: "leave", user: c.user });
    }

    function onMessage(c, text) {
        if (!c.takeToken()) return;
        let m;
        try { m = JSON.parse(text); } catch { return; }
        if (!m || typeof m !== "object") return;

        switch (m.t) {
            case "join": {
                if (typeof m.room !== "string" || !ROOM_RE.test(m.room)) return;
                if (typeof m.user !== "string" || !USER_RE.test(m.user)) return;
                leave(c);

                let room = rooms.get(m.room);
                if (!room) rooms.set(m.room, room = { clients: new Set(), placed: new Map() });
                // The same account reconnecting replaces its previous socket.
                for (const o of [...room.clients]) {
                    if (o.user === m.user) { leave(o); o.close(4000); }
                }
                if (room.clients.size >= MAX_ROOM_CLIENTS) { c.close(4001); return; }

                c.user = m.user;
                c.pos = readPos(m) ?? { x: 0, y: 0, a: 0 };
                c.room = room;
                c.roomId = m.room;
                room.clients.add(c);
                // A plugin user controls their own position from now on.
                room.placed.delete(c.user);

                const users = {};
                for (const o of room.clients) if (o !== c) users[o.user] = o.pos;
                c.send({ t: "state", users, placed: Object.fromEntries(room.placed) });
                broadcast(room, { t: "pos", user: c.user, ...c.pos }, c);
                break;
            }
            case "pos": {
                if (!c.room) return;
                const p = readPos(m);
                if (!p) return;
                c.pos = p;
                broadcast(c.room, { t: "pos", user: c.user, ...p }, c);
                break;
            }
            case "place": {
                const room = c.room;
                if (!room || typeof m.user !== "string" || !USER_RE.test(m.user) || m.user === c.user) return;
                for (const o of room.clients) if (o.user === m.user) return;
                const p = readPos(m, false);
                if (!p) return;
                if (room.placed.size >= MAX_PLACED && !room.placed.has(m.user)) return;
                room.placed.set(m.user, p);
                broadcast(room, { t: "place", user: m.user, ...p }, c);
                break;
            }
        }
    }

    function parse(c) {
        while (!c.closing) {
            const b = c.buf;
            if (b.length < 2) return;
            const fin = b[0] & 0x80;
            const opcode = b[0] & 0x0f;
            if (!(b[1] & 0x80)) return c.close(1002); // clients must mask
            let len = b[1] & 0x7f;
            let off = 2;
            if (len === 126) {
                if (b.length < 4) return;
                len = b.readUInt16BE(2);
                off = 4;
            } else if (len === 127) {
                if (b.length < 10) return;
                const big = b.readBigUInt64BE(2);
                if (big > BigInt(MAX_PAYLOAD)) return c.close(1009);
                len = Number(big);
                off = 10;
            }
            if (len > MAX_PAYLOAD) return c.close(1009);
            if (b.length < off + 4 + len) return;

            const mask = b.subarray(off, off + 4);
            const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
            for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
            c.buf = b.subarray(off + 4 + len);

            if (!fin || opcode === 0x0) return c.close(1003); // no fragmentation; messages are tiny
            switch (opcode) {
                case 0x1: onMessage(c, data.toString("utf8")); break;
                case 0x8: return c.close(1000);
                case 0x9: c.socket.write(frame(0xA, data)); break;
                case 0xA: c.alive = true; break;
                default: return c.close(1003);
            }
        }
    }

    const server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`SpatialVoice relay: ${clients.size} clients, ${rooms.size} rooms\n`);
    });

    server.on("upgrade", (req, socket, head) => {
        const key = req.headers["sec-websocket-key"];
        if (String(req.headers.upgrade).toLowerCase() !== "websocket" || typeof key !== "string" || clients.size >= MAX_CLIENTS) {
            socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
            return;
        }
        const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
        socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        socket.setNoDelay(true);

        const c = new Client(socket);
        clients.add(c);
        const onData = d => {
            c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d;
            parse(c);
        };
        socket.on("data", onData);
        socket.on("close", () => { leave(c); clients.delete(c); });
        socket.on("error", () => socket.destroy());
        if (head?.length) onData(head);
    });

    const heartbeat = setInterval(() => {
        for (const c of clients) {
            if (!c.alive) { c.socket.destroy(); continue; }
            c.alive = false;
            if (!c.socket.destroyed) c.socket.write(frame(0x9, Buffer.alloc(0)));
        }
    }, HEARTBEAT_MS);
    heartbeat.unref();
    server.on("close", () => clearInterval(heartbeat));

    return { server, rooms, clients };
}

module.exports = { createRelay };

if (require.main === module) {
    const port = Number(process.env.PORT) || 8787;
    const host = process.env.HOST || "0.0.0.0";
    createRelay().server.listen(port, host, () => console.log(`SpatialVoice relay listening on ws://${host}:${port}`));
}
