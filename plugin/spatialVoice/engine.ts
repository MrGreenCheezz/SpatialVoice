/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SelectedChannelStore } from "@webpack/common";

import { applyAudio, refreshMixer, stopAudio } from "./audio";
import { settings, settingsHooks } from "./settings";
import { clampToRoom, getMyId, getParticipants, getPos, Pos, room } from "./state";
import { sync } from "./sync";

const APPLY_THROTTLE_MS = 50;
/** Re-apply periodically: new voice connections start with default positions. */
const RESYNC_MS = 2000;

let applyTimer: ReturnType<typeof setTimeout> | null = null;
let resyncTimer: ReturnType<typeof setInterval> | null = null;
let serverChangeTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

function applyNow() {
    const { channelId } = room;
    const me = getMyId();
    if (!channelId || !me) return stopAudio();
    const participants = getParticipants(channelId);
    const listener = getPos(me, participants);
    const sources = participants
        .filter(id => id !== me)
        .map(id => ({ id, pos: getPos(id, participants) }));
    applyAudio(listener, sources);
}

export function scheduleApply() {
    if (applyTimer) return;
    applyTimer = setTimeout(() => {
        applyTimer = null;
        applyNow();
    }, APPLY_THROTTLE_MS);
}

/** Follow the voice channel I'm in. */
export function syncVoiceChannel() {
    const channelId: string | null = SelectedChannelStore.getVoiceChannelId() ?? null;
    if (channelId === room.channelId) return;
    stopAudio();
    room.reset(channelId);
    sync.setChannel(channelId);
    scheduleApply();
}

export function moveSelf(p: Pos) {
    const me = getMyId();
    if (!me) return;
    const pos = clampToRoom(p, settings.store.roomSize);
    room.positions.set(me, pos);
    room.changed();
    sync.sendPos(pos);
}

export function placeUser(userId: string, p: Pos) {
    const pos = clampToRoom({ ...p, a: 0 }, settings.store.roomSize);
    room.positions.set(userId, pos);
    room.changed();
    sync.sendPlace(userId, pos);
}

export function startEngine() {
    settingsHooks.onAudioChange = () => {
        refreshMixer();
        scheduleApply();
    };
    settingsHooks.onServerChange = () => {
        // The setting fires on every keystroke.
        if (serverChangeTimer) clearTimeout(serverChangeTimer);
        serverChangeTimer = setTimeout(() => sync.reconnect(), 1000);
    };
    unsubscribe = room.onChange(scheduleApply);
    resyncTimer = setInterval(scheduleApply, RESYNC_MS);
    syncVoiceChannel();
}

export function stopEngine() {
    settingsHooks.onAudioChange = settingsHooks.onServerChange = () => { };
    unsubscribe?.();
    unsubscribe = null;
    for (const t of [applyTimer, serverChangeTimer]) if (t) clearTimeout(t);
    if (resyncTimer) clearInterval(resyncTimer);
    applyTimer = serverChangeTimer = resyncTimer = null;
    sync.stop();
    stopAudio();
    room.reset(null);
}
