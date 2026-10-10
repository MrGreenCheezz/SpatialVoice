"use strict";
// Local relay test. Run: node --experimental-websocket test.js  (Node >= 20.10)
const assert = require("assert");
const { createRelay } = require("./server");

const ROOM = "0123456789abcdef0123456789abcdef";
const A = "111111111111111111";
const B = "222222222222222222";
const C = "333333333333333333";

function client(url) {
    const ws = new WebSocket(url);
    const queue = [];
    const waiters = [];
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        const w = waiters.shift();
        if (w) w(m); else queue.push(m);
    };
    return {
        ws,
        open: () => new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }),
        send: o => ws.send(JSON.stringify(o)),
        next: () => new Promise((res, rej) => {
            if (queue.length) return res(queue.shift());
            const t = setTimeout(() => rej(new Error("timeout waiting for message")), 2000);
            waiters.push(m => { clearTimeout(t); res(m); });
        }),
    };
}

(async () => {
    const { server, rooms } = createRelay();
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const url = `ws://127.0.0.1:${server.address().port}`;

    const a = client(url), b = client(url);
    await Promise.all([a.open(), b.open()]);

    a.send({ t: "join", room: ROOM, user: A, x: 1, y: 2, a: 0 });
    assert.deepStrictEqual(await a.next(), { t: "state", users: {}, placed: {} });

    b.send({ t: "join", room: ROOM, user: B, x: -1, y: 0, a: 1 });
    const st = await b.next();
    assert.strictEqual(st.t, "state");
    assert.deepStrictEqual(st.users[A], { x: 1, y: 2, a: 0 });
    assert.deepStrictEqual(await a.next(), { t: "pos", user: B, x: -1, y: 0, a: 1 });

    a.send({ t: "pos", x: 3, y: -4, a: 7 });
    const p = await b.next();
    assert.strictEqual(p.user, A);
    assert.strictEqual(p.x, 3);
    assert.ok(p.a >= 0 && p.a < 2 * Math.PI, "angle normalized");

    // Placing a non-plugin user is shared; placing a plugin user is ignored.
    b.send({ t: "place", user: C, x: 5, y: 5 });
    assert.deepStrictEqual(await a.next(), { t: "place", user: C, x: 5, y: 5 });
    b.send({ t: "place", user: A, x: 9, y: 9 });

    // Garbage and out-of-range values are rejected or clamped.
    a.send({ t: "pos", x: "nope", y: 0 });
    a.send({ t: "pos", x: 1e9, y: 0, a: 0 });
    const clamped = await b.next();
    assert.strictEqual(clamped.x, 1000, "clamped, and the ignored place/garbage produced nothing");

    // A late joiner receives the placed users.
    const c = client(url);
    await c.open();
    c.send({ t: "join", room: ROOM, user: "444444444444444444", x: 0, y: 0, a: 0 });
    const st2 = await c.next();
    assert.deepStrictEqual(st2.placed[C], { x: 5, y: 5 });
    assert.deepStrictEqual(Object.keys(st2.users).sort(), [A, B]);
    await a.next(); await b.next(); // pos broadcast of the late joiner

    b.ws.close();
    assert.deepStrictEqual(await a.next(), { t: "leave", user: B });

    a.ws.close(); c.ws.close();
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(rooms.size, 0, "empty room removed");

    server.close();
    console.log("relay tests passed");
})().catch(e => { console.error(e); process.exit(1); });
