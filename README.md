# RetroSave

A zero-dependency 1986 cartridge ROM disassembly, deterministic dungeon crawler, and speedrun replay verification workbench built in pure JavaScript. The browser page boots directly into a playable 960x600 Floor 1 dungeon alongside a live technical datasheet that tracks 32-bit FNV-1a seed hashes, Mulberry32 floor states, breadth-first search (BFS) flood-fill connectivity, sparse 7-bit input delta streams, and a 72-byte CHR-ROM 8x8 sprite bitmask table.

Built for Hack Club Retrospect and Game Lab / FlavorTown.

## Quick Start

Open `index.html` directly in any browser or serve the folder statically:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

The dungeon viewport boots immediately on Floor 1 with seed `RETROSAVE-1986`. Use the top control bar to load any seed string, pause or single-step the 60 Hz simulation (`Period` key `.`), verify `RSAVE1` replay tokens, or hot-patch 8x8 CHR-ROM bitmasks.

## Technical Datasheet Sections

- **SEC 01A // Seed PRNG & Floor BFS Verification**: Hashes the seed string via 32-bit FNV-1a (`hashSeed(seed)`) and mixes the floor index with the golden-ratio constant (`Math.imul(levelIndex + 1, 0x9e3779b1)`) to initialize a 32-bit Mulberry32 PRNG. Carves non-overlapping rectangular rooms joined by L-corridors and runs `levelReachable(level)` to verify 100% flood-fill connectivity between spawn, pickups, enemies, and exit.
- **SEC 01B // 60 Hz Simulation & Input Delta Stream**: Steps `stepSim(sim, mask)` at a fixed `1/60` second delta (`16.667 ms`) with axis-separated `moveRect` collision resolution so diagonal movement slides cleanly along walls. Tracks the 7-bit input mask (`UP=1, DOWN=2, LEFT=4, RIGHT=8, SHOOT=16, DASH=32, START=64`) and counts sparse `[frame, mask]` transition points.
- **SEC 01C // CHR-ROM 8x8 Sprite Bitmask Table**: Displays all nine 8x8 monochrome sprite bitmasks (`0x0000..0x0040`, 72 bytes total) in slash-delimited hexadecimal row format. Clicking any row loads that symbol into the dihedral `D4` sprite editor.
- **SEC 02 // FNV-1a Delta Replay Verifier (`RSAVE1.<base64>.<fnv1a>`)**: Compresses per-frame inputs into change points (`compressFrames`), encodes the JSON record in custom ASCII Base64, and signs the payload with a 32-bit FNV-1a checksum. Flipping a single character in a replay string causes `parseReplay` to reject the record with `null`.
- **SEC 03 // 8x8 CHR-ROM Bitmask Editor**: Paint 8x8 bitmasks, inspect hex rows, apply `flipSprite(px, 'x'|'y')` and `rotateSprite(px)` (90 degrees clockwise), export JSON sheets, or patch the live player sprite in memory.
- **SEC 04 & 05 // Local Score Ledger (`RSCORE1`) & PSG Synth Scope**: Stores checksummed local high scores and provides an opt-in Web Audio API square/sawtooth/triangle synthesizer that remains strictly muted (`AudioContext` uninstantiated and master gain at `0`) until clicked.

## Controls

| Action | Keys |
| --- | --- |
| Move | `WASD` / Arrow keys / Gamepad stick |
| Fire | `Space` / `J` / `Z` / Gamepad `A` |
| Dash (3.2x step) | `Shift` / `K` / `X` / Gamepad `B` |
| Pause / Resume | `Esc` / `Enter` / `P` |
| Step +1 Frame (16.67 ms) | `.` (Period) or `STEP +1F` button |
| 8x8 CHR-ROM Editor | `E` |
| PSG Spectrum Scope | `V` |
| Toggle PSG Audio | `M` |

## Repository Layout

| File | Purpose |
| --- | --- |
| `index.html` | Technical datasheet layout, playable 960x600 viewport, and live telemetry tables. |
| `style.css` | Archival parchment (`data-sheet="parchment"`) and charcoal bench (`data-sheet="charcoal"`) styling with 1px tabular borders. |
| `game.js` | Pure `RetroSaveCore` UMD module (Node + Browser) plus the HTML5 Canvas loop and datasheet inspector. |
| `test.js` | 49 automated unit and property tests using `node:test` and `node:assert/strict`. |
| `LICENSE` | MIT license. |

## Verification Suite (49/49 Tests)

Run the headless test suite with Node's built-in test runner:

```sh
node --test test.js
```

All 49 tests verify `RetroSaveCore` directly: FNV-1a reference vectors (`fnv1a("hello") === "4f9f2cab"`), Mulberry32 stream reproducibility and fork isolation, ASCII Base64 round-trips across all lengths, strict vs tangent AABB/circle collisions, axis-separated `moveRect` corner sliding, 8x8 hex/binary sprite parsing and dihedral group identities (`4x rotate === id`, `2x flip === id`), 128-state input bitmask bijection, BFS connectivity across 96 multi-floor dungeons, and single-byte tamper rejection on `RSAVE1` and `RSCORE1` records.

## License

MIT. See `LICENSE`.
