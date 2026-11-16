'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./game.js');

function record(payload, tag = 'RSAVE1') {
  const json = JSON.stringify(payload);
  return tag + '.' + C.base64Encode(json) + '.' + C.fnv1a(json);
}
const payload = overrides => ({ v: 1, seed: 'Seed', length: 4, meta: {}, changes: [[1, 8]], ...overrides });

function arena() {
  const width = 9, height = 5;
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width, y = Math.floor(index / width);
    return x === 0 || y === 0 || x === width - 1 || y === height - 1 ? C.TILE.WALL : C.TILE.FLOOR;
  });
  return { width, height, tiles, spawn: { x: 1, y: 1 }, exit: { x: 7, y: 3 }, enemies: [], pickups: [], boss: null };
}
function arenaSim() {
  const sim = C.makeSim('Physics'); sim.level = arena(); sim.player.x = 2.5; sim.player.y = 2.5; return sim;
}

test('Unicode seed hashes use UTF-8 and agree with an independent FNV-1a implementation', () => {
  for (const text of ['Café', '水', '🙂', '\u0100', 'hello']) {
    let expected = 0x811c9dc5;
    for (const byte of new TextEncoder().encode(text)) expected = Math.imul(expected ^ byte, 0x01000193) >>> 0;
    assert.equal(C.hashSeed(text), expected);
  }
  assert.notEqual(C.hashSeed('\u0100'), C.hashSeed('\u0000'));
});

test('Unicode and mixed-case replay seeds and metadata round-trip as ASCII tokens', () => {
  const replay = { seed: 'MiXeD café 水 🙂', frames: [0, 8, 0], meta: { note: 'Café and 水' } };
  const token = C.serializeReplay(replay);
  assert.ok([...token].every(char => char.charCodeAt(0) < 128));
  assert.equal(C.parseReplay(token).seed, replay.seed);
  assert.deepEqual(C.parseReplay(token).meta, replay.meta);
});

test('base64 rejects invalid characters, lengths, and misplaced padding', () => {
  for (const text of ['Z', 'Zm9', '=', 'Zg===', 'Zg==AAAA', 'Z!m9v', 'Zm=v']) assert.throws(() => C.base64Decode(text));
  assert.equal(C.base64Decode(' Zm9v\n'), 'foo');
});

test('token parsers reject noncanonical padding and interior whitespace', () => {
  const good = C.serializeReplay({ seed: 'Seed', frames: [] });
  const parts = good.split('.');
  assert.equal(C.parseReplay(parts[0] + '.' + parts[1].slice(0, 2) + ' ' + parts[1].slice(2) + '.' + parts[2]), null);
  assert.equal(C.parseReplay(parts[0] + '.' + parts[1] + '.' + parts[2].toUpperCase()), null);
});

test('replay frame counts reject coercion, fractions, overflow, and missing values', () => {
  for (const length of [-1, 1.5, '4', null, 2 ** 32 + 4, C.MAX_REPLAY_FRAMES + 1]) assert.equal(C.parseReplay(record(payload({ length }))), null);
  const missing = payload(); delete missing.length;
  assert.equal(C.parseReplay(record(missing)), null);
});

test('replay changes reject malformed pairs, invalid masks, duplicate and unordered frames', () => {
  for (const changes of [null, {}, [null], [[0]], [[0, 8, 4]], [[1, 128]], [[1, -1]], [[1, 1.5]], [[4, 8]], [[-1, 8]], [[2, 8], [1, 4]], [[1, 8], [1, 4]], [[1, '8']]]) {
    assert.doesNotThrow(() => C.parseReplay(record(payload({ changes }))));
    assert.equal(C.parseReplay(record(payload({ changes }))), null);
  }
});

test('replay schema rejects invalid seed and metadata objects', () => {
  for (const seed of ['', ' ', 42, null, 'x'.repeat(129), 'A\nB']) assert.equal(C.parseReplay(record(payload({ seed }))), null);
  for (const meta of [null, [], 'bad', { engineVersion: 2 }, { stateDigest: 'wrong' }, { score: '10' }, { level: 13 }]) assert.equal(C.parseReplay(record(payload({ meta }))), null);
  assert.equal(C.parseReplay('x'.repeat(4 * 1024 * 1024 + 1)), null);
});

