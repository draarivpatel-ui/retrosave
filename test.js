/*
 * RetroSave - comprehensive test suite for the pure Core logic.
 * Run with: node --test test.js
 *
 * game.js exports the dependency free Core object under Node and only boots
 * the browser game when a document exists, so requiring it here is safe.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./game.js');

/* ------------------------------------------------------------------ */
/* 0. Module surface                                                   */
/* ------------------------------------------------------------------ */

test('Core exposes the expected pure API', () => {
  assert.equal(typeof C, 'object');
  const required = [
    'hashSeed', 'RNG', 'base64Encode', 'base64Decode', 'fnv1a',
    'SPRITE_SIZE', 'parseSpriteMask', 'encodeSpriteMask', 'flipSprite',
    'rotateSprite', 'countBits', 'rectsOverlap', 'rectContainsPoint',
    'circlesOverlap', 'circleHitsRect', 'clampRectToArena', 'moveRect',
    'INPUT', 'encodeInput', 'decodeInput', 'TILE', 'tileAt', 'isWalkable',
    'generateLevel', 'levelReachable', 'compressFrames', 'expandFrames',
    'serializeReplay', 'parseReplay', 'serializeScore', 'parseScore',
    'DEFAULT_SPRITES', 'PALETTE', 'FIXED_DT', 'makeSim', 'stepSim',
    'playerRect', 'tileBlocked', 'formatTime'
  ];
  for (const key of required) {
    assert.ok(key in C, 'missing Core export: ' + key);
    assert.notEqual(C[key], undefined, 'undefined Core export: ' + key);
  }
});

/* ------------------------------------------------------------------ */
/* 1. Deterministic RNG (mulberry32 + FNV-1a seed hash)               */
/* ------------------------------------------------------------------ */

test('hashSeed is stable, 32-bit, and string based', () => {
  assert.equal(C.hashSeed('abc'), C.hashSeed('abc'));
  assert.notEqual(C.hashSeed('abc'), C.hashSeed('abd'));
  const h = C.hashSeed('RETROSAVE-1986');
  assert.equal(h >>> 0, h, 'hash must be an unsigned 32-bit integer');
  assert.ok(h >= 0 && h <= 0xffffffff);
  // String coercion: passing a number still yields a defined 32-bit value.
  const hn = C.hashSeed(12345);
  assert.equal(hn >>> 0, hn);
});

test('hashSeed matches the FNV-1a reference for a known input', () => {
  // FNV-1a 32-bit of "hello" is 0x4f9f2cab.
  assert.equal(C.hashSeed('hello').toString(16), '4f9f2cab');
  // And fnv1a() is the same function rendered as an 8 char hex string.
  assert.equal(C.fnv1a('hello'), '4f9f2cab');
  assert.equal(C.fnv1a('RETROSAVE-1986'),
    (C.hashSeed('RETROSAVE-1986') >>> 0).toString(16).padStart(8, '0'));
});

test('RNG with the same seed produces identical streams', () => {
  const a = new C.RNG('SEED-42');
  const b = new C.RNG('SEED-42');
  for (let i = 0; i < 500; i += 1) {
    assert.equal(a.next(), b.next(), 'stream diverged at index ' + i);
  }
});

test('RNG with different seeds produces different streams', () => {
  const a = new C.RNG('SEED-A');
  const b = new C.RNG('SEED-B');
  let differences = 0;
  for (let i = 0; i < 20; i += 1) {
    if (a.next() !== b.next()) differences += 1;
  }
  assert.ok(differences > 0, 'distinct seeds should not yield identical streams');
});

test('RNG numeric seeds are reproducible and stay in [0, 1)', () => {
  const a = new C.RNG(123456);
  const b = new C.RNG(123456);
  for (let i = 0; i < 20000; i += 1) {
    const v = a.next();
    assert.ok(v >= 0 && v < 1, 'next() out of range: ' + v);
    assert.equal(v, b.next());
  }
});

test('RNG.int respects inclusive min/max bounds', () => {
  const r = new C.RNG(7);
  const seen = new Set();
  for (let i = 0; i < 20000; i += 1) {
    const v = r.int(3, 9);
    assert.ok(Number.isInteger(v));
    assert.ok(v >= 3 && v <= 9, 'int out of range: ' + v);
    seen.add(v);
  }
  assert.equal(seen.size, 7, 'all values in [3, 9] should appear');
  assert.equal(r.int(5, 5), 5, 'degenerate range returns the bound');
});

test('RNG.float stays within bounds and chance/fork are consistent', () => {
  const r = new C.RNG('fork-test');
  for (let i = 0; i < 5000; i += 1) {
    const v = r.float(-2, 3);
    assert.ok(v >= -2 && v < 3, 'float out of range: ' + v);
  }
  // chance boundaries
  assert.equal(new C.RNG(1).chance(0), false);
  assert.equal(new C.RNG(1).chance(1), true);
  // fork is deterministic for the same parent state and label
  const p1 = new C.RNG('parent');
  const p2 = new C.RNG('parent');
  p1.next(); p1.next();
  p2.next(); p2.next();
  const f1 = p1.fork('room');
  const f2 = p2.fork('room');
  assert.equal(f1.next(), f2.next());
  // Different labels diverge from the same parent state.
  const p3 = new C.RNG('parent');
  p3.next(); p3.next();
  const f4 = p3.fork('other');
  assert.notEqual(f1.state, f4.state);
});

