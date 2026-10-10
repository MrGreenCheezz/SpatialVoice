/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

// Set by the engine on start; keeps settings.ts free of circular imports.
export const settingsHooks = {
    onServerChange: () => { },
    onAudioChange: () => { },
};

export const settings = definePluginSettings({
    serverUrl: {
        type: OptionType.STRING,
        description: "Сервер синхронизации (ws://… или wss://…). Пусто — комната только у тебя.",
        default: "",
        onChange: () => settingsHooks.onServerChange(),
    },
    roomSize: {
        type: OptionType.SLIDER,
        description: "Размер комнаты, метры",
        markers: [4, 8, 12, 16, 20, 30],
        default: 12,
        stickToMarkers: false,
        onChange: () => settingsHooks.onAudioChange(),
    },
    distanceAttenuation: {
        type: OptionType.BOOLEAN,
        description: "Тише с расстоянием",
        default: true,
        onChange: () => settingsHooks.onAudioChange(),
    },
    minDistance: {
        type: OptionType.SLIDER,
        description: "Расстояние, до которого громкость не падает, метры",
        markers: [0.5, 1, 2, 3, 5],
        default: 1,
        stickToMarkers: false,
        onChange: () => settingsHooks.onAudioChange(),
    },
    airAbsorption: {
        type: OptionType.BOOLEAN,
        description: "Глушить высокие частоты у дальних (поглощение воздухом)",
        default: true,
        onChange: () => settingsHooks.onAudioChange(),
    },
    reflections: {
        type: OptionType.BOOLEAN,
        description: "Отражения от стен (эксперимент, заметно грузит процессор)",
        default: false,
        onChange: () => settingsHooks.onAudioChange(),
    },
    forceStereo: {
        type: OptionType.BOOLEAN,
        description: "Простая стереопанорама вместо 3D (если 3D не работает или не нравится)",
        default: false,
        onChange: () => settingsHooks.onAudioChange(),
    },
});
