/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { settings } from "./settings";
import { getMyId, getParticipants, getPos, Pos, room, SyncStatus } from "./state";

const logger = new Logger("SpatialVoice");

const SEND_INTERVAL_MS = 50;
const MAX_BACKOFF_MS = 30_000;

/** The server only sees a hash of the channel id, never the id itself. */
async function hashRoom(channelId: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("spatialvoice:" + channelId));
    return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Vencord restricts which hosts the client may connect to; ask the user to allow ours. */
async function ensureCspAllowed(url: string): Promise<boolean> {
    const csp = (window as any).VencordNative?.csp;
    if (!csp?.isDomainAllowed) return true;
    try {
        if (await csp.isDomainAllowed(url, ["connect-src"])) return true;
        const res = await csp.requestAddOverride(url, ["connect-src"], "SpatialVoice");
        if (res === "ok") logger.info("Server allowed, restart Discord to apply");
    } catch (e) {
        logger.error("CSP check failed", e);
    }
    return false;
}

function readPos(m: any): Pos | null {
    if (!Number.isFinite(m?.x) || !Number.isFinite(m?.y)) return null;
    return { x: m.x, y: m.y, a: Number.isFinite(m.a) ? m.a : 0 };
}

class SyncClient {
    private ws: WebSocket | null = null;
    private channelId: string | null = null;
    /** Bumped on every (re)connect so callbacks from stale sockets are ignored. */
    private generation = 0;
    private backoff = 1000;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private sendTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingPos: Pos | null = null;

    setChannel(channelId: string | null) {
        this.channelId = channelId;
        this.backoff = 1000;
        this.connect();
    }

    reconnect() {
        this.backoff = 1000;
        this.connect();
    }

    stop() {
        this.channelId = null;
        this.disconnect();
        this.setStatus("off");
    }

    sendPos(p: Pos) {
        this.pendingPos = p;
        if (this.sendTimer) return;
        this.sendTimer = setTimeout(() => {
            this.sendTimer = null;
            if (this.pendingPos) this.send({ t: "pos", ...this.pendingPos });
            this.pendingPos = null;
        }, SEND_INTERVAL_MS);
    }

    sendPlace(userId: string, p: Pos) {
        this.send({ t: "place", user: userId, x: p.x, y: p.y });
    }

    private setStatus(status: SyncStatus) {
        if (room.syncStatus === status) return;
        room.syncStatus = status;
        room.uiChanged();
    }

    private send(msg: object) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    }

    private disconnect() {
        this.generation++;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        if (this.sendTimer) clearTimeout(this.sendTimer);
        this.retryTimer = this.sendTimer = null;
        this.pendingPos = null;
        this.ws?.close();
        this.ws = null;
        if (room.pluginUsers.size) {
            room.pluginUsers.clear();
            room.uiChanged();
        }
    }

    private async connect() {
        this.disconnect();
        const gen = this.generation;
        const url = settings.store.serverUrl.trim();
        const { channelId } = this;
        if (!url || !channelId) return this.setStatus("off");

        if (!/^wss?:\/\//i.test(url) || !(await ensureCspAllowed(url))) return this.setStatus("error");
        const roomId = await hashRoom(channelId);
        if (gen !== this.generation) return;

        this.setStatus("connecting");
        let ws: WebSocket;
        try {
            ws = new WebSocket(url);
        } catch (e) {
            logger.error("Bad server url", e);
            return this.setStatus("error");
        }
        this.ws = ws;

        ws.onopen = () => {
            if (gen !== this.generation) return;
            const me = getMyId();
            if (!me) return ws.close();
            this.backoff = 1000;
            this.setStatus("online");
            const self = getPos(me, getParticipants(channelId));
            // Pin my seat so everyone agrees on it even if participant lists differ.
            room.positions.set(me, self);
            this.send({ t: "join", room: roomId, user: me, ...self });
        };
        ws.onmessage = e => {
            if (gen !== this.generation) return;
            try {
                this.handle(JSON.parse(e.data));
            } catch (err) {
                logger.error("Bad message", err);
            }
        };
        ws.onclose = () => {
            if (gen !== this.generation) return;
            this.ws = null;
            room.pluginUsers.clear();
            this.setStatus("error");
            this.retryTimer = setTimeout(() => this.connect(), this.backoff);
            this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
        };
    }

    private handle(m: any) {
        const me = getMyId();
        switch (m?.t) {
            case "state": {
                room.pluginUsers.clear();
                for (const [id, raw] of Object.entries<any>(m.users ?? {})) {
                    const p = readPos(raw);
                    if (id === me || !p) continue;
                    room.pluginUsers.add(id);
                    room.positions.set(id, p);
                }
                for (const [id, raw] of Object.entries<any>(m.placed ?? {})) {
                    const p = readPos(raw);
                    if (id !== me && p && !room.pluginUsers.has(id)) room.positions.set(id, p);
                }
                room.changed();
                break;
            }
            case "pos": {
                const p = readPos(m);
                if (typeof m.user !== "string" || m.user === me || !p) return;
                room.pluginUsers.add(m.user);
                room.positions.set(m.user, p);
                room.changed();
                break;
            }
            case "place": {
                const p = readPos(m);
                if (typeof m.user !== "string" || m.user === me || room.pluginUsers.has(m.user) || !p) return;
                room.positions.set(m.user, p);
                room.changed();
                break;
            }
            case "leave": {
                // Keep their last position; they just stop controlling it.
                if (room.pluginUsers.delete(m.user)) room.uiChanged();
                break;
            }
        }
    }
}

export const sync = new SyncClient();