test('RNG.pick always returns an element of the array', () => {
  const r = new C.RNG('pick');
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const v = r.pick(arr);
    assert.ok(arr.includes(v));
    seen.add(v);
  }
  assert.equal(seen.size, arr.length);
});

/* ------------------------------------------------------------------ */
/* 2. Pure base64 and checksum helpers                                 */
/* ------------------------------------------------------------------ */

test('base64Encode/Decode round trip ASCII payloads of every length', () => {
  for (let len = 0; len < 64; len += 1) {
    let s = '';
    for (let i = 0; i < len; i += 1) s += String.fromCharCode(33 + (i % 90));
    assert.equal(C.base64Decode(C.base64Encode(s)), s, 'round trip failed at length ' + len);
  }
  assert.equal(C.base64Encode(''), '');
  assert.equal(C.base64Decode(''), '');
});

test('base64Encode matches known reference vectors', () => {
  assert.equal(C.base64Encode('f'), 'Zg==');
  assert.equal(C.base64Encode('fo'), 'Zm8=');
  assert.equal(C.base64Encode('foo'), 'Zm9v');
  assert.equal(C.base64Encode('RetroSave'), 'UmV0cm9TYXZl');
});

test('base64Decode ignores stray non alphabet characters', () => {
  // Whitespace and punctuation outside the alphabet are stripped before decoding.
  assert.equal(C.base64Decode(' Z m9v \n'), 'foo');
  assert.equal(C.base64Decode('Z\tg==\n'), 'f');
});

test('base64Encode folds non ASCII characters to a question mark', () => {
  // The encoder is documented as ASCII only; high code points become '?'.
  assert.equal(C.base64Decode(C.base64Encode('☺')), '?');
});

test('fnv1a returns 8 char lowercase hex and detects single bit changes', () => {
  const a = C.fnv1a('RSAVE1.payload');
  const b = C.fnv1a('RSAVE1.payload!');
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notEqual(a, b);
  assert.equal(C.fnv1a(''), '811c9dc5', 'FNV-1a of empty string is the offset basis');
});

/* ------------------------------------------------------------------ */
/* 3. Collision detection                                              */
/* ------------------------------------------------------------------ */

test('rectsOverlap detects true overlap and rejects edge/corner contact', () => {
  const a = { x: 0, y: 0, w: 2, h: 2 };
  assert.equal(C.rectsOverlap(a, { x: 1, y: 1, w: 2, h: 2 }), true, 'partial overlap');
  assert.equal(C.rectsOverlap(a, { x: -1, y: 0, w: 2, h: 2 }), true, 'left overlap');
  assert.equal(C.rectsOverlap(a, a), true, 'self overlap');
  // Touching edges must NOT count as overlap (strict inequality).
  assert.equal(C.rectsOverlap(a, { x: 2, y: 0, w: 2, h: 2 }), false, 'shared x edge');
  assert.equal(C.rectsOverlap(a, { x: 0, y: 2, w: 2, h: 2 }), false, 'shared y edge');
  assert.equal(C.rectsOverlap(a, { x: 2, y: 2, w: 2, h: 2 }), false, 'shared corner');
  assert.equal(C.rectsOverlap(a, { x: 5, y: 5, w: 1, h: 1 }), false, 'fully separate');
});

test('rectsOverlap handles containment in either direction', () => {
  const big = { x: 0, y: 0, w: 10, h: 10 };
  const small = { x: 3, y: 3, w: 2, h: 2 };
  assert.equal(C.rectsOverlap(big, small), true);
  assert.equal(C.rectsOverlap(small, big), true);
});

test('rectContainsPoint is inclusive of all four edges', () => {
  const r = { x: 0, y: 0, w: 2, h: 2 };
  assert.equal(C.rectContainsPoint(r, 0, 0), true, 'top-left corner');
  assert.equal(C.rectContainsPoint(r, 2, 2), true, 'bottom-right corner');
  assert.equal(C.rectContainsPoint(r, 2, 0), true, 'top-right corner');
  assert.equal(C.rectContainsPoint(r, 1, 1), true, 'center');
  assert.equal(C.rectContainsPoint(r, -0.001, 1), false, 'just outside left');
  assert.equal(C.rectContainsPoint(r, 2.001, 1), false, 'just outside right');
  assert.equal(C.rectContainsPoint(r, 1, -0.001), false, 'just outside top');
});

