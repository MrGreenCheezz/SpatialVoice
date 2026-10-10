# Discord internals: spatial voice (Discord desktop 1.0.9261, October 2026)

Discovered by reading `modules/discord_voice-2/discord_voice/index.js`, strings in
`discord_voice.node`, and the client web bundle from the local cache.

## Native voice engine (discord_voice.node)

- Built-in **Steam Audio**: HRTF/binaural, distance attenuation, air absorption,
  reflections with room geometry (`spatial_mixer.cpp`).
- On the voice connection object:
  - `setUserPosition(userId: string, pos: {x, y, z})`: source position **relative to the listener**.
    The listener sits at the origin: +x right, +y up, **-z ahead**. Default `{x:0, y:0, z:-1}`.
  - `setLocalPan(userId, left, right)`: plain stereo panning (fallback).
  - `setLocalVolume(userId, volume)`.
- Engine-wide mixer options: `VoiceEngine.setTransportOptions({ audioMixerOptions })`.
- Support flag: `VoiceEngine.isSpatialAudioEnabled()`; the `spatial_audio` feature is declared only when it returns true.

## Web client (JS)

- `MediaEngineStore.supports("SPATIAL_AUDIO")`: spatial audio is available. The JS enum `MediaEngineFeatures` is
  upper case and maps to the lower-case native flag; `supports("spatial_audio")` always returns false.
- `SpatialAudioStore`: `getActiveSpatialAudioOptions()`, `getSpatialAudioStatus()`
  (status enum: `MONO_OUTPUT=2`, `HRTF_FAILED=4`, ...).
- `AudioActionCreators.setSpatialAudioOverrides(overrides)` → `AUDIO_SET_SPATIAL_AUDIO_OVERRIDES`
  → deep-merged with the defaults → `mediaEngine.setAudioMixerOptions(...)`.
- `AudioActionCreators.setLocalPan(...)` dispatches `AUDIO_SET_LOCAL_PAN` and **persists** it to settings (`localPans`).
  To avoid leaving persisted state behind, the plugin should call `connection.setLocalPan` directly.
- `MediaEngineStore.getMediaEngine().eachConnection(cb, context)`: iterate voice connections
  (`context` "default" = voice, "stream" = Go Live).

Default mixer options:

```js
{
  isSpatial: false, limiterEnabled: true,
  binaural: { spatialBlend: 1, bilinearInterpolation: false, hrtfVolume: 1, hrtfNormalization: false },
  distanceAttenuation: { enabled: false, minDistance: 1 },
  airAbsorption: { enabled: false, coefficients: { low: 2e-4, mid: .0017, high: .0182 } },
  reflections: { enabled: false, durationSeconds: 2, numRays: 4096, numBounces: 32, irradianceMinDistance: 1,
    binauralDecode: true,
    room: { minCorner: {x:-2.5,y:-2.5,z:-2.5}, maxCorner: {x:2.5,y:2.5,z:2.5},
      floor:   { absorption: {low:.24, mid:.69, high:.73}, scattering: .05 },
      ceiling: { absorption: {low:.05, mid:.07, high:.08}, scattering: .05 },
      walls:   { absorption: {low:.1,  mid:.2,  high:.3 }, scattering: .05 } } }
}
```

## How Discord's own coordinator does it (Activities RPC `UPDATE_VOICE_SPATIAL`)

1. `setSpatialAudioOverrides({ isSpatial: true, distanceAttenuation: {enabled: true}, airAbsorption: {enabled: true} })`
2. Input: listener `{position, forward}` and sources `[{user_id, position}]` in world coordinates.
3. Build a basis from `forward`: right = normalize(forward × up), up' = right × forward.
   rel = src - listener.pos → `{x: rel·right, y: rel·up', z: -(rel·forward)}`; if |rel| < 0.001, use `{0, 0, -0.001}`.
4. `connection.setUserPosition(userId, rel)`, throttled to 50 ms, max 50 sources, ≤20 updates/s.
5. On disable: reset positions to `{x:0, y:0, z:-1}` and clear the overrides with `setSpatialAudioOverrides({})`.

## Why not proxy the audio

In the desktop client, remote audio is decoded and mixed inside the native module and goes straight
to the output device. The PCM never reaches JS/Web Audio, so a JS plugin can't intercept it.
It doesn't need to: the engine already does HRTF natively, with no added latency.
