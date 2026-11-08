# RetroSave

A zero-dependency CRT dungeon crawler and boss-rush arcade game that runs entirely in the browser. Twelve procedurally generated floors, deterministic seeds, a frame-accurate speedrun clock, shareable replays you can verify, a sprite editor, and a procedural synth visualizer. One canvas, no build step, no libraries.

Built for Hack Club Retrospect and Game Lab / FlavorTown.

## Play

Open `index.html` in any modern browser. There is no install, bundler, or server required. For the cleanest experience you can also serve the folder statically, for example:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`.

GitHub Pages serves the `main` branch at the repository root, so the hosted build works the same way.

## Features

- **Deterministic runs.** The same seed plus the same inputs produces the exact same dungeon, enemies, pickups, and simulation, frame for frame.
- **Replay Lab.** A replay is a seed plus a compressed list of input changes, checksummed with FNV-1a. Copy a run, paste a friend's replay, and race their ghost. A single corrupted character invalidates the record.
- **Local high scores.** Stored in the browser as checksummed records. Nothing leaves your machine.
- **Sprite editor.** Paint an 8x8 bitmask, flip, rotate, export JSON, and apply a custom sprite to the player.
- **Procedural synth and visualizer.** Audio starts muted and is enabled on demand. The visualizer reacts to the generated signal.
- **Keyboard and gamepad.** Fully playable with either, plus touch-friendly editor controls.

## Controls

| Action | Keys |
| --- | --- |
| Move | WASD / Arrow keys / Stick |
| Fire | Space / J / A |
| Dash | Shift / K / B |
| Pause | Esc / Start |
| Sprite editor | E |
| Visualizer | V |
| Audio toggle | M |

## Project layout

| File | Purpose |
| --- | --- |
| `index.html` | Cabinet markup, HUD, and all UI panels. |
| `style.css` | CRT cabinet, scanlines, panels, editor grid, and responsive layout. |
| `game.js` | Pure `RetroSaveCore` logic plus the browser game loop and rendering. |
| `test.js` | `node:test` suite for the pure core. |
| `LICENSE` | MIT license. |

`game.js` is split into two layers. The `RetroSaveCore` object is dependency free and side-effect free, so it runs both in the browser and under Node. The browser game only boots when a `document` exists, which is why the test suite can `require('./game.js')` directly.

## Core API

The pure core covers:

- Deterministic RNG (`RNG`, `hashSeed`, mulberry32, FNV-1a seed hashing).
- ASCII base64 and checksum helpers (`base64Encode`, `base64Decode`, `fnv1a`).
- Collision detection (`rectsOverlap`, `rectContainsPoint`, `circlesOverlap`, `circleHitsRect`, `clampRectToArena`, `moveRect`).
- Sprite bitmask parsing and transforms (`parseSpriteMask`, `encodeSpriteMask`, `flipSprite`, `rotateSprite`, `countBits`).
- Level generation (`generateLevel`, `levelReachable`, `tileAt`, `isWalkable`).
- Input bitmask helpers (`encodeInput`, `decodeInput`).
- Replay and score serialization (`serializeReplay`, `parseReplay`, `serializeScore`, `parseScore`, `compressFrames`, `expandFrames`).
- The synchronous simulation shared by live play and replay (`makeSim`, `stepSim`, `playerRect`, `tileBlocked`, `formatTime`).

Example:

```js
const Core = require('./game.js');

// Same seed and index always produce the same dungeon.
const level = Core.generateLevel('RETROSAVE-1986', 0);
console.log(Core.levelReachable(level).connected); // true

// Parse an 8x8 sprite bitmask.
const sprite = Core.parseSpriteMask('3c/7e/db/ff/ff/db/7e/3c');
console.log(sprite.bitcount); // 48

// Round trip a replay with checksum validation.
const record = Core.serializeReplay({ seed: 'RACE', frames: [0, 0, 1, 1, 16, 0] });
console.log(Core.parseReplay(record).frames); // [0, 0, 1, 1, 16, 0]
```

## Tests

The suite uses the built-in Node test runner, so there are no dev dependencies.

```
node --test test.js
```

It covers:

- Collision detection, including edge contact, tangency, clamping, and axis-by-axis movement.
- Deterministic RNG: reproducibility, bounds, distribution, forks, and the FNV-1a reference vector.
- Level generator: determinism, connectivity across many seeds and floors, spawn/exit/boss tiles, and out-of-bounds handling.
- Score and replay serializers: round trips, compression, normalization, and rejection of corrupted or mistagged records.
- Sprite bitmask parser: hex and binary rows, separators, transforms, and validation errors.
- The simulation: deterministic stepping, survival scoring, and time formatting.

Run the suite before shipping any change to `game.js`. All tests pass with `node --test test.js`.

## How determinism works

Every floor is generated from `hashSeed(seed) ^ levelIndex`, so a seed fully determines the dungeon layout, enemy placement, and pickups. Inputs are captured as a 7-bit mask per frame and compressed into change points. Replays store the seed, frame count, metadata, and those change points. On playback the simulation expands the change points back into a full per-frame input stream and re-runs the exact same fixed-step logic. FNV-1a checksums on the record catch any tampering or corruption.

## License

MIT. See `LICENSE`.