test('circlesOverlap uses squared distance and includes exact tangency', () => {
  assert.equal(C.circlesOverlap({ x: 0, y: 0, r: 1 }, { x: 1, y: 0, r: 1 }), true, 'overlapping');
  assert.equal(C.circlesOverlap({ x: 0, y: 0, r: 1 }, { x: 2, y: 0, r: 1 }), true, 'tangent (<=)');
  assert.equal(C.circlesOverlap({ x: 0, y: 0, r: 1 }, { x: 2.001, y: 0, r: 1 }), false, 'separate');
  assert.equal(C.circlesOverlap({ x: 0, y: 0, r: 1 }, { x: 0, y: 0, r: 1 }), true, 'concentric');
  // Diagonal case, distance sqrt(2) < 2 so still overlapping.
  assert.equal(C.circlesOverlap({ x: 0, y: 0, r: 1 }, { x: 1, y: 1, r: 1 }), true);
});

test('circleHitsRect clamps to the nearest rectangle point', () => {
  const r = { x: 0, y: 0, w: 2, h: 2 };
  assert.equal(C.circleHitsRect(1, 1, 0.1, r), true, 'center inside');
  assert.equal(C.circleHitsRect(0, 0, 0.1, r), true, 'on corner');
  assert.equal(C.circleHitsRect(-0.5, 1, 0.5, r), true, 'tangent to left edge');
  assert.equal(C.circleHitsRect(-0.5, 1, 0.49, r), false, 'just short of left edge');
  assert.equal(C.circleHitsRect(10, 10, 0.1, r), false, 'far away');
  assert.equal(C.circleHitsRect(2.4, 1, 0.5, r), true, 'tangent to right edge');
  assert.equal(C.circleHitsRect(2.6, 1, 0.5, r), false, 'past right edge');
});

test('clampRectToArena keeps a rect fully inside the arena', () => {
  const arena = { x: 0, y: 0, w: 10, h: 10 };
  const r = { x: 99, y: -5, w: 2, h: 2 };
  const c = C.clampRectToArena(r, arena);
  assert.deepEqual(c, { x: 8, y: 0, w: 2, h: 2 });
  // A rect already inside is unchanged.
  assert.deepEqual(C.clampRectToArena({ x: 3, y: 4, w: 2, h: 2 }, arena),
    { x: 3, y: 4, w: 2, h: 2 });
  // Works with a non zero arena origin.
  const c2 = C.clampRectToArena({ x: -100, y: -100, w: 3, h: 3 }, { x: 5, y: 5, w: 10, h: 10 });
  assert.deepEqual(c2, { x: 5, y: 5, w: 3, h: 3 });
  const c3 = C.clampRectToArena({ x: 100, y: 100, w: 3, h: 3 }, { x: 5, y: 5, w: 10, h: 10 });
  assert.deepEqual(c3, { x: 12, y: 12, w: 3, h: 3 });
  // Original rect is not mutated.
  assert.deepEqual(r, { x: 99, y: -5, w: 2, h: 2 });
});

test('moveRect moves one axis at a time and reverts a blocked axis only', () => {
  const r = { x: 0, y: 0, w: 1, h: 1 };
  // Nothing blocked: both axes advance.
  assert.deepEqual(C.moveRect(r, 1, 1, () => false), { x: 1, y: 1, w: 1, h: 1 });
  // Blocked only when x > 0: x reverts, y still advances by its own step.
  const blockedWhenMovedRight = (rect) => rect.x > 0;
  const out = C.moveRect(r, 1, 1, blockedWhenMovedRight);
  assert.equal(out.x, 0, 'x reverted');
  assert.equal(out.y, 1, 'y allowed');
  // Fully blocked: rect does not move and the original is preserved.
  const frozen = C.moveRect(r, 1, 1, () => true);
  assert.deepEqual(frozen, r);
  assert.deepEqual(r, { x: 0, y: 0, w: 1, h: 1 }, 'input rect not mutated');
  // Zero movement with a blocking predicate still returns an equal rect.
  assert.deepEqual(C.moveRect(r, 0, 0, () => true), r);
});

/* ------------------------------------------------------------------ */
/* 4. Sprite bitmask parser (8x8)                                      */
/* ------------------------------------------------------------------ */

test('parseSpriteMask parses 8 hex rows into bytes, pixels, hex, bitcount', () => {
  const s = C.parseSpriteMask(C.DEFAULT_SPRITES.player);
  assert.equal(s.width, 8);
  assert.equal(s.height, 8);
  assert.equal(s.pixels.length, 8);
  assert.equal(s.pixels[0].length, 8);
  assert.equal(s.bytes.length, 8);
  assert.deepEqual(s.bytes, [0x3c, 0x7e, 0xdb, 0xff, 0xff, 0xdb, 0x7e, 0x3c]);
  assert.equal(s.hex, '3c/7e/db/ff/ff/db/7e/3c');
  assert.equal(s.bitcount, 48);
  // First row of 0x3c = 00111100: MSB is the leftmost pixel.
  assert.deepEqual(s.pixels[0], [0, 0, 1, 1, 1, 1, 0, 0]);
  // bitcount equals the sum of all pixel bits.
  let manual = 0;
  for (const row of s.pixels) for (const p of row) manual += p;
  assert.equal(s.bitcount, manual);
});

