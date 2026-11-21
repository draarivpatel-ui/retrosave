# RetroSave

An original JavaScript dungeon game with seeded floors, replay diagnostics, and an 8 by 8 sprite editor. Open [index.html](index.html) directly in a browser. It uses no emulator, external assets, dependency install, build step, or server.

## Play and inspect

The page starts on floor 1 with seed RETROSAVE-1986. Seeds are case-sensitive and may contain Unicode. The URL option `?seed=your-seed` loads a seed; invalid values use the default. The game accepts 1 to 128 seed characters without control characters. The Daily dungeon button loads RETROSAVE-DAILY-YYYY-MM-DD so every player on a given day clears the same floors and can compare scores directly.

- Clear 12 connected room-and-corridor floors, with bosses on floors 3, 6, 9, and 12.
- Move on a 60 Hz fixed simulation clock. Swept movement prevents skipping tile walls and permits sliding on a free axis.
- Fire in the facing direction, including vertical and diagonal shots at the same bullet speed.
- Dash at 3.2 times normal movement for one step, with a 60-frame cooldown and ten frames of invulnerability.
- Inspect seed hashes, floor PRNG seeds, reachable tiles, shortest exit paths, player state, and input changes.
- Pause, consume one input frame at a time, export a replay, or inspect a token's final state without changing the live run.
- Edit, transform, import, and export sprite sheets. Apply their pixels and color to the player's appearance.
- Keep the highest eight completed live scores locally. Replaying a token does not add a score.
- Use keyboard, gamepad, or held touch controls. Disabled gamepad/storage/audio access falls back without stopping the game.

Enemies and bosses stay on their spawn tiles and deal contact damage. Health pickups add one HP up to five; score and bonus pickups award 250 and 100 points. Floors and defeated enemies also award points. The clock counts every consumed frame, including a fatal frame.

## Controls

| Action | Input |
| --- | --- |
| Move | WASD, arrow keys, gamepad stick/D-pad, or touch arrows |
| Fire | Space, J, Z, gamepad A, or touch Fire |
| Dash | Shift, K, X, gamepad B, or touch Dash |
| Pause / resume | Esc, Enter, P, or the pause button |
| Step one frame | Period (.) or the step button |
| Sprite editor | E |
| Procedural signal display | V |
| Toggle synth audio | M or the audio button |

The game pauses when the window loses focus or becomes hidden. Key repeat does not toggle pause repeatedly. Typing into a text field does not send movement keys. During replay, single stepping consumes the next saved input.

Audio is muted on startup. No AudioContext is created until explicitly enabled. The signal display is a procedural 48-bar animation independent of audio; it is not a measured spectrum analyzer.

## Replay format and verification

An RSAVE1 token contains Base64-encoded JSON with a 32-bit FNV-1a checksum:

```text
RSAVE1.<base64>.<checksum>
```

The payload contains version 1, the exact seed, frame count, metadata, and strictly increasing `[frame, mask]` transitions. Inputs use seven bits: UP=1, DOWN=2, LEFT=4, RIGHT=8, SHOOT=16, DASH=32, and reserved START=64.

New exports include engineVersion 2.1.0, score, floor, and a final simulation state digest. Exports contain exactly the consumed input prefix, including zero frames before play. Unicode payload strings are escaped into an ASCII wire document, and seed hashes use UTF-8 FNV-1a.

The inspector validates the token, resimulates it, and reports consumed/trailing frames, score, floor, and digest comparisons. The state digest includes future-relevant player, floor, enemy, pickup, boss, and bullet state; it excludes event queues and rendering effects.

Validation rejects malformed Base64, noncanonical payload text, invalid versions, numeric coercion, fractional or excessive frame counts, invalid masks, unordered/duplicate/out-of-range transitions, and malformed metadata. Limits are 216000 frames (one hour), 4 MiB of token text, and 4096 characters of metadata.

Tokens naming another engine version are rejected for playback. Legacy version 1 tokens without an engineVersion can be parsed and simulated under current rules. Their original final state cannot be confirmed without a reference digest. Engine 2.0.0 changes shooting, collision, invulnerability, fatal-frame accounting, Unicode hashing, and final-floor handling.

FNV-1a is a corruption checksum, not an authentication signature or protection against deliberate editing. A checksummed score is not independent proof of a legitimate run.

## Sprite sheets and scores

Sprite sheets use schema `retrosave/sprite`, version 1, with name, 8 by 8 dimensions, eight rows, matching normalized hex, and a six-digit color. Numeric rows are actual byte values; hex and eight-bit binary strings are also accepted. Non-binary pixels, conflicting rows/hex, bad dimensions, and invalid colors are rejected. JSON import is limited to 8192 characters.

RSCORE1 records validate initials, numeric score/floor/time bounds, seed text, and calendar dates before rendering. Local ledger input is capped at 64 KiB, sorted by score, and limited to eight entries. Storage is optional.

## Node usage

```js
const C = require('./game.js');
const sim = C.makeSim('MiXeD café');
const frames = [0, C.INPUT.RIGHT, C.INPUT.SHOOT, 0];
for (const mask of frames) C.stepSim(sim, mask);
const token = C.serializeReplay({
  seed: sim.seed,
  frames,
  meta: {
    engineVersion: C.ENGINE_VERSION,
    stateDigest: C.simulationDigest(sim),
    score: sim.score,
    level: sim.levelIndex + 1
  }
});
console.log(C.verifyReplay(token).stateMatches); // true
console.log(C.findPath(sim.level).length - 1); // shortest tile route length
```

The browser console also exposes RetroSave with start, step, exportReplay, importReplay, and inspectReplay. The public step method records its consumed input.

## Verification

Run from this repository:

```sh
node --test
```

**96 tests pass, with zero failures or skipped tests.** Tests cover FNV-1a references and UTF-8, reproducible Mulberry32 streams, Base64 and token parsing, one-hour boundaries, sprite byte/pixel validation and transforms, JSON sheets, connected bounded dungeons, BFS paths, wall sweeps, shot direction, single-target damage, invulnerability duration, fatal frames, floor 12 victory, score validation, and replay state reproduction.

The UI tests execute the actual HTML and game controller with [dom-harness.cjs](dom-harness.cjs). They cover startup, DOM references, Canvas calls with finite coordinates, fixed-step recording, exact seed preservation, pause/typing behavior, replay prefix stepping, inspection without mutation, touch input, sprite downloads/imports, themes, optional audio/gamepad/storage, and score ledger behavior. This harness does not verify browser layout, visual appearance, or real audio/gamepad hardware.

| File | Purpose |
| --- | --- |
| [game.js](game.js) | Pure RetroSaveCore API plus browser controller and Canvas rendering |
| [index.html](index.html), [style.css](style.css) | Workbench, accessible controls, and responsive styles |
| [test.js](test.js), [regression.test.js](regression.test.js), [ui.test.js](ui.test.js) | Automated verification |

## License

MIT. See [LICENSE](LICENSE).
