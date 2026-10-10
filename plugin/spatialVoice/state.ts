/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");

/** Top-down room coordinates in meters, (0, 0) is the room center, +y points down on the map.
 *  `a` is the facing angle in radians: 0 = up on the map, clockwise positive. */
export interface Pos { x: number; y: number; a: number; }

export type SyncStatus = "off" | "connecting" | "online" | "error";

type Listener = () => void;

/** Default seats are on a fixed-radius circle so every client computes the same layout. */
const SEAT_RADIUS = 2.5;

class RoomState {
    channelId: string | null = null;
    /** Explicit positions: my own, synced plugin users, and users placed by hand. */
    readonly positions = new Map<string, Pos>();
    /** Users currently online on the sync server (they control their own position). */
    readonly pluginUsers = new Set<string>();
    syncStatus: SyncStatus = "off";

    private readonly changeListeners = new Set<Listener>();
    private readonly uiListeners = new Set<Listener>();

    /** Positions changed: re-apply audio and re-render. */
    onChange(fn: Listener) {
        this.changeListeners.add(fn);
        return () => { this.changeListeners.delete(fn); };
    }

    /** Only the UI needs to re-render (speaking rings, sync status). */
    onUi(fn: Listener) {
        this.uiListeners.add(fn);
        return () => { this.uiListeners.delete(fn); };
    }

    changed() {
        this.changeListeners.forEach(fn => fn());
        this.uiListeners.forEach(fn => fn());
    }

    uiChanged() {
        this.uiListeners.forEach(fn => fn());
    }

    reset(channelId: string | null) {
        this.channelId = channelId;
        this.positions.clear();
        this.pluginUsers.clear();
        this.changed();
    }
}

export const room = new RoomState();

export function getMyId(): string | undefined {
    return UserStore.getCurrentUser()?.id;
}

/** Sorted ids of everyone in the voice channel (including me). */
export function getParticipants(channelId: string): string[] {
    const states = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    return Object.keys(states).sort();
}

function defaultSeat(userId: string, participants: string[]): Pos {
    const n = participants.length;
    const i = participants.indexOf(userId);
    if (n <= 1 || i < 0) return { x: 0, y: 0, a: 0 };
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = SEAT_RADIUS * Math.cos(theta);
    const y = SEAT_RADIUS * Math.sin(theta);
    // Face the center of the room.
    return { x, y, a: Math.atan2(-Math.cos(theta), Math.sin(theta)) };
}

export function getPos(userId: string, participants: string[]): Pos {
    return room.positions.get(userId) ?? defaultSeat(userId, participants);
}

export function clampToRoom(p: Pos, size: number): Pos {
    const half = size / 2;
    return {
        x: Math.max(-half, Math.min(half, p.x)),
        y: Math.max(-half, Math.min(half, p.y)),
        a: p.a,
    };
}

export function normalizeAngle(a: number) {
    const full = 2 * Math.PI;
    return ((a % full) + full) % full;
}