test('parseSpriteMask accepts binary strings, mixed separators, and arrays', () => {
  const bin = '00111100/00000000/00000000/00000000/00000000/00000000/00000000/00000000';
  const fromBin = C.parseSpriteMask(bin);
  assert.equal(fromBin.hex, '3c/00/00/00/00/00/00/00');
  // Space, comma, semicolon, and slash separators all work.
  assert.deepEqual(
    C.parseSpriteMask('3c 7e db ff ff db 7e 3c').bytes,
    C.parseSpriteMask('3c,7e,db,ff,ff,db,7e,3c').bytes
  );
  assert.deepEqual(
    C.parseSpriteMask('3c;7e;db;ff;ff;db;7e;3c').bytes,
    C.parseSpriteMask('3c/7e/db/ff/ff/db/7e/3c').bytes
  );
  // Array input of tokens (hex or binary, mixed) is accepted.
  const arr = ['3c', '7e', '11011011', 'ff', 'ff', 'db', '7e', '3c'];
  assert.equal(C.parseSpriteMask(arr).hex, '3c/7e/db/ff/ff/db/7e/3c');
  // Numeric tokens are stringified to DECIMAL first. So the number 60 becomes
  // the token "60", which parses as the hex byte 0x60, not 0x3c. Use strings.
  assert.equal(C.parseSpriteMask([60, 0, 0, 0, 0, 0, 0, 0]).hex,
    '60/00/00/00/00/00/00/00');
  // A single hex digit is a valid byte (leading zero implied).
  assert.equal(C.parseSpriteMask(['0','0','0','0','0','0','0','f']).bytes[7], 0x0f);
  assert.equal(C.parseSpriteMask(['0','0','0','0','0','0','0','f']).hex,
    '00/00/00/00/00/00/00/0f');
});

test('parseSpriteMask rejects wrong row counts and invalid tokens', () => {
  assert.throws(() => C.parseSpriteMask('3c/7e'), /exactly 8 rows/);
  assert.throws(() => C.parseSpriteMask(''), /exactly 8 rows/);
  assert.throws(() => C.parseSpriteMask(['3c']), /exactly 8 rows/);
  assert.throws(() => C.parseSpriteMask(123), /string or array/);
  const bad = 'zz/00/00/00/00/00/00/00';
  assert.throws(() => C.parseSpriteMask(bad), /invalid sprite row/);
  // A hex byte larger than two digits is not a token; it becomes a parse error.
  assert.throws(() => C.parseSpriteMask('1ff/00/00/00/00/00/00/00'), /invalid sprite row|exactly 8 rows/);
  // 9 binary digits is invalid too.
  assert.throws(() => C.parseSpriteMask('001111000/00/00/00/00/00/00/00'), /invalid sprite row|exactly 8 rows/);
});

test('encodeSpriteMask round trips and validates shape', () => {
  const pixels = C.parseSpriteMask(C.DEFAULT_SPRITES.boss).pixels;
  const hex = C.encodeSpriteMask(pixels);
  assert.equal(hex, 'ff/ff/c3/99/99/c3/ff/ff');
  assert.deepEqual(C.parseSpriteMask(hex).pixels, pixels);
  // Truthy non 1 values are treated as set bits.
  const ones = Array.from({ length: 8 }, () => Array(8).fill(2));
  assert.equal(C.encodeSpriteMask(ones), 'ff/ff/ff/ff/ff/ff/ff/ff');
  const zeros = Array.from({ length: 8 }, () => Array(8).fill(0));
  assert.equal(C.encodeSpriteMask(zeros), '00/00/00/00/00/00/00/00');
  assert.throws(() => C.encodeSpriteMask([[1]]), /8 rows/);
  assert.throws(() => C.encodeSpriteMask(Array.from({ length: 8 }, () => [1])), /8 cells/);
});

test('flipSprite mirrors on x and y and is an involution', () => {
  // One set bit at top-left (row 0, col 0) -> byte 0x80.
  const px = C.parseSpriteMask('80/00/00/00/00/00/00/00').pixels;
  assert.equal(C.encodeSpriteMask(C.flipSprite(px, 'x')), '01/00/00/00/00/00/00/00', 'flip x -> top-right');
  assert.equal(C.encodeSpriteMask(C.flipSprite(px, 'y')), '00/00/00/00/00/00/00/80', 'flip y -> bottom-left');
  assert.equal(C.encodeSpriteMask(C.flipSprite(C.flipSprite(px, 'x'), 'x')), '80/00/00/00/00/00/00/00');
  assert.equal(C.encodeSpriteMask(C.flipSprite(C.flipSprite(px, 'y'), 'y')), '80/00/00/00/00/00/00/00');
  assert.throws(() => C.flipSprite(px, 'z'), /axis must be x or y/);
  // Flipping preserves the number of set bits.
  const boss = C.parseSpriteMask(C.DEFAULT_SPRITES.boss).pixels;
  assert.equal(C.countBits(C.flipSprite(boss, 'x')), C.countBits(boss));
  // Input is not mutated.
  assert.equal(C.encodeSpriteMask(px), '80/00/00/00/00/00/00/00');
});