test('replay serializers reject invalid masks and sparse frame arrays', () => {
  for (const frames of [[128], [-1], [NaN], ['8'], Array(4), {}]) assert.throws(() => C.serializeReplay({ seed: 'S', frames }));
  assert.throws(() => C.serializeReplay({ seed: 'S', frames: [], meta: [] }));
});

test('one-hour frame boundary round-trips without integer truncation', () => {
  const frames = Array(C.MAX_REPLAY_FRAMES).fill(0);
  const replay = C.parseReplay(C.serializeReplay({ seed: 'Boundary', frames }));
  assert.equal(replay.length, 216000); assert.equal(replay.frames.at(-1), 0);
  assert.throws(() => C.compressFrames(Array(C.MAX_REPLAY_FRAMES + 1)), RangeError);
});

test('numeric sprite byte arrays reproduce every built-in hex mask', () => {
  for (const source of Object.values(C.DEFAULT_SPRITES)) {
    const parsed = C.parseSpriteMask(source);
    assert.equal(C.parseSpriteMask(parsed.bytes).hex, parsed.hex);
  }
  for (const bad of [-1, 256, 1.5, NaN]) assert.throws(() => C.parseSpriteMask([bad, 0, 0, 0, 0, 0, 0, 0]));
});

test('sprite transforms reject malformed shapes and non-binary pixels', () => {
  const invalid = Array.from({ length: 8 }, () => Array(8).fill(0)); invalid[2][3] = '1';
  for (const operation of [C.encodeSpriteMask, C.countBits, C.rotateSprite, pixels => C.flipSprite(pixels, 'x')]) assert.throws(() => operation(invalid), /binary/);
  assert.throws(() => C.parseSpriteMask(Array(8)));
});

test('sprite sheets round-trip normalized rows, hex, color, and Unicode names', () => {
  const hex = C.DEFAULT_SPRITES.player;
  const sheet = { schema: 'retrosave/sprite', version: 1, name: 'Café', width: 8, height: 8, rows: C.parseSpriteMask(hex).bytes, hex, palette: '#AABBCC' };
  const normalized = C.importSpriteSheet(C.exportSpriteSheet(sheet));
  assert.equal(normalized.palette, '#aabbcc'); assert.equal(normalized.name, 'Café');
  assert.equal(C.exportSpriteSheet(normalized), C.exportSpriteSheet(sheet));
});

test('sprite import rejects schema, dimensions, color, and conflicting row data', () => {
  const hex = C.DEFAULT_SPRITES.player;
  const sheet = { schema: 'retrosave/sprite', version: 1, name: 'Player', width: 8, height: 8, rows: hex.split('/'), hex, palette: '#aabbcc' };
  for (const overrides of [{ version: 2 }, { schema: 'other' }, { width: 16 }, { palette: 'red' }, { rows: C.DEFAULT_SPRITES.boss.split('/') }, { name: '' }]) assert.throws(() => C.importSpriteSheet(JSON.stringify({ ...sheet, ...overrides })));
  assert.throws(() => C.importSpriteSheet(' '.repeat(8193)));
  assert.throws(() => C.importSpriteSheet(JSON.stringify({ ...sheet, name: 'Blue\nplayer' })));
});

test('level generation rejects invalid dimensions, floors, and room counts', () => {
  for (const options of [{ width: 0 }, { width: 7 }, { height: 129 }, { rooms: 0 }, { rooms: 41 }, { width: 8.5 }]) assert.throws(() => C.generateLevel('S', 0, options));
  for (const floor of [-1, 12, 1.5, NaN]) assert.throws(() => C.generateLevel('S', floor));
});

test('small and large supported dungeons stay bounded, connected, and have distinct exits', () => {
  for (const [width, height, rooms] of [[8, 8, 1], [12, 10, 6], [128, 128, 40]]) for (const floor of [0, 2, 11]) {
    const level = C.generateLevel('Bounds-' + width, floor, { width, height, rooms });
    assert.equal(level.tiles.length, width * height);
    assert.equal(C.levelReachable(level).connected, true);
    assert.notDeepEqual(level.spawn, level.exit);
    for (const room of level.rooms) assert.ok(room.x >= 1 && room.y >= 1 && room.x + room.w < width && room.y + room.h < height);
  }
});

