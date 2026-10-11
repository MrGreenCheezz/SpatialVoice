<div align="center">

# 🎧 SpatialVoice

**3D spatial audio for Discord voice channels.**

Place people in a virtual room and hear each voice from where they stand:
left or right, in front or behind, near or far.

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Vencord plugin](https://img.shields.io/badge/Vencord-plugin-a6d189.svg)](https://vencord.dev)
![Platform: Discord desktop](https://img.shields.io/badge/platform-Discord%20desktop-5865f2.svg)
![Status: experimental](https://img.shields.io/badge/status-experimental-orange.svg)

**English** · [Русский](README.ru.md)

</div>

---

SpatialVoice is a [Vencord](https://vencord.dev) plugin that turns a flat voice call into a shared virtual space.
It needs no audio routing, virtual cables or extra software: it uses the Steam Audio engine that already ships
inside Discord's own voice module, so voices are spatialized natively, with no added latency.

When several people in the same voice channel run the plugin, they share one room: everyone moves their own
avatar, and the layout stays in sync for all of them.

## ✨ Features

- **True 3D audio (HRTF).** Direction, front/back cues, distance attenuation and air absorption, all rendered by
  Discord's built-in Steam Audio engine.
- **Interactive room map.** Drag avatars around, scroll to turn, and see who is speaking.
- **Shared rooms.** Positions sync in real time between plugin users through a tiny self-hostable relay.
  People without the plugin can be placed by anyone, and their positions are shared too.
- **Zero added latency.** Audio never leaves Discord's engine. The plugin only sends it coordinates.
- **Privacy-friendly sync.** The relay only ever sees coordinates, user IDs and a hash of the channel ID, never audio.
- **Graceful fallback.** If 3D audio is unavailable, the plugin falls back to stereo panning with distance-based volume.

## 🧠 How it works

Discord's desktop client decodes and mixes voice in a native module, so the audio never reaches JavaScript
and can't be processed by a plugin directly. However, that module embeds **Steam Audio**, which Discord uses
for its own unreleased spatial audio feature. SpatialVoice feeds the engine a position for every participant
(`setUserPosition`), relative to where you stand and which way you face, and the engine does the rest.

```
┌─ Discord + Vencord ───────────────────┐         ┌─ Relay (optional) ──────┐
│ SpatialVoice                          │   WS    │ rooms keyed by a hashed │
│  • room map UI                        │◄───────►│ channel ID, broadcasts  │
│  • positions → native Steam Audio     │         │ positions only          │
└───────────────────────────────────────┘         └─────────────────────────┘
```

The reverse-engineering notes on the Discord internals involved are in [NOTES.md](NOTES.md).

## 📦 Installation

**Requirements:** the official Discord desktop client, [Git](https://git-scm.com) and [Node.js](https://nodejs.org) 18+.

Vencord can't load third-party plugins at runtime: plugins are compiled into Vencord itself. So SpatialVoice is
installed by building Vencord from source with the plugin included. Your existing Vencord settings and plugins are kept.

Run all commands from the same parent folder.

**1. Clone Vencord and SpatialVoice side by side**

```bash
git clone https://github.com/Vendicated/Vencord
```

```bash
git clone https://github.com/MrGreenCheezz/SpatialVoice
```

**2. Install Vencord's dependencies**

```bash
npm i -g pnpm
```

```bash
pnpm -C Vencord install --frozen-lockfile
```

**3. Add the plugin and build**

```bash
node SpatialVoice/install-plugin.mjs Vencord
```

```bash
pnpm -C Vencord build
```

**4. Inject the build into Discord.** This is needed only once. Fully quit Discord first, including the tray icon.

```bash
pnpm -C Vencord inject
```

**5. Enable it.** Start Discord and turn on **SpatialVoice** in *Settings → Vencord → Plugins*.

<details>
<summary><b>Updating</b></summary>

```bash
git -C SpatialVoice pull
```

```bash
node SpatialVoice/install-plugin.mjs Vencord
```

```bash
pnpm -C Vencord build
```

Then press `Ctrl+R` in Discord. There's no need to inject again.
</details>

<details>
<summary><b>Uninstalling</b></summary>

Disable the plugin in Vencord's settings. To go back to stock Vencord, reinstall it with the
[official installer](https://vencord.dev/download).
</details>

## 🎮 Usage

1. Join a voice channel.
2. Open the room in any of these ways:
   - right-click the channel → **Пространственная комната** (*Spatial room*);
   - type `/spatial` in any chat;
   - use the Vencord Toolbox.
3. Drag avatars to place people. Scroll over the map to turn. The arrow shows where you're facing.

The status line under the map shows the active mode: **3D-звук (HRTF)** or **стереопанорама** (stereo fallback).

### Settings

| Setting | Description |
|---|---|
| Sync server | Relay URL (`ws://…` or `wss://…`). Leave empty for a local-only room. |
| Room size | Size of the map, in meters. |
| Distance attenuation | Voices get quieter with distance. |
| Min distance | Distance within which volume doesn't drop. |
| Air absorption | Muffles high frequencies for distant voices. |
| Reflections | Room echo (experimental, CPU-heavy). |
| Force stereo | Use simple stereo panning instead of 3D. |

> The plugin UI is currently in Russian. Translations are welcome.

## 🌐 Shared rooms: self-hosting the relay

The relay is a single file with no dependencies, so any machine with Node.js 18+ can run it:

```bash
node server/server.js
```

- It listens on port `8787` by default. Set `PORT` and `HOST` to change that.
- Everyone in the group sets the same URL in the plugin settings, e.g. `ws://your-host:8787`.
- For use over the internet, put it behind a TLS reverse proxy (nginx, Caddy) and use `wss://`.
- On first connect, Vencord asks to allow the server's domain. Restart Discord afterwards.
- Run the relay's tests with `npm test` in `server/` (requires Node.js 20.10+).

## 🛠️ Troubleshooting

**The status says "стереопанорама" (stereo) instead of 3D.** Open the console (`Ctrl+Shift+I`) and run:

```js
Vencord.Webpack.findStore("MediaEngineStore").supports("SPATIAL_AUDIO")
```

```js
Vencord.Webpack.findStore("SpatialAudioStore").getSpatialAudioStatus()
```

| Result | Meaning |
|---|---|
| `supports` returns `false` | Your Discord build's voice module doesn't enable 3D audio. Stereo mode is used instead. |
| Status `2` | Your output device is in mono. Switch it to stereo. |
| Status `3` or `4` | The engine or HRTF failed to initialize. Restart Discord or try another output device. |

**The menu item doesn't appear.** It only shows on the voice channel you're currently connected to.

## ❓ FAQ

**Does everyone need the plugin?**
No. Spatialization happens on the listener's side. People without the plugin hear the call normally and can
still be placed in your room. Only plugin users hear the room in 3D.

**Does it add latency?**
No. Audio is processed by Discord's own engine exactly as usual; the plugin only updates positions.

**Is my voice sent anywhere?**
No. The relay only carries coordinates. Without a sync server configured, nothing leaves your machine.

**Does it work in the browser or Vesktop?**
Not yet. Those clients use a different (WebRTC-based) audio pipeline.

**Is this allowed by Discord?**
Client modifications are against [Discord's Terms of Service](https://discord.com/terms). Use at your own risk.

## 🗺️ Roadmap

- [ ] A companion app that works without Vencord via Discord's local RPC (stereo only)
- [ ] A bot plus web listener, to give true 3D to people without a client mod
- [ ] Moving to Discord's official spatial audio API for Activities once it becomes public
- [ ] English UI and translations
- [ ] Authentication on the relay (Discord OAuth)

## 🤝 Contributing

Issues and pull requests are welcome. If something broke after a Discord update, please open an issue with
your Discord version (*Settings → bottom of the sidebar*) and any console errors that mention `SpatialVoice`.

## 📄 License

[GPL-3.0-or-later](LICENSE), the same as Vencord, which the plugin is compiled into.

SpatialVoice is not affiliated with or endorsed by Discord Inc. or Valve.