test('rotateSprite rotates 90 degrees and four rotations return to start', () => {
  const px = C.parseSpriteMask('80/00/00/00/00/00/00/00').pixels;
  // Top-left bit rotated 90 degrees clockwise lands at top-right.
  const r1 = C.rotateSprite(px);
  assert.equal(C.encodeSpriteMask(r1), '01/00/00/00/00/00/00/00');
  let cur = px;
  for (let i = 0; i < 4; i += 1) cur = C.rotateSprite(cur);
  assert.equal(C.encodeSpriteMask(cur), C.encodeSpriteMask(px), 'four rotations = identity');
  // Rotation preserves bit count.
  const boss = C.parseSpriteMask(C.DEFAULT_SPRITES.boss).pixels;
  assert.equal(C.countBits(C.rotateSprite(boss)), C.countBits(boss));
  // Input is not mutated.
  assert.equal(C.encodeSpriteMask(px), '80/00/00/00/00/00/00/00');
});

test('countBits counts set pixels regardless of truthy value', () => {
  const px = C.parseSpriteMask('ff/00/ff/00/00/00/00/01').pixels;
  assert.equal(C.countBits(px), 8 + 8 + 1);
  assert.equal(C.countBits(Array.from({ length: 8 }, () => Array(8).fill(0))), 0);
  assert.equal(C.countBits(Array.from({ length: 8 }, () => Array(8).fill(1))), 64);
  assert.equal(C.countBits(Array.from({ length: 8 }, () => Array(8).fill(7))), 64);
});

test('every DEFAULT_SPRITES entry parses to a valid 8x8 mask', () => {
  for (const name of Object.keys(C.DEFAULT_SPRITES)) {
    const s = C.parseSpriteMask(C.DEFAULT_SPRITES[name]);
    assert.equal(s.width, 8, name);
    assert.equal(s.height, 8, name);
    assert.equal(s.bytes.length, 8, name);
    assert.ok(s.bitcount >= 0 && s.bitcount <= 64, name);
    // Re-encoding reproduces the normalized hex form.
    assert.equal(C.encodeSpriteMask(s.pixels), s.hex, name);
  }
});

/* ------------------------------------------------------------------ */
/* 5. Input bitmask                                                    */
/* ------------------------------------------------------------------ */

test('INPUT flags are distinct powers of two', () => {
  const vals = Object.values(C.INPUT);
  assert.equal(new Set(vals).size, vals.length, 'no duplicate flags');
  for (const v of vals) assert.ok((v & (v - 1)) === 0, 'value must be a power of two: ' + v);
  assert.deepEqual(C.INPUT,
    { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, SHOOT: 16, DASH: 32, START: 64 });
});

test('encodeInput/decodeInput round trip any combination of flags', () => {
  assert.equal(C.encodeInput({}), 0);
  assert.equal(C.encodeInput(null), 0);
  assert.equal(C.encodeInput({ UP: true }), 1);
  assert.equal(C.encodeInput({ UP: true, SHOOT: true, DASH: true }), 1 + 16 + 32);
  const keys = Object.keys(C.INPUT);
  // Exhaustively verify all 128 flag combinations.
  for (let mask = 0; mask < 128; mask += 1) {
    const state = {};
    keys.forEach((k, i) => { state[k] = (mask & (1 << i)) !== 0; });
    assert.equal(C.encodeInput(state), mask, 'encode mismatch for ' + mask);
    const decoded = C.decodeInput(mask);
    for (const k of keys) {
      assert.equal(decoded[k], (mask & C.INPUT[k]) !== 0, 'decode mismatch ' + k + ' for ' + mask);
    }
  }
  // decodeInput coerces to unsigned 32-bit.
  assert.equal(C.decodeInput(-1).UP, true);
});

/* ------------------------------------------------------------------ */
/* 6. Level generator                                                  */
/* ------------------------------------------------------------------ */

test('generateLevel produces a grid of the requested dimensions', () => {
  const lv = C.generateLevel('SEED', 0, { width: 30, height: 20, rooms: 5 });
  assert.equal(lv.width, 30);
  assert.equal(lv.height, 20);
  assert.equal(lv.tiles.length, 30 * 20);
  assert.equal(lv.seed, 'SEED');
  assert.equal(lv.level, 0);
  assert.ok(lv.rooms.length >= 1 && lv.rooms.length <= 5);
});