test('path inspector returns adjacent walkable steps with optimal open-room distance', () => {
  const level = arena();
  const route = C.findPath(level);
  assert.deepEqual(route[0], level.spawn); assert.deepEqual(route.at(-1), level.exit);
  assert.equal(route.length - 1, 8);
  for (let index = 1; index < route.length; index++) {
    assert.equal(Math.abs(route[index].x - route[index - 1].x) + Math.abs(route[index].y - route[index - 1].y), 1);
    assert.equal(C.isWalkable(level, route[index].x, route[index].y), true);
  }
  assert.equal(C.findPath(level, { x: 0, y: 0 }, level.exit), null);
});

test('wall collision uses half-open rectangle edges and invalid tile indices are walls', () => {
  const level = arena(); level.tiles[2 * level.width + 3] = C.TILE.WALL;
  assert.equal(C.tileBlocked(level, { x: 2, y: 2, w: 1, h: 1 }), false);
  assert.equal(C.tileBlocked(level, { x: 2.0001, y: 2, w: 1, h: 1 }), true);
  for (const x of [NaN, Infinity, 1.5]) assert.equal(C.isWalkable(level, x, 2), false);
  assert.throws(() => C.tileBlocked(level, { x: NaN, y: 0, w: 1, h: 1 }));
});

test('large movement sweeps stop at tile walls and retain sliding on the free axis', () => {
  const level = arena(); for (let row = 1; row < 4; row++) level.tiles[row * level.width + 3] = C.TILE.WALL;
  const original = { x: 1.1, y: 1.1, w: 0.66, h: 0.66 };
  const moved = C.moveRect(original, 5, 0.5, rect => C.tileBlocked(level, rect));
  assert.ok(moved.x + moved.w <= 3); assert.equal(moved.y, 1.6);
  assert.equal(C.tileBlocked(level, moved), false); assert.equal(original.x, 1.1);
});

test('vertical shots have no horizontal drift and diagonal shots keep constant speed', () => {
  const vertical = arenaSim(); vertical.player.facing = { x: 0, y: -1 }; C.stepSim(vertical, C.INPUT.SHOOT);
  assert.equal(vertical.bullets[0].vx, 0); assert.ok(vertical.bullets[0].vy < 0);
  const diagonal = arenaSim(); C.stepSim(diagonal, C.INPUT.RIGHT | C.INPUT.DOWN | C.INPUT.SHOOT);
  assert.ok(Math.abs(Math.hypot(diagonal.bullets[0].vx, diagonal.bullets[0].vy) - 8 / 60) < 1e-12);
});

test('a single bullet damages only one target even when an enemy overlaps a boss', () => {
  const sim = arenaSim(); sim.player.x = 1.5; sim.player.y = 1.5;
  sim.level.enemies = [{ x: 4, y: 2, hp: 1, kind: 'GRUNT' }];
  sim.level.boss = { x: 4, y: 2, hp: 10, kind: 'WARDEN' };
  sim.bullets = [{ x: 4.5, y: 2.5, vx: 0, vy: 0, life: 2 }];
  C.stepSim(sim, 0);
  assert.equal(sim.level.enemies[0].dead, true); assert.equal(sim.level.boss.hp, 10); assert.equal(sim.bullets.length, 0);
});

test('dash invulnerability lasts ten consumed frames and boss contact causes damage', () => {
  const sim = arenaSim(); sim.level.enemies = [{ x: 2, y: 2, hp: 5, kind: 'GRUNT' }];
  C.stepSim(sim, C.INPUT.RIGHT | C.INPUT.DASH);
  assert.equal(sim.player.invuln, 10); assert.equal(sim.player.dashCooldown, 60);
  for (let frame = 1; frame < 10; frame++) C.stepSim(sim, 0);
  assert.equal(sim.player.hp, 3);
  C.stepSim(sim, 0); assert.equal(sim.player.hp, 2);
  const boss = arenaSim(); boss.level.boss = { x: 2, y: 2, hp: 10, kind: 'WARDEN' };
  C.stepSim(boss, 0); assert.equal(boss.player.hp, 2);
});

test('fatal collisions consume the final frame and terminal simulations remain frozen', () => {
  const sim = arenaSim(); sim.player.hp = 1; sim.lives = 1; sim.level.enemies = [{ x: 2, y: 2, hp: 5, kind: 'GRUNT' }];
  C.stepSim(sim, 0); assert.equal(sim.status, 'gameover'); assert.equal(sim.frame, 1);
  const before = JSON.stringify(sim); C.stepSim(sim, C.INPUT.RIGHT); assert.equal(JSON.stringify(sim), before);
});

