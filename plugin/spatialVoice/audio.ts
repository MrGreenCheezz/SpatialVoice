/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy, findStoreLazy } from "@webpack";

import { settings } from "./settings";
import { Pos } from "./state";

// Discord's native voice engine has Steam Audio built in (HRTF, distance attenuation,
// reflections). See NOTES.md in the repo for how this was found.
const MediaEngineStore = findStoreLazy("MediaEngineStore");
const AudioActions = findByPropsLazy("setSpatialAudioOverrides", "setLocalPan");

const logger = new Logger("SpatialVoice");

const VOICE_CONTEXT = "default";
/** Engine default: 1 m straight ahead, i.e. "not positioned". */
const FRONT = { x: 0, y: 0, z: -1 };

export type AudioMode = "spatial" | "stereo";

let mode: AudioMode | null = null;
let touched = new Set<string>();

export interface Source { id: string; pos: Pos; }

export function spatialSupported(): boolean {
    try {
        // MediaEngineFeatures enum value (upper case); the lower-case name is the native feature flag.
        return MediaEngineStore.supports("SPATIAL_AUDIO") === true;
    } catch {
        return false;
    }
}

export function getAudioMode() {
    return mode;
}

function forEachConnection(fn: (conn: any) => void) {
    MediaEngineStore.getMediaEngine().eachConnection(fn, VOICE_CONTEXT);
}

function mixerOverrides() {
    const s = settings.store;
    const half = s.roomSize / 2;
    return {
        isSpatial: true,
        distanceAttenuation: { enabled: s.distanceAttenuation, minDistance: s.minDistance },
        airAbsorption: { enabled: s.airAbsorption },
        reflections: {
            enabled: s.reflections,
            room: {
                minCorner: { x: -half, y: -1.5, z: -half },
                maxCorner: { x: half, y: 1.5, z: half },
            },
        },
    };
}

/** Source position in the listener's frame as the engine expects it: +x right, +y up, -z ahead. */
export function toListenerSpace(listener: Pos, source: Pos) {
    const dx = source.x - listener.x;
    const dy = source.y - listener.y;
    if (Math.hypot(dx, dy) < 0.001) return { x: 0, y: 0, z: -0.001 };
    const cos = Math.cos(listener.a), sin = Math.sin(listener.a);
    // forward = (sin a, -cos a), right = (cos a, sin a) in map coordinates
    const right = dx * cos + dy * sin;
    const ahead = dx * sin - dy * cos;
    return { x: right, y: 0, z: -ahead };
}

function baseVolume(userId: string): number {
    return MediaEngineStore.getLocalVolume(userId, VOICE_CONTEXT) ?? 100;
}

/** Fallback without HRTF: pan by direction, volume by distance. */
function stereoParams(rel: { x: number; z: number; }) {
    const s = settings.store;
    const dist = Math.hypot(rel.x, rel.z);
    const pan = Math.max(-1, Math.min(1, rel.x / Math.max(dist, 0.5)));
    const left = pan > 0 ? 1 - pan * 0.85 : 1;
    const right = pan < 0 ? 1 + pan * 0.85 : 1;
    const gain = s.distanceAttenuation
        ? Math.max(0.05, s.minDistance / Math.max(dist, s.minDistance))
        : 1;
    return { left, right, gain };
}

function resetUser(conn: any, userId: string) {
    if (mode === "spatial") {
        conn.setUserPosition?.(userId, FRONT);
    } else if (mode === "stereo") {
        const pan = MediaEngineStore.getLocalPan(userId, VOICE_CONTEXT) ?? { left: 1, right: 1 };
        conn.setLocalPan(userId, pan.left, pan.right);
        conn.setLocalVolume(userId, baseVolume(userId));
    }
}

export function applyAudio(listener: Pos, sources: Source[]) {
    const next: AudioMode = !settings.store.forceStereo && spatialSupported() ? "spatial" : "stereo";
    if (mode !== null && mode !== next) stopAudio();
    try {
        if (mode === null && next === "spatial") AudioActions.setSpatialAudioOverrides(mixerOverrides());
        mode = next;

        const ids = new Set(sources.map(s => s.id));
        const gone = [...touched].filter(id => !ids.has(id));
        forEachConnection(conn => {
            for (const id of gone) resetUser(conn, id);
            for (const { id, pos } of sources) {
                const rel = toListenerSpace(listener, pos);
                if (mode === "spatial") {
                    conn.setUserPosition?.(id, rel);
                } else {
                    const { left, right, gain } = stereoParams(rel);
                    conn.setLocalPan(id, left, right);
                    conn.setLocalVolume(id, baseVolume(id) * gain);
                }
            }
        });
        touched = ids;
    } catch (e) {
        logger.error("Failed to apply positions", e);
    }
}

export function stopAudio() {
    if (mode === null) return;
    try {
        forEachConnection(conn => touched.forEach(id => resetUser(conn, id)));
        if (mode === "spatial") AudioActions.setSpatialAudioOverrides({});
    } catch (e) {
        logger.error("Failed to reset audio", e);
    }
    mode = null;
    touched = new Set();
}

/** Push changed mixer settings (room size, attenuation…) to the engine. */
export function refreshMixer() {
    if (mode === "spatial") AudioActions.setSpatialAudioOverrides(mixerOverrides());
}