test('generateLevel is deterministic for seed + index and varies by both', () => {
  const a = C.generateLevel('ALPHA', 3);
  const b = C.generateLevel('ALPHA', 3);
  const c = C.generateLevel('BETA', 3);
  const d = C.generateLevel('ALPHA', 4);
  assert.deepEqual(a, b, 'same seed and index must be identical');
  assert.notDeepEqual(a, c, 'different seed should change the level');
  assert.notDeepEqual(a, d, 'different index should change the level');
});

test('generateLevel marks spawn, exit, and boss tiles correctly', () => {
  // Non boss floor: spawn tile is SPAWN and the exit tile is EXIT.
  const lv0 = C.generateLevel('SEED', 0);
  assert.equal(C.tileAt(lv0, lv0.spawn.x, lv0.spawn.y), C.TILE.SPAWN);
  assert.equal(C.tileAt(lv0, lv0.exit.x, lv0.exit.y), C.TILE.EXIT);
  assert.equal(lv0.boss, null, 'floor 0 is not a boss floor');
  // Every third floor (index 2, 5, 8, 11) has a boss and no EXIT marker yet.
  for (const idx of [2, 5, 8, 11]) {
    const lv = C.generateLevel('SEED', idx);
    assert.ok(lv.boss, 'expected a boss on floor ' + idx);
    assert.ok(['WARDEN', 'CIPHER', 'MOTHERBOARD'].includes(lv.boss.kind));
    assert.equal(lv.boss.hp, 6 + idx * 2);
    assert.equal(lv.boss.x, lv.exit.x);
    assert.equal(lv.boss.y, lv.exit.y);
    assert.notEqual(C.tileAt(lv, lv.exit.x, lv.exit.y), C.TILE.EXIT,
      'boss floor must clear the exit marker');
  }
  // Floor 1 (not a boss floor) has no boss.
  assert.equal(C.generateLevel('SEED', 1).boss, null);
});

test('generateLevel always yields a fully connected dungeon across many runs', () => {
  for (let s = 0; s < 8; s += 1) {
    for (let l = 0; l < 12; l += 1) {
      const lv = C.generateLevel('seed-' + s, l);
      const r = C.levelReachable(lv);
      assert.ok(r.floors > 0, 'level has no floor tiles for seed ' + s + ' floor ' + l);
      assert.equal(r.connected, true,
        'disconnected dungeon for seed ' + s + ' floor ' + l +
        ' (reachable ' + r.reachable + ' of ' + r.floors + ')');
      assert.equal(r.reachable, r.floors);
    }
  }
});

test('generateLevel places spawn and exit on walkable tiles inside the grid', () => {
  for (let l = 0; l < 12; l += 1) {
    const lv = C.generateLevel('bounds', l);
    assert.ok(C.isWalkable(lv, lv.spawn.x, lv.spawn.y));
    assert.ok(C.isWalkable(lv, lv.exit.x, lv.exit.y));
    assert.ok(lv.spawn.x >= 0 && lv.spawn.x < lv.width);
    assert.ok(lv.spawn.y >= 0 && lv.spawn.y < lv.height);
    assert.ok(lv.exit.x >= 0 && lv.exit.x < lv.width);
    assert.ok(lv.exit.y >= 0 && lv.exit.y < lv.height);
  }
});

test('generateLevel populates enemies and pickups away from the spawn room', () => {
  const lv = C.generateLevel('populate', 4);
  assert.ok(lv.enemies.length > 0, 'expected some enemies');
  for (const e of lv.enemies) {
    assert.ok(['GRUNT', 'DRONE', 'SENTINEL'].includes(e.kind));
    assert.ok(e.hp >= 1);
    assert.ok(C.isWalkable(lv, e.x, e.y));
    assert.equal(e.dead, undefined);
  }
  for (const p of lv.pickups) {
    assert.ok(['HEALTH', 'SCORE', 'TIME'].includes(p.kind));
    assert.ok(C.isWalkable(lv, p.x, p.y));
  }
});

test('TILE constants, tileAt, and isWalkable handle out of bounds', () => {
  assert.deepEqual(C.TILE, { WALL: 0, FLOOR: 1, EXIT: 2, SPAWN: 3 });
  const lv = C.generateLevel('walls', 0);
  // Out of bounds reads as WALL and is not walkable.
  assert.equal(C.tileAt(lv, -1, 0), C.TILE.WALL);
  assert.equal(C.tileAt(lv, 0, -1), C.TILE.WALL);
  assert.equal(C.tileAt(lv, lv.width, 0), C.TILE.WALL);
  assert.equal(C.tileAt(lv, 0, lv.height), C.TILE.WALL);
  assert.equal(C.isWalkable(lv, -1, -1), false);
  // Spawn (a non WALL tile) is walkable.
  assert.equal(C.isWalkable(lv, lv.spawn.x, lv.spawn.y), true);
});