test('clearing the twelfth floor wins without generating or reporting floor thirteen', () => {
  const sim = C.makeSim('Final'); sim.levelIndex = 11; sim.clearedFloors = 11; sim.level = C.generateLevel(sim.seed, 11);
  sim.level.boss.dead = true; sim.level.tiles[sim.level.exit.y * sim.level.width + sim.level.exit.x] = C.TILE.EXIT;
  sim.player.x = sim.level.exit.x + 0.5; sim.player.y = sim.level.exit.y + 0.5; sim.player.invuln = 90;
  C.stepSim(sim, 0);
  assert.equal(sim.status, 'win'); assert.equal(sim.clearedFloors, 12); assert.equal(sim.levelIndex, 11); assert.equal(sim.level.level, 11);
});

test('state digests exclude event queues and change when simulation state changes', () => {
  const sim = C.makeSim('Digest'), original = C.simulationDigest(sim);
  sim.events.push({ type: 'render-only' }); assert.equal(C.simulationDigest(sim), original);
  sim.player.hp -= 1; assert.notEqual(C.simulationDigest(sim), original);
});

test('replay verifier reproduces a complete deterministic run and reference digest', () => {
  const frames = Array.from({ length: 512 }, (_, index) => index % 60 < 30 ? C.INPUT.SHOOT : 0);
  const sim = C.makeSim('Reference'); for (const mask of frames) C.stepSim(sim, mask);
  const token = C.serializeReplay({ seed: sim.seed, frames, meta: { engineVersion: C.ENGINE_VERSION, stateDigest: C.simulationDigest(sim), score: sim.score, level: sim.levelIndex + 1 } });
  const result = C.verifyReplay(token);
  assert.equal(result.valid, true); assert.equal(result.stateMatches, true); assert.equal(result.scoreMatches, true); assert.equal(result.levelMatches, true);
  assert.equal(result.executedFrames, frames.length); assert.equal(result.trailingFrames, 0);
});

test('replay verifier distinguishes absent, mismatched, and incompatible references', () => {
  assert.equal(C.verifyReplay(C.serializeReplay({ seed: 'S', frames: [0] })).stateMatches, null);
  const wrong = C.verifyReplay(C.serializeReplay({ seed: 'S', frames: [0], meta: { score: 999, stateDigest: '00000000' } }));
  assert.equal(wrong.valid, true); assert.equal(wrong.stateMatches, false); assert.equal(wrong.scoreMatches, false);
  const incompatible = C.verifyReplay(C.serializeReplay({ seed: 'S', frames: [], meta: { engineVersion: 'other' } }));
  assert.equal(incompatible.engineCompatible, false);
  assert.equal(C.verifyReplay('invalid').valid, false);
});

test('score schemas reject checksummed records with invalid numeric or text fields', () => {
  const score = { v: 1, name: 'AAA', score: 10, level: 1, timeFrames: 60, seed: 'S', date: '2026-11-15' };
  for (const overrides of [{ score: '10' }, { score: -1 }, { level: 13 }, { timeFrames: 1.5 }, { name: '<x>' }, { date: '2026-02-30' }, { seed: null }]) assert.equal(C.parseScore(record({ ...score, ...overrides }, 'RSCORE1')), null);
});

test('score serialization rejects numeric truncation and preserves Unicode seeds', () => {
  for (const overrides of [{ score: -1 }, { score: 2 ** 32 }, { score: 1.5 }, { level: 13 }, { timeFrames: Infinity }, { date: '2026-02-30' }]) assert.throws(() => C.serializeScore(overrides));
  const entry = { name: 'you', score: 120, level: 1, timeFrames: 120, seed: 'Café 水', date: '2026-11-15' };
  assert.equal(C.parseScore(C.serializeScore(entry)).seed, entry.seed);
});

test('RNG bounds and simulation masks reject non-finite and coerced input', () => {
  const rng = new C.RNG('Bounds');
  assert.throws(() => rng.int(5, 4)); assert.throws(() => rng.float(0, Infinity)); assert.throws(() => rng.pick([])); assert.throws(() => rng.chance(NaN));
  for (const mask of [-1, 128, '8', NaN]) assert.throws(() => C.stepSim(C.makeSim('Masks'), mask));
});
