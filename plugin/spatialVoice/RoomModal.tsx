/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { RenderModalProps } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, Modal, openModal, React, useEffect, useReducer, useRef, UserStore,useState } from "@webpack/common";

import { getAudioMode, spatialSupported } from "./audio";
import { moveSelf, placeUser } from "./engine";
import { settings } from "./settings";
import { getMyId, getParticipants, getPos, normalizeAngle, room } from "./state";

const SpeakingStore = findStoreLazy("SpeakingStore");

const ROTATE_STEP = Math.PI / 12;

function cl(...names: (string | false | null | undefined)[]) {
    return names.filter(Boolean).join(" ");
}

function useRoomUpdates() {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
    useEffect(() => room.onUi(forceUpdate), []);
}

function displayName(userId: string, guildId: string | undefined) {
    const user = UserStore.getUser(userId);
    return (guildId && GuildMemberStore.getNick(guildId, userId)) || user?.globalName || user?.username || userId;
}

function avatarUrl(userId: string, guildId: string | undefined) {
    const user = UserStore.getUser(userId);
    try {
        return user?.getAvatarURL?.(guildId, 64) ?? "";
    } catch {
        return "";
    }
}

function statusLine() {
    const mode = getAudioMode() ?? (!settings.store.forceStereo && spatialSupported() ? "spatial" : "stereo");
    const audio = mode === "spatial" ? "3D-звук (HRTF)" : "стереопанорама";
    const sync = {
        off: "синхронизация выключена",
        connecting: "подключение к серверу…",
        online: `синхронизировано, с плагином: ${room.pluginUsers.size + 1}`,
        error: "сервер недоступен, переподключаюсь…",
    }[room.syncStatus];
    return `${audio} · ${sync}`;
}

function RoomMap({ channelId }: { channelId: string; }) {
    const { roomSize } = settings.use(["roomSize"]);
    const mapRef = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState<string | null>(null);

    const me = getMyId();
    const participants = getParticipants(channelId);
    const guildId: string | undefined = ChannelStore.getChannel(channelId)?.guild_id;
    const synced = room.syncStatus === "online";

    const canDrag = (id: string) => id === me || !(synced && room.pluginUsers.has(id));

    const toMeters = (e: React.PointerEvent) => {
        const r = mapRef.current!.getBoundingClientRect();
        return {
            x: ((e.clientX - r.left) / r.width - 0.5) * roomSize,
            y: ((e.clientY - r.top) / r.height - 0.5) * roomSize,
        };
    };

    const rotateSelf = (delta: number) => {
        if (!me) return;
        const p = getPos(me, getParticipants(channelId));
        moveSelf({ ...p, a: normalizeAngle(p.a + delta) });
    };

    // Native listener: React's onWheel is passive and can't stop the modal from scrolling.
    useEffect(() => {
        const el = mapRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            rotateSelf(Math.sign(e.deltaY) * ROTATE_STEP);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [channelId, me]);

    const onPointerDown = (e: React.PointerEvent, id: string) => {
        if (!canDrag(id)) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(id);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragging) return;
        const m = toMeters(e);
        if (dragging === me) moveSelf({ ...m, a: getPos(me, participants).a });
        else placeUser(dragging, { ...m, a: 0 });
    };

    const faceCenter = () => {
        if (!me) return;
        const p = getPos(me, participants);
        if (Math.hypot(p.x, p.y) < 0.01) return;
        moveSelf({ ...p, a: normalizeAngle(Math.atan2(-p.x, p.y)) });
    };

    const half = roomSize / 2;
    const toPercent = (v: number) => (Math.max(-half, Math.min(half, v)) / roomSize + 0.5) * 100;
    const cell = `${100 / roomSize}% ${100 / roomSize}%`;

    return (
        <div className="vc-spatial-body">
            <div
                ref={mapRef}
                className="vc-spatial-map"
                style={{ backgroundSize: cell }}
                onPointerMove={onPointerMove}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
            >
                {participants.map(id => {
                    const p = getPos(id, participants);
                    const isMe = id === me;
                    const speaking = SpeakingStore.isSpeaking?.(id) === true;
                    return (
                        <div
                            key={id}
                            className={cl(
                                "vc-spatial-user",
                                isMe && "vc-spatial-me",
                                speaking && "vc-spatial-speaking",
                                canDrag(id) && "vc-spatial-draggable",
                                dragging === id && "vc-spatial-dragging"
                            )}
                            style={{ left: `${toPercent(p.x)}%`, top: `${toPercent(p.y)}%` }}
                            onPointerDown={e => onPointerDown(e, id)}
                        >
                            {isMe && <div className="vc-spatial-facing" style={{ transform: `rotate(${p.a}rad)` }} />}
                            <img className="vc-spatial-avatar" src={avatarUrl(id, guildId)} draggable={false} alt="" />
                            <div className="vc-spatial-name">
                                {room.pluginUsers.has(id) && <span className="vc-spatial-dot" title="с плагином" />}
                                {isMe ? "Ты" : displayName(id, guildId)}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="vc-spatial-footer">
                <div className="vc-spatial-status">{statusLine()}</div>
                <div className="vc-spatial-hint">
                    Тащи аватары мышью, колесо над картой поворачивает тебя. Стрелка показывает, куда ты смотришь.
                    {synced && " Тех, у кого есть плагин, двигают только они сами."}
                </div>
                <div className="vc-spatial-buttons">
                    <button className="vc-spatial-button" onClick={() => rotateSelf(-ROTATE_STEP)}>⟲ Повернуть</button>
                    <button className="vc-spatial-button" onClick={() => rotateSelf(ROTATE_STEP)}>Повернуть ⟳</button>
                    <button className="vc-spatial-button" onClick={faceCenter}>Лицом к центру</button>
                </div>
            </div>
        </div>
    );
}

function RoomModal(props: RenderModalProps) {
    useRoomUpdates();
    const { channelId } = room;
    return (
        <Modal
            {...props}
            size="md"
            title="Пространственная комната"
            actions={[{ text: "Готово", variant: "primary", onClick: props.onClose }]}
        >
            {channelId
                ? <RoomMap channelId={channelId} />
                : <div className="vc-spatial-empty">Зайди в голосовой канал, и здесь появится комната.</div>}
        </Modal>
    );
}

export function openRoomModal() {
    openModal(props => <RoomModal {...props} />);
}