test('FIXED_DT, PALETTE, and makeSim start a sane simulation', () => {
  assert.equal(C.FIXED_DT, 1 / 60);
  assert.equal(C.PALETTE.player, '#7df9ff');
  const sim = C.makeSim('SIM-SEED');
  assert.equal(sim.status, 'playing');
  assert.equal(sim.frame, 0);
  assert.equal(sim.score, 0);
  assert.equal(sim.lives, 3);
  assert.equal(sim.levelIndex, 0);
  assert.equal(sim.seed, 'SIM-SEED');
  // Player starts centered on the spawn tile.
  assert.equal(sim.player.x, sim.level.spawn.x + 0.5);
  assert.equal(sim.player.y, sim.level.spawn.y + 0.5);
  // playerRect centers a w x h box on the player point.
  const r = C.playerRect(sim.player);
  assert.equal(r.w, sim.player.w);
  assert.equal(r.x + r.w / 2, sim.player.x);
  assert.equal(r.y + r.h / 2, sim.player.y);
});

test('stepSim advances frames deterministically and counts survival score', () => {
  const a = C.makeSim('STEP');
  const b = C.makeSim('STEP');
  for (let i = 0; i < 120; i += 1) {
    C.stepSim(a, i < 60 ? 0 : C.INPUT.RIGHT);
    C.stepSim(b, i < 60 ? 0 : C.INPUT.RIGHT);
  }
  assert.equal(a.frame, 120);
  assert.equal(a.score, 120, 'one survival point per frame');
  assert.deepEqual(a.player, b.player, 'same inputs and seed give the same player state');
  assert.equal(a.score, b.score);
  assert.equal(a.frame, b.frame);
});

test('tileBlocked rejects rects over walls and accepts rects over floor', () => {
  const lv = C.generateLevel('blocked', 0);
  const spawnRect = C.playerRect(C.makeSim('blocked').player);
  assert.equal(C.tileBlocked(lv, spawnRect), false, 'spawn area is walkable');
  // A rect sitting on the outer wall border (0,0) is blocked.
  assert.equal(C.tileBlocked(lv, { x: 0, y: 0, w: 0.5, h: 0.5 }), true);
});

test('formatTime renders a frame count as mm:ss.cc', () => {
  assert.equal(C.formatTime(0), '00:00.00');
  assert.equal(C.formatTime(60), '00:01.00');
  assert.equal(C.formatTime(90), '00:01.50');
  assert.equal(C.formatTime(3600), '01:00.00');
  assert.equal(C.formatTime(3661), '01:01.01');
  assert.match(C.formatTime(12345), /^\d{2}:\d{2}\.\d{2}$/);
});

/* ------------------------------------------------------------------ */
/* 7. Replay and score serializers                                     */
/* ------------------------------------------------------------------ */

test('compressFrames records only input changes and expandFrames rebuilds', () => {
  const frames = [0, 0, 1, 1, 1, 16, 16, 0, 0, 4];
  const changes = C.compressFrames(frames);
  assert.deepEqual(changes, [[2, 1], [5, 16], [7, 0], [9, 4]]);
  assert.deepEqual(C.expandFrames(changes, frames.length), frames);
  // All zero input compresses to no changes and expands to all zeros.
  assert.deepEqual(C.compressFrames([0, 0, 0, 0]), []);
  assert.deepEqual(C.expandFrames([], 5), [0, 0, 0, 0, 0]);
  // A change at frame 0 sets the initial mask.
  assert.deepEqual(C.expandFrames([[0, 8]], 4), [8, 8, 8, 8]);
  // Changes beyond the requested length are ignored.
  assert.deepEqual(C.expandFrames([[2, 4]], 2), [0, 0]);
});

test('compress/expand round trip a long randomized per frame stream', () => {
  const r = new C.RNG('frames');
  const frames = [];
  for (let i = 0; i < 5000; i += 1) {
    // Occasionally flip to a new random mask to exercise many change points.
    if (r.chance(0.05)) frames.push(r.int(0, 127));
    else frames.push(frames.length ? frames[frames.length - 1] : 0);
  }
  assert.deepEqual(C.expandFrames(C.compressFrames(frames), frames.length), frames);
});

test('serializeReplay/parseReplay round trip seed, meta, and frames', () => {
  const frames = [0, 0, 1, 1, 16, 16, 0, 0, 8, 8, 8, 0];
  const str = C.serializeReplay({ seed: 'RETROSAVE-1986', frames, meta: { player: 'AAA', note: 'gg' } });
  assert.ok(str.startsWith('RSAVE1.'), 'replay uses the RSAVE1 tag');
  assert.equal(str.split('.').length, 3, 'tag.body.checksum');
  const parsed = C.parseReplay(str);
  assert.equal(parsed.seed, 'RETROSAVE-1986');
  assert.equal(parsed.length, frames.length);
  assert.deepEqual(parsed.frames, frames);
  assert.deepEqual(parsed.meta, { player: 'AAA', note: 'gg' });
  // Empty replay still round trips.
  const empty = C.parseReplay(C.serializeReplay({ seed: 'X', frames: [] }));
  assert.equal(empty.length, 0);
  assert.deepEqual(empty.frames, []);
  assert.deepEqual(empty.meta, {});
});

