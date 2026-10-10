/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType } from "@api/Commands";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Menu, SelectedChannelStore } from "@webpack/common";

import { scheduleApply, startEngine, stopEngine, syncVoiceChannel } from "./engine";
import { openRoomModal } from "./RoomModal";
import { settings } from "./settings";
import { room } from "./state";
import managedStyle from "./styles.css?managed";

const channelContextPatch: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel || channel.id !== SelectedChannelStore.getVoiceChannelId()) return;
    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem id="vc-spatial-voice-open" label="Пространственная комната" action={openRoomModal} />
    );
};

export default definePlugin({
    name: "SpatialVoice",
    description: "Расставляй собеседников в виртуальной комнате: звук идёт с их стороны и тише с расстоянием. Позиции синхронизируются через сервер между теми, у кого есть плагин.",
    authors: [{ name: "MrGreenCheezz", id: 0n }],
    settings,
    managedStyle,

    contextMenus: {
        "channel-context": channelContextPatch,
    },

    toolboxActions: {
        "Пространственная комната": openRoomModal,
    },

    commands: [{
        name: "spatial",
        description: "Открыть пространственную комнату",
        inputType: ApplicationCommandInputType.BUILT_IN,
        execute: () => { openRoomModal(); },
    }],

    flux: {
        VOICE_CHANNEL_SELECT() {
            // Let the stores process the event first.
            setTimeout(syncVoiceChannel, 0);
        },
        VOICE_STATE_UPDATES() {
            syncVoiceChannel();
            room.changed();
        },
        RTC_CONNECTION_STATE() {
            scheduleApply();
        },
        SPEAKING() {
            room.uiChanged();
        },
    },

    start() {
        startEngine();
    },

    stop() {
        stopEngine();
    },
});