test('parseReplay rejects corruption, wrong tags, and bad payloads', () => {
  const frames = [0, 1, 1, 0];
  const good = C.serializeReplay({ seed: 'S', frames });
  // A single corrupted body character breaks the checksum.
  const parts = good.split('.');
  const corruptedBody = (parts[1][0] === 'A' ? 'B' : 'A') + parts[1].slice(1);
  assert.equal(C.parseReplay(parts[0] + '.' + corruptedBody + '.' + parts[2]), null);
  // Wrong checksum.
  assert.equal(C.parseReplay(parts[0] + '.' + parts[1] + '.deadbeef'), null);
  // Wrong tag.
  assert.equal(C.parseReplay('RSCORE1.' + parts[1] + '.' + parts[2]), null);
  // Non string, empty, and malformed inputs.
  assert.equal(C.parseReplay(null), null);
  assert.equal(C.parseReplay(''), null);
  assert.equal(C.parseReplay('not-a-record'), null);
  // A well formed but wrong version payload is rejected. Build one via serializeScore shape is not
  // applicable, so forge a replay tagged record whose JSON has v: 2.
  const b64 = C.base64Encode(JSON.stringify({ v: 2, seed: 'S', length: 0, meta: {}, changes: [] }));
  const forged = 'RSAVE1.' + b64 + '.' + C.fnv1a(JSON.stringify({ v: 2, seed: 'S', length: 0, meta: {}, changes: [] }));
  assert.equal(C.parseReplay(forged), null, 'v must equal 1');
  // Negative or absurd length is rejected.
  const negJson = JSON.stringify({ v: 1, seed: 'S', length: -5, meta: {}, changes: [] });
  assert.equal(C.parseReplay('RSAVE1.' + C.base64Encode(negJson) + '.' + C.fnv1a(negJson)), null);
  const bigJson = JSON.stringify({ v: 1, seed: 'S', length: 6e6, meta: {}, changes: [] });
  assert.equal(C.parseReplay('RSAVE1.' + C.base64Encode(bigJson) + '.' + C.fnv1a(bigJson)), null);
});

test('serializeScore/parseScore round trip and normalize fields', () => {
  const entry = { name: 'zac', score: 1234, level: 3, timeFrames: 500, seed: 'SEED', date: '2026-11-08' };
  const str = C.serializeScore(entry);
  assert.ok(str.startsWith('RSCORE1.'), 'score uses the RSCORE1 tag');
  const parsed = C.parseScore(str);
  assert.equal(parsed.v, 1);
  assert.equal(parsed.name, 'ZAC', 'name uppercased and truncated to 3');
  assert.equal(parsed.score, 1234);
  assert.equal(parsed.level, 3);
  assert.equal(parsed.timeFrames, 500);
  assert.equal(parsed.seed, 'SEED');
  assert.equal(parsed.date, '2026-11-08');
  // Defaults and truncation.
  const d = C.parseScore(C.serializeScore({}));
  assert.equal(d.name, 'AAA');
  assert.equal(d.score, 0);
  assert.equal(d.level, 0);
  assert.equal(d.timeFrames, 0);
  assert.equal(d.seed, '');
  assert.equal(d.date, '');
  assert.equal(C.parseScore(C.serializeScore({ name: 'toolongname' })).name, 'TOO');
});

test('parseScore rejects corruption and wrong tags', () => {
  const good = C.serializeScore({ name: 'ABC', score: 999 });
  const parts = good.split('.');
  const corrupted = (parts[1][0] === 'A' ? 'B' : 'A') + parts[1].slice(1);
  assert.equal(C.parseScore(parts[0] + '.' + corrupted + '.' + parts[2]), null);
  assert.equal(C.parseScore(parts[0] + '.' + parts[1] + '.00000000'), null);
  assert.equal(C.parseScore('RSAVE1.' + parts[1] + '.' + parts[2]), null);
  assert.equal(C.parseScore(null), null);
  assert.equal(C.parseScore('garbage'), null);
  // Wrong version payload.
  const json = JSON.stringify({ v: 2, name: 'ABC', score: 1 });
  assert.equal(C.parseScore('RSCORE1.' + C.base64Encode(json) + '.' + C.fnv1a(json)), null);
});

test('records are ASCII tagged, checksummed, and whitespace tolerant', () => {
  const str = C.serializeReplay({ seed: 'WS', frames: [0, 1, 0] });
  // Leading/trailing whitespace is trimmed by unpackRecord.
  assert.deepEqual(C.parseReplay('  \n' + str + '  '), C.parseReplay(str));
  // Every character in a record is plain ASCII.
  for (const ch of str) assert.ok(ch.charCodeAt(0) < 128, 'non ASCII character in record');
  // The checksum segment equals fnv1a of the decoded JSON body.
  const parts = str.split('.');
  assert.equal(parts[2], C.fnv1a(C.base64Decode(parts[1])));
});
