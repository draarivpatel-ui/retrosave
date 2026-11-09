/*
 * RetroSave - core logic and browser game.
 * The Core object is pure and dependency free, so it runs in the browser and
 * under Node. The browser game only boots when a document exists.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Deterministic RNG (mulberry32)                                      */
  /* ------------------------------------------------------------------ */

  function hashSeed(value) {
    const str = String(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function RNG(seed) {
    if (typeof seed === 'string') {
      this.state = hashSeed(seed);
    } else {
      this.state = (typeof seed === 'number' ? seed : Date.now()) >>> 0;
    }
    this.seed = seed;
  }

  RNG.prototype.next = function () {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  RNG.prototype.int = function (min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  };

  RNG.prototype.float = function (min, max) {
    return min + this.next() * (max - min);
  };

  RNG.prototype.chance = function (p) {
    return this.next() < p;
  };

  RNG.prototype.pick = function (arr) {
    return arr[this.int(0, arr.length - 1)];
  };

  RNG.prototype.fork = function (label) {
    return new RNG((this.state ^ hashSeed(label)) >>> 0);
  };

  /* ------------------------------------------------------------------ */
  /* Pure base64 and checksum helpers (ASCII payloads, no Buffer/btoa)  */
  /* ------------------------------------------------------------------ */

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64REV = (function () {
    const m = {};
    for (let i = 0; i < B64.length; i += 1) m[B64[i]] = i;
    return m;
  }());

  function base64Encode(str) {
    let out = '';
    let i = 0;
    const bytes = [];
    for (let k = 0; k < str.length; k += 1) {
      const c = str.charCodeAt(k);
      // Replay and sprite payloads are pure ASCII; fold anything else to '?'.
      bytes.push(c < 128 ? c : 63);
    }
    while (i < bytes.length) {
      const c1 = bytes[i++];
      const has2 = i < bytes.length;
      const c2 = has2 ? bytes[i++] : 0;
      const has3 = i < bytes.length;
      const c3 = has3 ? bytes[i++] : 0;
      const e1 = c1 >> 2;
      const e2 = ((c1 & 3) << 4) | (c2 >> 4);
      const e3 = has2 ? (((c2 & 15) << 2) | (c3 >> 6)) : 64;
      const e4 = has3 ? (c3 & 63) : 64;
      out += B64[e1] + B64[e2] + (e3 === 64 ? '=' : B64[e3]) + (e4 === 64 ? '=' : B64[e4]);
    }
    return out;
  }

  function base64Decode(str) {
    let out = '';
    const clean = String(str).replace(/[^A-Za-z0-9+/=]/g, '');
    let i = 0;
    while (i < clean.length) {
      const e1 = B64REV[clean[i++]];
      const e2 = B64REV[clean[i++]];
      const ch3 = clean[i++];
      const ch4 = clean[i++];
      const e3 = ch3 === '=' || ch3 === undefined ? 64 : B64REV[ch3];
      const e4 = ch4 === '=' || ch4 === undefined ? 64 : B64REV[ch4];
      if (e1 === undefined || e2 === undefined) throw new Error('bad base64');
      const c1 = (e1 << 2) | (e2 >> 4);
      out += String.fromCharCode(c1);
      if (e3 !== 64 && e3 !== undefined) {
        const c2 = ((e2 & 15) << 4) | (e3 >> 2);
        out += String.fromCharCode(c2);
        if (e4 !== 64 && e4 !== undefined) {
          const c3 = ((e3 & 3) << 6) | e4;
          out += String.fromCharCode(c3);
        }
      }
    }
    return out;
  }

  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  /* ------------------------------------------------------------------ */
  /* Sprite bitmask parser (8x8 sprites)                                 */
  /* ------------------------------------------------------------------ */

  const SPRITE_SIZE = 8;

  // Accepts either an 8-bit binary string (for example "00111100") or a
  // one or two digit hex byte (for example "3c"). Both describe one row.
  function parseRow(token) {
    const t = String(token).trim();
    let value;
    if (/^[01]{8}$/.test(t)) {
      value = parseInt(t, 2);
    } else if (/^[0-9a-fA-F]{1,2}$/.test(t)) {
      value = parseInt(t, 16);
    } else {
      throw new Error('invalid sprite row: ' + t);
    }
    if (Number.isNaN(value) || value > 255) throw new Error('invalid sprite row: ' + t);
    return value;
  }

  function normalizeSpriteSource(src) {
    let rows;
    if (Array.isArray(src)) {
      rows = src.slice();
    } else if (typeof src === 'string') {
      rows = src.trim().split(/[\/\s,;]+/).filter(function (r) { return r.length > 0; });
    } else {
      throw new Error('sprite must be a string or array');
    }
    if (rows.length !== SPRITE_SIZE) {
      throw new Error('sprite needs exactly ' + SPRITE_SIZE + ' rows, got ' + rows.length);
    }
    return rows.map(parseRow);
  }

  function rowsToPixels(bytes) {
    const pixels = [];
    for (let r = 0; r < SPRITE_SIZE; r += 1) {
      const row = [];
      for (let c = 0; c < SPRITE_SIZE; c += 1) {
        row.push((bytes[r] >> (7 - c)) & 1);
      }
      pixels.push(row);
    }
    return pixels;
  }

  function parseSpriteMask(src) {
    const bytes = normalizeSpriteSource(src);
    const pixels = rowsToPixels(bytes);
    let bitcount = 0;
    for (let r = 0; r < SPRITE_SIZE; r += 1) {
      for (let c = 0; c < SPRITE_SIZE; c += 1) bitcount += pixels[r][c];
    }
    const hex = bytes.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('/');
    return { width: SPRITE_SIZE, height: SPRITE_SIZE, pixels: pixels, bytes: bytes.slice(), hex: hex, bitcount: bitcount };
  }

  function encodeSpriteMask(pixels) {
    if (!Array.isArray(pixels) || pixels.length !== SPRITE_SIZE) {
      throw new Error('pixels must be 8 rows');
    }
    const parts = [];
    for (let r = 0; r < SPRITE_SIZE; r += 1) {
      if (!Array.isArray(pixels[r]) || pixels[r].length !== SPRITE_SIZE) {
        throw new Error('each row must be 8 cells');
      }
      let b = 0;
      for (let c = 0; c < SPRITE_SIZE; c += 1) {
        b = (b << 1) | (pixels[r][c] ? 1 : 0);
      }
      parts.push(b.toString(16).padStart(2, '0'));
    }
    return parts.join('/');
  }

  function flipSprite(pixels, axis) {
    const out = [];
    for (let r = 0; r < SPRITE_SIZE; r += 1) out.push(pixels[r].slice());
    if (axis === 'x') {
      for (let r = 0; r < SPRITE_SIZE; r += 1) out[r].reverse();
    } else if (axis === 'y') {
      out.reverse();
    } else {
      throw new Error('axis must be x or y');
    }
    return out;
  }

  function rotateSprite(pixels) {
    const out = [];
    for (let r = 0; r < SPRITE_SIZE; r += 1) {
      const row = [];
      for (let c = 0; c < SPRITE_SIZE; c += 1) {
        row.push(pixels[SPRITE_SIZE - 1 - c][r]);
      }
      out.push(row);
    }
    return out;
  }

  function countBits(pixels) {
    let n = 0;
    for (let r = 0; r < SPRITE_SIZE; r += 1) {
      for (let c = 0; c < SPRITE_SIZE; c += 1) n += pixels[r][c] ? 1 : 0;
    }
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Collision detection                                                 */
  /* ------------------------------------------------------------------ */

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function rectContainsPoint(rect, px, py) {
    return px >= rect.x && px <= rect.x + rect.w &&
           py >= rect.y && py <= rect.y + rect.h;
  }

  function circlesOverlap(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const rr = a.r + b.r;
    return dx * dx + dy * dy <= rr * rr;
  }

  function circleHitsRect(cx, cy, r, rect) {
    const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  function clampRectToArena(rect, arena) {
    return {
      x: Math.max(arena.x, Math.min(rect.x, arena.x + arena.w - rect.w)),
      y: Math.max(arena.y, Math.min(rect.y, arena.y + arena.h - rect.h)),
      w: rect.w,
      h: rect.h
    };
  }

  // Move a rectangle one axis at a time; revert that axis on a blocked step.
  function moveRect(rect, dx, dy, isBlocked) {
    const out = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    out.x += dx;
    if (isBlocked(out)) out.x = rect.x;
    out.y += dy;
    if (isBlocked(out)) out.y = rect.y;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Input bitmask (replay encoding)                                     */
  /* ------------------------------------------------------------------ */

  const INPUT = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, SHOOT: 16, DASH: 32, START: 64 };

  function encodeInput(state) {
    let m = 0;
    Object.keys(INPUT).forEach(function (k) {
      if (state && state[k]) m |= INPUT[k];
    });
    return m;
  }

  function decodeInput(mask) {
    const m = mask >>> 0;
    const out = {};
    Object.keys(INPUT).forEach(function (k) {
      out[k] = (m & INPUT[k]) !== 0;
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Level generator (deterministic room-and-corridor dungeon)           */
  /* ------------------------------------------------------------------ */

  const TILE = { WALL: 0, FLOOR: 1, EXIT: 2, SPAWN: 3 };

  function idx(level, col, row) {
    return row * level.width + col;
  }

  function tileAt(level, col, row) {
    if (col < 0 || row < 0 || col >= level.width || row >= level.height) return TILE.WALL;
    return level.tiles[idx(level, col, row)];
  }

  function isWalkable(level, col, row) {
    return tileAt(level, col, row) !== TILE.WALL;
  }

  function makeGrid(width, height) {
    const tiles = new Array(width * height);
    for (let i = 0; i < tiles.length; i += 1) tiles[i] = TILE.WALL;
    return tiles;
  }

  function carveRoom(level, room) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) {
        level.tiles[idx(level, x, y)] = TILE.FLOOR;
      }
    }
  }

  function carveHCorridor(level, x1, x2, y) {
    const a = Math.min(x1, x2);
    const b = Math.max(x1, x2);
    for (let x = a; x <= b; x += 1) level.tiles[idx(level, x, y)] = TILE.FLOOR;
  }

  function carveVCorridor(level, y1, y2, x) {
    const a = Math.min(y1, y2);
    const b = Math.max(y1, y2);
    for (let y = a; y <= b; y += 1) level.tiles[idx(level, x, y)] = TILE.FLOOR;
  }

  function roomCenter(room) {
    return {
      x: room.x + Math.floor(room.w / 2),
      y: room.y + Math.floor(room.h / 2)
    };
  }

  function generateLevel(seed, levelIndex, options) {
    const opts = options || {};
    const width = opts.width || 40;
    const height = opts.height || 24;
    const roomTarget = opts.rooms || (6 + Math.min(4, levelIndex));
    const rng = new RNG(hashSeed(seed) ^ Math.imul(levelIndex + 1, 0x9e3779b1));
    const level = {
      seed: String(seed),
      level: levelIndex,
      width: width,
      height: height,
      tiles: makeGrid(width, height),
      rooms: [],
      enemies: [],
      pickups: [],
      spawn: { x: 1, y: 1 },
      exit: { x: width - 2, y: height - 2 },
      boss: null
    };

    // Try to place non-overlapping rooms.
    let attempts = 0;
    while (level.rooms.length < roomTarget && attempts < roomTarget * 20) {
      attempts += 1;
      const rw = rng.int(5, 9);
      const rh = rng.int(4, 7);
      const rx = rng.int(1, width - rw - 2);
      const ry = rng.int(1, height - rh - 2);
      const candidate = { x: rx, y: ry, w: rw, h: rh };
      const pad = 1;
      const overlaps = level.rooms.some(function (r) {
        return rx - pad < r.x + r.w && rx + rw + pad > r.x &&
               ry - pad < r.y + r.h && ry + rh + pad > r.y;
      });
      if (overlaps) continue;
      level.rooms.push(candidate);
      carveRoom(level, candidate);
    }

    if (level.rooms.length === 0) {
      // Guarantee at least one playable room.
      const fallback = { x: 2, y: 2, w: Math.min(8, width - 4), h: Math.min(6, height - 4) };
      level.rooms.push(fallback);
      carveRoom(level, fallback);
    }

    // Connect rooms in sequence with L-shaped corridors. This guarantees
    // every room (and therefore every floor tile) is reachable.
    for (let i = 1; i < level.rooms.length; i += 1) {
      const a = roomCenter(level.rooms[i - 1]);
      const b = roomCenter(level.rooms[i]);
      if (rng.chance(0.5)) {
        carveHCorridor(level, a.x, b.x, a.y);
        carveVCorridor(level, a.y, b.y, b.x);
      } else {
        carveVCorridor(level, a.y, b.y, a.x);
        carveHCorridor(level, a.x, b.x, b.y);
      }
    }

    const first = roomCenter(level.rooms[0]);
    const last = roomCenter(level.rooms[level.rooms.length - 1]);
    level.spawn = { x: first.x, y: first.y };
    level.exit = { x: last.x, y: last.y };
    level.tiles[idx(level, first.x, first.y)] = TILE.SPAWN;

    // Boss occupies the final room on every third floor.
    const bossFloor = (levelIndex % 3 === 2);
    if (bossFloor) {
      level.boss = {
        x: last.x,
        y: last.y,
        hp: 6 + levelIndex * 2,
        kind: rng.pick(['WARDEN', 'CIPHER', 'MOTHERBOARD'])
      };
      // Clear the exit tile marker so the player must beat the boss first.
      level.tiles[idx(level, last.x, last.y)] = TILE.FLOOR;
    } else {
      level.tiles[idx(level, last.x, last.y)] = TILE.EXIT;
    }

    // Populate enemies and pickups in rooms away from the spawn room.
    for (let i = 1; i < level.rooms.length; i += 1) {
      const room = level.rooms[i];
      const enemyCount = rng.int(1, 2 + Math.min(2, Math.floor(levelIndex / 2)));
      for (let e = 0; e < enemyCount; e += 1) {
        const ex = rng.int(room.x + 1, room.x + room.w - 2);
        const ey = rng.int(room.y + 1, room.y + room.h - 2);
        if (ex === level.spawn.x && ey === level.spawn.y) continue;
        level.enemies.push({
          x: ex, y: ey,
          kind: rng.pick(['GRUNT', 'DRONE', 'SENTINEL']),
          hp: 1 + Math.floor(levelIndex / 3)
        });
      }
      if (rng.chance(0.55)) {
        const px = rng.int(room.x + 1, room.x + room.w - 2);
        const py = rng.int(room.y + 1, room.y + room.h - 2);
        level.pickups.push({ x: px, y: py, kind: rng.pick(['HEALTH', 'SCORE', 'TIME']) });
      }
    }

    return level;
  }

  // Flood fill from spawn; everything carved must be reachable.
  function levelReachable(level) {
    const seen = new Uint8Array(level.width * level.height);
    const queue = [level.spawn];
    seen[idx(level, level.spawn.x, level.spawn.y)] = 1;
    let head = 0;
    let count = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (head < queue.length) {
      const cur = queue[head++];
      count += 1;
      for (let d = 0; d < dirs.length; d += 1) {
        const nx = cur.x + dirs[d][0];
        const ny = cur.y + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
        const k = idx(level, nx, ny);
        if (seen[k]) continue;
        if (level.tiles[k] === TILE.WALL) continue;
        seen[k] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
    let floors = 0;
    for (let i = 0; i < level.tiles.length; i += 1) {
      if (level.tiles[i] !== TILE.WALL) floors += 1;
    }
    return { reachable: count, floors: floors, connected: count === floors };
  }

  /* ------------------------------------------------------------------ */
  /* Replay and score serialization                                       */
  /* ------------------------------------------------------------------ */

  // Per-frame input masks compress into [frame, mask] change points.
  function compressFrames(frames) {
    const changes = [];
    let prev = 0;
    for (let f = 0; f < frames.length; f += 1) {
      const m = frames[f] >>> 0;
      if (m !== prev) {
        changes.push([f, m]);
        prev = m;
      }
    }
    return changes;
  }

  function expandFrames(changes, length) {
    const frames = new Array(length);
    let ci = 0;
    let cur = 0;
    for (let f = 0; f < length; f += 1) {
      while (ci < changes.length && changes[ci][0] === f) {
        cur = changes[ci][1] >>> 0;
        ci += 1;
      }
      frames[f] = cur;
    }
    return frames;
  }

  function packRecord(obj, tag) {
    const json = JSON.stringify(obj);
    const body = base64Encode(json);
    return tag + '.' + body + '.' + fnv1a(json);
  }

  function unpackRecord(str, tag) {
    if (typeof str !== 'string') return null;
    const parts = str.trim().split('.');
    if (parts.length !== 3 || parts[0] !== tag) return null;
    let json;
    try {
      json = base64Decode(parts[1]);
    } catch (e) {
      return null;
    }
    if (fnv1a(json) !== parts[2]) return null;
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  const REPLAY_TAG = 'RSAVE1';
  const SCORE_TAG = 'RSCORE1';

  function serializeReplay(replay) {
    const frames = replay.frames || [];
    const payload = {
      v: 1,
      seed: String(replay.seed),
      length: frames.length,
      meta: replay.meta || {},
      changes: compressFrames(frames)
    };
    return packRecord(payload, REPLAY_TAG);
  }

  function parseReplay(str) {
    const payload = unpackRecord(str, REPLAY_TAG);
    if (!payload || payload.v !== 1) return null;
    const length = payload.length | 0;
    if (length < 0 || length > 5e6) return null;
    return {
      seed: payload.seed,
      meta: payload.meta,
      frames: expandFrames(payload.changes || [], length),
      length: length
    };
  }

  function serializeScore(entry) {
    return packRecord({
      v: 1,
      name: String(entry.name || 'AAA').slice(0, 3).toUpperCase(),
      score: entry.score | 0,
      level: entry.level | 0,
      timeFrames: entry.timeFrames | 0,
      seed: String(entry.seed || ''),
      date: String(entry.date || '')
    }, SCORE_TAG);
  }

  function parseScore(str) {
    const obj = unpackRecord(str, SCORE_TAG);
    if (!obj || obj.v !== 1) return null;
    return obj;
  }

  /* ------------------------------------------------------------------ */
  /* Default sprite assets and palette                                    */
  /* ------------------------------------------------------------------ */

  const DEFAULT_SPRITES = {
    player: '3c/7e/db/ff/ff/db/7e/3c',
    playerAlt: '3c/42/db/ff/ff/db/42/3c',
    grunt: '81/c3/e7/ff/ff/e7/c3/81',
    drone: '18/3c/7e/db/ff/db/7e/3c',
    sentinel: 'ff/81/bd/a5/a5/bd/81/ff',
    boss: 'ff/ff/c3/99/99/c3/ff/ff',
    bullet: '00/00/18/3c/3c/18/00/00',
    pickup: '00/3c/42/5a/5a/42/3c/00',
    wall: 'ff/81/81/81/81/81/81/ff'
  };

  const PALETTE = {
    bg: '#05060a',
    ink: '#0b1220',
    wall: '#1b2b4a',
    wallEdge: '#2f4a7a',
    floor: '#0c1424',
    floorDot: '#161f36',
    player: '#7df9ff',
    playerGlow: '#2bd6e8',
    enemy: '#ff4f8b',
    boss: '#ffb347',
    bullet: '#ffe66d',
    pickup: '#8cff7d',
    exit: '#b085ff',
    hud: '#c7d0e8',
    hudDim: '#5b6789',
    danger: '#ff3b5c',
    scan: 'rgba(0,0,0,0.28)',
    vignette: 'rgba(0,0,0,0.55)'
  };

  /* ------------------------------------------------------------------ */
  /* Synchronous simulation (shared by live play and replay)            */
  /* ------------------------------------------------------------------ */

  const FIXED_DT = 1 / 60;

  function makeSim(seed, opts) {
    const options = opts || {};
    const level0 = generateLevel(seed, 0);
    return {
      seed: String(seed),
      levelIndex: 0,
      level: level0,
      frame: 0,
      score: 0,
      lives: 3,
      player: {
        x: level0.spawn.x + 0.5,
        y: level0.spawn.y + 0.5,
        w: 0.66,
        h: 0.66,
        hp: 3,
        dashCooldown: 0,
        fireCooldown: 0,
        invuln: 0,
        facing: { x: 1, y: 0 }
      },
      bullets: [],
      status: 'playing',
      events: []
    };
  }

  function playerRect(p) {
    return { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
  }

  function tileBlocked(level, rect) {
    const minX = Math.floor(rect.x);
    const maxX = Math.floor(rect.x + rect.w);
    const minY = Math.floor(rect.y);
    const maxY = Math.floor(rect.y + rect.h);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!isWalkable(level, x, y)) return true;
      }
    }
    return false;
  }

  function stepSim(sim, mask) {
    if (sim.status !== 'playing') return sim;
    const input = decodeInput(mask);
    const p = sim.player;
    const level = sim.level;
    let dx = 0;
    let dy = 0;
    const speed = 4.2 * FIXED_DT;
    if (input.LEFT) dx -= 1;
    if (input.RIGHT) dx += 1;
    if (input.UP) dy -= 1;
    if (input.DOWN) dy += 1;
    if (dx !== 0 && dy !== 0) {
      const inv = Math.SQRT1_2;
      dx *= inv;
      dy *= inv;
    }
    if (dx !== 0 || dy !== 0) {
      p.facing.x = dx;
      p.facing.y = dy;
    }

    let stepX = dx * speed;
    let stepY = dy * speed;
    if (input.DASH && p.dashCooldown <= 0) {
      stepX *= 3.2;
      stepY *= 3.2;
      p.dashCooldown = 60;
      p.invuln = Math.max(p.invuln, 10);
      sim.events.push({ type: 'dash', frame: sim.frame });
    }

    const isBlocked = function (r) { return tileBlocked(level, r); };
    const moved = moveRect(playerRect(p), stepX, stepY, isBlocked);
    p.x = moved.x + moved.w / 2;
    p.y = moved.y + moved.h / 2;

    if (p.dashCooldown > 0) p.dashCooldown -= 1;
    if (p.fireCooldown > 0) p.fireCooldown -= 1;
    if (p.invuln > 0) p.invuln -= 1;

    if (input.SHOOT && p.fireCooldown <= 0) {
      p.fireCooldown = 12;
      const fx = p.facing.x || 1;
      const fy = p.facing.y || 0;
      sim.bullets.push({
        x: p.x, y: p.y, vx: fx * 8 * FIXED_DT, vy: fy * 8 * FIXED_DT,
        life: 90, from: 'player'
      });
      sim.events.push({ type: 'shoot', frame: sim.frame });
    }

    // Advance bullets, remove those that hit walls, resolve enemy hits.
    const remaining = [];
    for (let b = 0; b < sim.bullets.length; b += 1) {
      const bullet = sim.bullets[b];
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;
      bullet.life -= 1;
      if (bullet.life <= 0) continue;
      if (!isWalkable(level, Math.floor(bullet.x), Math.floor(bullet.y))) continue;
      let hit = false;
      for (let e = 0; e < level.enemies.length; e += 1) {
        const en = level.enemies[e];
        if (!en.dead && circleHitsRect(bullet.x, bullet.y, 0.18, {
          x: en.x + 0.16, y: en.y + 0.16, w: 0.68, h: 0.68
        })) {
          en.hp -= 1;
          hit = true;
          if (en.hp <= 0) {
            en.dead = true;
            sim.score += 125;
            sim.events.push({ type: 'kill', frame: sim.frame, x: en.x, y: en.y });
          }
          break;
        }
      }
      if (level.boss && !level.boss.dead) {
        const boss = level.boss;
        if (circleHitsRect(bullet.x, bullet.y, 0.18, {
          x: boss.x - 0.4, y: boss.y - 0.4, w: 1.8, h: 1.8
        })) {
          boss.hp -= 1;
          hit = true;
          sim.score += 15;
          if (boss.hp <= 0) {
            boss.dead = true;
            sim.score += 1500;
            level.tiles[idx(level, level.exit.x, level.exit.y)] = TILE.EXIT;
            sim.events.push({ type: 'boss', frame: sim.frame, x: boss.x, y: boss.y });
          }
        }
      }
      if (!hit) remaining.push(bullet);
    }
    sim.bullets = remaining;

    // Collect pickups.
    for (let k = 0; k < level.pickups.length; k += 1) {
      const pk = level.pickups[k];
      if (pk.taken) continue;
      if (rectsOverlap(playerRect(p), { x: pk.x + 0.2, y: pk.y + 0.2, w: 0.6, h: 0.6 })) {
        pk.taken = true;
        if (pk.kind === 'HEALTH') p.hp = Math.min(5, p.hp + 1);
        else if (pk.kind === 'SCORE') sim.score += 250;
        else sim.score += 100;
        sim.events.push({ type: 'pickup', frame: sim.frame, kind: pk.kind });
      }
    }

    // Contact damage from alive enemies.
    if (p.invuln <= 0) {
      for (let e = 0; e < level.enemies.length; e += 1) {
        const en = level.enemies[e];
        if (en.dead) continue;
        if (rectsOverlap(playerRect(p), { x: en.x + 0.16, y: en.y + 0.16, w: 0.68, h: 0.68 })) {
          p.hp -= 1;
          p.invuln = 45;
          sim.events.push({ type: 'hurt', frame: sim.frame });
          break;
        }
      }
    }
    if (p.hp <= 0) {
      sim.lives -= 1;
      sim.events.push({ type: 'death', frame: sim.frame });
      if (sim.lives <= 0) {
        sim.status = 'gameover';
        return sim;
      }
      p.hp = 3;
      p.invuln = 90;
      p.x = level.spawn.x + 0.5;
      p.y = level.spawn.y + 0.5;
      sim.bullets = [];
    }

    // Reach the exit -> next floor.
    const exitTile = level.tiles[idx(level, level.exit.x, level.exit.y)];
    if (exitTile === TILE.EXIT &&
        Math.abs(p.x - (level.exit.x + 0.5)) < 0.5 &&
        Math.abs(p.y - (level.exit.y + 0.5)) < 0.5) {
      sim.score += 500 + sim.levelIndex * 100;
      sim.levelIndex += 1;
      sim.level = generateLevel(sim.seed, sim.levelIndex);
      p.x = sim.level.spawn.x + 0.5;
      p.y = sim.level.spawn.y + 0.5;
      sim.bullets = [];
      sim.events.push({ type: 'floor', frame: sim.frame, level: sim.levelIndex });
      if (sim.levelIndex >= 12) sim.status = 'win';
    }

    sim.score += 1; // survival tick
    sim.frame += 1;
    return sim;
  }

  function formatTime(frame) {
    const totalMs = Math.floor(frame * (1000 / 60));
    const mins = Math.floor(totalMs / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const cs = Math.floor((totalMs % 1000) / 10);
    return String(mins).padStart(2, '0') + ':' +
           String(secs).padStart(2, '0') + '.' +
           String(cs).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ */
  /* Core export                                                          */
  /* ------------------------------------------------------------------ */

  const Core = {
    hashSeed: hashSeed,
    RNG: RNG,
    base64Encode: base64Encode,
    base64Decode: base64Decode,
    fnv1a: fnv1a,
    SPRITE_SIZE: SPRITE_SIZE,
    parseSpriteMask: parseSpriteMask,
    encodeSpriteMask: encodeSpriteMask,
    flipSprite: flipSprite,
    rotateSprite: rotateSprite,
    countBits: countBits,
    rectsOverlap: rectsOverlap,
    rectContainsPoint: rectContainsPoint,
    circlesOverlap: circlesOverlap,
    circleHitsRect: circleHitsRect,
    clampRectToArena: clampRectToArena,
    moveRect: moveRect,
    INPUT: INPUT,
    encodeInput: encodeInput,
    decodeInput: decodeInput,
    TILE: TILE,
    tileAt: tileAt,
    isWalkable: isWalkable,
    generateLevel: generateLevel,
    levelReachable: levelReachable,
    compressFrames: compressFrames,
    expandFrames: expandFrames,
    serializeReplay: serializeReplay,
    parseReplay: parseReplay,
    serializeScore: serializeScore,
    parseScore: parseScore,
    DEFAULT_SPRITES: DEFAULT_SPRITES,
    PALETTE: PALETTE,
    FIXED_DT: FIXED_DT,
    makeSim: makeSim,
    stepSim: stepSim,
    playerRect: playerRect,
    tileBlocked: tileBlocked,
    formatTime: formatTime
  };

  global.RetroSaveCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;

  /* ------------------------------------------------------------------ */
  /* Browser game (only runs when a document exists)                     */
  /* ------------------------------------------------------------------ */

  if (typeof document === 'undefined') return;

  const C = Core;
  const VW = 960;          // logical canvas width
  const VH = 600;          // logical canvas height
  const TP = 24;           // tile size in logical pixels

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d', { alpha: false });
  canvas.width = VW;
  canvas.height = VH;
  ctx.imageSmoothingEnabled = false;

  // Offscreen buffer for the whole scene, then a CRT post pass.
  const scene = document.createElement('canvas');
  scene.width = VW;
  scene.height = VH;
  const sctx = scene.getContext('2d', { alpha: false });

  const $ = function (id) { return document.getElementById(id); };
  const ui = {
    audioBtn: $('audioBtn'),
    sheetToggle: $('sheetToggle'),
    seedInput: $('seedInput'),
    hud: $('hud'),
    editorGrid: $('editorGrid'),
    editorHex: $('editorHex'),
    editorName: $('editorName'),
    replayInput: $('replayInput'),
    scoreList: $('scoreList'),
    chrRomTableBody: $('chrRomTableBody'),
    bfsBadge: $('bfsBadge'),
    telSeed: $('telSeed'),
    telFnv: $('telFnv'),
    telFloor: $('telFloor'),
    telFloorHash: $('telFloorHash'),
    telRooms: $('telRooms'),
    telBfs: $('telBfs'),
    telCoords: $('telCoords'),
    telBoss: $('telBoss'),
    telFrame: $('telFrame'),
    telPos: $('telPos'),
    telHp: $('telHp'),
    telScore: $('telScore'),
    telMask: $('telMask'),
    telDeltas: $('telDeltas')
  };

  /* ----------------------- state ---------------------------------- */

  const Game = {
    mode: 'play',           // play, title, pause, editor, visualizer, scores, gameover, win, replay
    prevMode: 'play',
    sim: null,
    seed: 'RETROSAVE-1986',
    frames: [],             // recorded input masks for the current run
    deltaCount: 0,
    lastMask: 0,
    cachedLevelIdx: -1,
    cachedReach: null,
    replayFrames: null,     // masks being played back
    replayCursor: 0,
    replayMeta: {},
    scoreText: '',
    accumulator: 0,
    lastTime: 0,
    flash: 0,
    shake: 0,
    particles: [],
    vizPhase: 0,
    vizBars: new Array(48).fill(0),
    audioEnabled: false,
    finalScore: null,
    message: '',
    messageUntil: 0,
    editor: {
      pixels: C.parseSpriteMask(C.DEFAULT_SPRITES.player).pixels,
      color: '#9c2b1b',
      target: 'CUSTOM'
    },
    scores: []
  };

  function setMode(m) {
    Game.prevMode = Game.mode;
    Game.mode = m;
    document.body.setAttribute('data-mode', m);
    updatePanels();
    updateTabs();
  }

  function updateTabs() {
    const tabs = document.querySelectorAll('.ds-tab');
    const activeAct = (Game.mode === 'play' || Game.mode === 'title' || Game.mode === 'gameover' || Game.mode === 'win')
      ? 'title'
      : (Game.mode === 'visualizer' ? 'viz' : Game.mode);
    tabs.forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.act === activeAct);
    });
  }

  function updatePanels() {
    const panels = ['panelTitle', 'panelEditor', 'panelScores', 'panelReplay', 'panelPause'];
    panels.forEach(function (id) {
      const el = $(id);
      if (!el) return;
      el.classList.add('hidden');
    });
    if (Game.mode === 'title' || Game.mode === 'play' || Game.mode === 'visualizer' || Game.mode === 'gameover' || Game.mode === 'win') {
      show('panelTitle');
    } else if (Game.mode === 'editor') {
      show('panelEditor');
      buildEditorGrid();
    } else if (Game.mode === 'scores') {
      show('panelScores');
      renderScores();
    } else if (Game.mode === 'replay') {
      show('panelReplay');
    } else if (Game.mode === 'pause') {
      show('panelPause');
    }
  }

  function show(id) {
    const el = $(id);
    if (el) el.classList.remove('hidden');
  }

  function flashMessage(text, ms) {
    Game.message = text;
    Game.messageUntil = performance.now() + (ms || 1600);
  }

  /* ----------------------- input ---------------------------------- */

  const keymap = {
    ArrowUp: 'UP', KeyW: 'UP',
    ArrowDown: 'DOWN', KeyS: 'DOWN',
    ArrowLeft: 'LEFT', KeyA: 'LEFT',
    ArrowRight: 'RIGHT', KeyD: 'RIGHT',
    Space: 'SHOOT', KeyJ: 'SHOOT', KeyZ: 'SHOOT',
    ShiftLeft: 'DASH', ShiftRight: 'DASH', KeyK: 'DASH', KeyX: 'DASH',
    Enter: 'START', KeyP: 'START'
  };
  const keys = {};
  const keyState = {};

  function defaultInput() {
    return { UP: false, DOWN: false, LEFT: false, RIGHT: false, SHOOT: false, DASH: false, START: false };
  }

  window.addEventListener('keydown', function (e) {
    if (isTypingTarget(e.target)) {
      if (e.code === 'Enter' && e.target === ui.seedInput) {
        e.preventDefault();
        startGame(ui.seedInput.value);
      }
      return;
    }
    const action = keymap[e.code];
    if (action) {
      e.preventDefault();
      if (!keys[e.code]) keyState[action] = true;
      keys[e.code] = true;
    }
    handleGlobalKeys(e);
  });
  window.addEventListener('keyup', function (e) {
    if (keymap[e.code]) { e.preventDefault(); keys[e.code] = false; }
  });
  window.addEventListener('blur', function () {
    Object.keys(keys).forEach(function (k) { keys[k] = false; });
  });

  function readKeyboard() {
    const s = defaultInput();
    Object.keys(keymap).forEach(function (code) {
      if (keys[code]) s[keymap[code]] = true;
    });
    return s;
  }

  function readGamepad() {
    const s = defaultInput();
    if (!navigator.getGamepads) return s;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i += 1) {
      const gp = pads[i];
      if (!gp) continue;
      const dead = 0.28;
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      if (ax < -dead) s.LEFT = true;
      if (ax > dead) s.RIGHT = true;
      if (ay < -dead) s.UP = true;
      if (ay > dead) s.DOWN = true;
      const b = gp.buttons;
      if (b[12] && b[12].pressed) s.UP = true;
      if (b[13] && b[13].pressed) s.DOWN = true;
      if (b[14] && b[14].pressed) s.LEFT = true;
      if (b[15] && b[15].pressed) s.RIGHT = true;
      if (b[0] && b[0].pressed) s.SHOOT = true;
      if ((b[1] && b[1].pressed) || (b[5] && b[5].pressed)) s.DASH = true;
      if (b[9] && b[9].pressed) s.START = true;
      break;
    }
    return s;
  }

  function currentInput() {
    const kb = readKeyboard();
    const gp = readGamepad();
    const out = defaultInput();
    Object.keys(out).forEach(function (k) { out[k] = kb[k] || gp[k]; });
    return out;
  }

  /* ----------------------- audio (muted by default) --------------- */

  // Master gain is held at 0 until the user clicks "PSG AUDIO".
  // No AudioContext is created before that click, so nothing can leak sound.
  const Synth = {
    ctx: null,
    master: null,
    enabled: false,
    ensure: function () {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0; // strictly silent
      this.master.connect(this.ctx.destination);
      this.voices = [];
    },
    setEnabled: function (on) {
      this.enabled = on;
      if (on) {
        this.ensure();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        if (this.master) {
          this.master.gain.setTargetAtTime(0.22, this.ctx.currentTime, 0.02);
        }
      } else if (this.master) {
        this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
      }
    },
    blip: function (freq, dur, type, vol) {
      if (!this.enabled || !this.ctx || !this.master) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    event: function (name) {
      const map = {
        shoot: [660, 0.08, 'square', 0.18],
        dash: [220, 0.14, 'sawtooth', 0.2],
        kill: [140, 0.18, 'square', 0.28],
        hurt: [110, 0.22, 'sawtooth', 0.3],
        pickup: [880, 0.12, 'triangle', 0.25],
        floor: [520, 0.3, 'square', 0.3],
        boss: [90, 0.4, 'sawtooth', 0.35],
        death: [70, 0.5, 'sawtooth', 0.35]
      };
      const p = map[name];
      if (p) this.blip(p[0], p[1], p[2], p[3]);
    }
  };

  if (ui.audioBtn) {
    ui.audioBtn.addEventListener('click', function () {
      Synth.setEnabled(!Synth.enabled);
      ui.audioBtn.textContent = Synth.enabled ? 'PSG AUDIO: ON' : 'PSG AUDIO: MUTED';
      ui.audioBtn.classList.toggle('on', Synth.enabled);
      flashMessage(Synth.enabled ? 'PSG SYNTH ENABLED' : 'PSG AUDIO MUTED', 1200);
    });
  }

  if (ui.sheetToggle) {
    ui.sheetToggle.addEventListener('click', function () {
      const cur = document.documentElement.getAttribute('data-sheet') || 'parchment';
      const next = cur === 'parchment' ? 'charcoal' : 'parchment';
      document.documentElement.setAttribute('data-sheet', next);
      ui.sheetToggle.textContent = 'SHEET: ' + next.toUpperCase();
    });
  }

  /* ----------------------- particles / events --------------------- */

  function spawnParticles(gx, gy, color, count, spread) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 2.2) * (spread || 1);
      Game.particles.push({
        x: gx, y: gy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 20 + Math.random() * 24,
        max: 44,
        color: color
      });
    }
  }

  function drainEvents(sim) {
    if (!sim.events.length) return;
    const evs = sim.events.splice(0);
    for (let i = 0; i < evs.length; i += 1) {
      const ev = evs[i];
      Synth.event(ev.type);
      if (ev.type === 'shoot') Game.flash = Math.min(Game.flash + 0.05, 0.4);
      if (ev.type === 'kill') {
        spawnParticles(ev.x + 0.5, ev.y + 0.5, C.PALETTE.enemy, 14, 1);
        Game.shake = Math.max(Game.shake, 4);
      }
      if (ev.type === 'boss') {
        spawnParticles(ev.x + 0.5, ev.y + 0.5, C.PALETTE.boss, 40, 2);
        Game.shake = 10;
        Game.flash = 0.7;
      }
      if (ev.type === 'hurt' || ev.type === 'death') {
        Game.shake = 8;
        Game.flash = 0.6;
        spawnParticles(sim.player.x, sim.player.y, C.PALETTE.danger, 16, 1.4);
      }
      if (ev.type === 'pickup') {
        spawnParticles(sim.player.x, sim.player.y, C.PALETTE.pickup, 10, 0.8);
      }
      if (ev.type === 'floor') {
        Game.flash = 0.5;
        Game.cachedLevelIdx = -1;
        flashMessage('FLOOR ' + (ev.level + 1), 1100);
      }
      if (ev.type === 'dash') {
        spawnParticles(sim.player.x, sim.player.y, C.PALETTE.playerGlow, 8, 0.6);
      }
    }
  }

  function updateParticles() {
    const list = Game.particles;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const p = list[i];
      p.x += p.vx * C.FIXED_DT;
      p.y += p.vy * C.FIXED_DT;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= 1;
      if (p.life <= 0) list.splice(i, 1);
    }
    if (list.length > 400) list.splice(0, list.length - 400);
  }

  /* ----------------------- run lifecycle -------------------------- */

  function startGame(seed, replayFrames) {
    Game.seed = String(seed || Game.seed || 'RETROSAVE-1986').trim().toUpperCase() || 'RETROSAVE-1986';
    if (ui.seedInput) ui.seedInput.value = Game.seed;
    Game.sim = C.makeSim(Game.seed);
    Game.frames = [];
    Game.deltaCount = 0;
    Game.lastMask = 0;
    Game.cachedLevelIdx = -1;
    Game.cachedReach = null;
    Game.replayFrames = replayFrames || null;
    Game.replayCursor = 0;
    Game.particles = [];
    Game.flash = 0;
    Game.shake = 0;
    Game.accumulator = 0;
    Game.vizPhase = 0;
    Game.finalScore = null;
    setMode('play');
    updateTelemetry();
    flashMessage(Game.replayFrames ? 'REPLAY VERIFIED // PLAYBACK' : 'SEED ' + Game.seed + ' // FLOOR 1', 1100);
  }

  function finishRun() {
    const sim = Game.sim;
    Game.finalScore = {
      name: 'YOU',
      score: sim.score,
      level: sim.levelIndex + 1,
      timeFrames: sim.frame,
      seed: Game.seed,
      date: new Date().toISOString().slice(0, 10)
    };
    saveScore(Game.finalScore);
    setMode(sim.status === 'win' ? 'win' : 'gameover');
  }

  function fixedStep(mask) {
    const sim = Game.sim;
    if (!sim || sim.status !== 'playing') return;
    const m = mask >>> 0;
    if (m !== Game.lastMask) {
      Game.deltaCount += 1;
      Game.lastMask = m;
    }
    C.stepSim(sim, m);
    drainEvents(sim);
    updateParticles();
    if (Game.flash > 0) Game.flash = Math.max(0, Game.flash - 0.02);
    if (Game.shake > 0) Game.shake = Math.max(0, Game.shake - 0.5);
    if (sim.status !== 'playing') finishRun();
  }

  function playStep() {
    if (Game.mode !== 'play') return;
    let mask;
    if (Game.replayFrames) {
      if (Game.replayCursor >= Game.replayFrames.length) {
        flashMessage('REPLAY COMPLETE', 1400);
        Game.replayFrames = null;
        setMode('pause');
        return;
      }
      mask = Game.replayFrames[Game.replayCursor] >>> 0;
      Game.replayCursor += 1;
    } else {
      mask = C.encodeInput(currentInput());
      Game.frames.push(mask);
    }
    fixedStep(mask);
  }

  function stepSingleFrame() {
    if (!Game.sim || Game.sim.status !== 'playing') {
      startGame(Game.seed);
    }
    if (Game.mode === 'play') {
      setMode('pause');
    }
    const mask = C.encodeInput(currentInput());
    Game.frames.push(mask);
    fixedStep(mask);
    updateTelemetry();
    flashMessage('STEP FRAME ' + Game.sim.frame, 700);
  }

  /* ----------------------- telemetry & CHR-ROM table -------------- */

  function buildChrRomTable() {
    if (!ui.chrRomTableBody) return;
    const names = Object.keys(C.DEFAULT_SPRITES);
    let html = '';
    names.forEach(function (name, idx) {
      const parsed = C.parseSpriteMask(C.DEFAULT_SPRITES[name]);
      const addr = '0x' + (idx * 8).toString(16).toUpperCase().padStart(4, '0');
      html += '<tr data-sprite="' + name + '" title="Click to load ' + name.toUpperCase() + ' into 8x8 CHR-ROM Editor">' +
        '<td>' + addr + '</td>' +
        '<td>' + name.toUpperCase() + '</td>' +
        '<td class="hex-cell">' + parsed.hex + '</td>' +
        '<td>' + parsed.bitcount + '/64</td>' +
        '</tr>';
    });
    ui.chrRomTableBody.innerHTML = html;

    ui.chrRomTableBody.addEventListener('click', function (e) {
      const row = e.target.closest('tr[data-sprite]');
      if (!row) return;
      const spName = row.dataset.sprite;
      if (C.DEFAULT_SPRITES[spName]) {
        if (ui.editorName) ui.editorName.value = spName.toUpperCase();
        editorLoadHex(C.DEFAULT_SPRITES[spName]);
        setMode('editor');
      }
    });
  }

  function updateTelemetry() {
    const sim = Game.sim;
    if (!sim) return;
    const lv = sim.level;
    if (Game.cachedLevelIdx !== sim.levelIndex || !Game.cachedReach) {
      Game.cachedLevelIdx = sim.levelIndex;
      Game.cachedReach = C.levelReachable(lv);
      const seedHash = C.hashSeed(sim.seed) >>> 0;
      const floorSeed = (seedHash ^ Math.imul(sim.levelIndex + 1, 0x9e3779b1)) >>> 0;
      if (ui.telSeed) ui.telSeed.textContent = sim.seed;
      if (ui.telFnv) ui.telFnv.textContent = '0x' + C.fnv1a(sim.seed);
      if (ui.telFloor) ui.telFloor.textContent = String(sim.levelIndex + 1).padStart(2, '0') + ' / 12';
      if (ui.telFloorHash) ui.telFloorHash.textContent = '0x' + floorSeed.toString(16).padStart(8, '0');
      if (ui.telRooms) ui.telRooms.textContent = lv.rooms.length + ' NON-OVERLAPPING';
      if (ui.telBfs) ui.telBfs.textContent = Game.cachedReach.reachable + ' / ' + Game.cachedReach.floors + ' TILES';
      if (ui.bfsBadge) {
        ui.bfsBadge.textContent = Game.cachedReach.connected
          ? 'BFS CONNECTED: 100% (' + Game.cachedReach.reachable + ' TILES)'
          : 'BFS DISCONNECTED';
      }
      if (ui.telCoords) {
        ui.telCoords.textContent = '(' + lv.spawn.x + ',' + lv.spawn.y + ') -> (' + lv.exit.x + ',' + lv.exit.y + ')';
      }
    }
    if (ui.telBoss) {
      ui.telBoss.textContent = lv.boss
        ? (lv.boss.dead ? lv.boss.kind + ' (DEFEATED)' : lv.boss.kind + ' (' + lv.boss.hp + ' HP)')
        : 'NONE (FLOOR 3/6/9/12)';
    }
    if (ui.telFrame) {
      ui.telFrame.textContent = String(sim.frame).padStart(4, '0') + ' (' + C.formatTime(sim.frame) + ')';
    }
    if (ui.telPos) {
      ui.telPos.textContent = '(' + sim.player.x.toFixed(2) + ', ' + sim.player.y.toFixed(2) + ')';
    }
    if (ui.telHp) {
      ui.telHp.textContent = sim.player.hp + ' HP / ' + sim.lives + ' LIVES';
    }
    if (ui.telScore) {
      ui.telScore.textContent = String(sim.score).padStart(6, '0');
    }
    if (ui.telMask) {
      const m = Game.lastMask & 0x7f;
      ui.telMask.textContent = '0x' + m.toString(16).toUpperCase().padStart(2, '0') +
        ' (' + m.toString(2).padStart(7, '0') + 'b)';
    }
    if (ui.telDeltas) {
      ui.telDeltas.textContent = Game.deltaCount + ' CHANGE PTS / ' + Game.frames.length + 'F';
    }
  }

  /* ----------------------- score storage -------------------------- */

  const SCORE_KEY = 'retrosave.scores.v1';

  function loadScores() {
    try {
      const raw = localStorage.getItem(SCORE_KEY);
      if (!raw) return [];
      const arr = raw.split('\n').filter(Boolean).map(C.parseScore).filter(Boolean);
      return arr;
    } catch (e) { return []; }
  }

  function saveScore(entry) {
    const all = loadScores();
    all.push(C.parseScore(C.serializeScore(entry)));
    all.sort(function (a, b) { return b.score - a.score; });
    const top = all.slice(0, 8);
    try {
      localStorage.setItem(SCORE_KEY, top.map(C.serializeScore).join('\n'));
    } catch (e) { /* storage disabled */ }
    Game.scores = top;
  }

  function renderScores() {
    if (!ui.scoreList) return;
    const all = loadScores();
    Game.scores = all;
    if (!all.length) {
      ui.scoreList.innerHTML = '<div class="empty">No RSCORE1 records stored in localStorage yet. Complete or finish a run to log a checksummed entry.</div>';
      return;
    }
    let html = '<div class="score-head"><span>#</span><span>TAG</span><span>SCORE</span><span>FLR</span><span>TIME</span><span>SEED</span></div>';
    all.forEach(function (e, i) {
      html += '<div class="score-row"><span>' + (i + 1) +
        '</span><span>' + esc(e.name) + '</span><span>' + e.score +
        '</span><span>' + e.level + '</span><span>' + C.formatTime(e.timeFrames) +
        '</span><span class="seed">' + esc(e.seed) + '</span></div>';
    });
    ui.scoreList.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ----------------------- replay helpers ------------------------- */

  function exportReplay() {
    const frames = Game.frames.length ? Game.frames : (Game.replayFrames || [0]);
    const str = C.serializeReplay({
      seed: Game.seed,
      frames: frames,
      meta: {
        score: Game.finalScore ? Game.finalScore.score : (Game.sim ? Game.sim.score : 0),
        level: Game.sim ? Game.sim.levelIndex + 1 : 1,
        recorded: new Date().toISOString().slice(0, 10)
      }
    });
    if (ui.replayInput) ui.replayInput.value = str;
    return str;
  }

  function importReplay() {
    if (!ui.replayInput) return;
    const parsed = C.parseReplay(ui.replayInput.value.trim());
    if (!parsed) { flashMessage('FNV-1A CHECKSUM OR PAYLOAD INVALID', 1600); return; }
    Game.seed = parsed.seed;
    startGame(parsed.seed, parsed.frames);
    if (parsed.meta) Game.replayMeta = parsed.meta;
  }

  function copyReplay() {
    const str = exportReplay();
    if (!str) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(function () {
        flashMessage('RSAVE1 TOKEN COPIED', 1400);
      }, function () {
        flashMessage('TOKEN READY IN REPLAY VERIFIER', 1600);
      });
    } else {
      flashMessage('TOKEN READY IN REPLAY VERIFIER', 1600);
    }
  }

  /* ----------------------- global keys ---------------------------- */

  function handleGlobalKeys(e) {
    const code = e.code;
    if (code === 'Escape') {
      if (Game.mode === 'play') setMode('pause');
      else if (Game.mode === 'pause') setMode('play');
      else setMode('play');
      return;
    }
    if (code === 'Period') {
      e.preventDefault();
      stepSingleFrame();
      return;
    }
    if (code === 'KeyE' && !isTypingTarget(e.target)) {
      if (Game.mode === 'editor') setMode('play');
      else { Game.editorReturn = Game.mode; setMode('editor'); }
      return;
    }
    if (code === 'KeyV' && !isTypingTarget(e.target)) {
      toggleVisualizer();
      return;
    }
    if (code === 'KeyM' && !isTypingTarget(e.target)) {
      if (ui.audioBtn) ui.audioBtn.click();
      return;
    }
    if ((code === 'Enter' || code === 'KeyP') && (Game.mode === 'title' || Game.mode === 'gameover' || Game.mode === 'win')) {
      startGame(ui.seedInput ? ui.seedInput.value : Game.seed);
    } else if ((code === 'Enter' || code === 'KeyP') && Game.mode === 'pause') {
      setMode('play');
    }
  }

  function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function toggleVisualizer() {
    if (Game.mode === 'visualizer') setMode('play');
    else setMode('visualizer');
  }

  /* ----------------------- sprite editor -------------------------- */

  function buildEditorGrid() {
    if (!ui.editorGrid) return;
    let html = '';
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        const on = Game.editor.pixels[r][c] ? ' on' : '';
        html += '<div class="px' + on + '" data-r="' + r + '" data-c="' + c + '"></div>';
      }
    }
    ui.editorGrid.innerHTML = html;
    refreshEditorHex();
    drawEditorPreview();
  }

  function refreshEditorHex() {
    if (ui.editorHex) ui.editorHex.value = C.encodeSpriteMask(Game.editor.pixels);
  }

  let editorPainting = false;
  let editorPaintValue = 1;

  if (ui.editorGrid) {
    ui.editorGrid.addEventListener('pointerdown', function (e) {
      const cell = e.target.closest('.px');
      if (!cell) return;
      editorPainting = true;
      const r = +cell.dataset.r;
      const c = +cell.dataset.c;
      editorPaintValue = Game.editor.pixels[r][c] ? 0 : 1;
      paintCell(r, c, editorPaintValue);
    });
    ui.editorGrid.addEventListener('pointermove', function (e) {
      if (!editorPainting) return;
      const cell = document.elementFromPoint(e.clientX, e.clientY);
      if (!cell || !cell.classList.contains('px')) return;
      paintCell(+cell.dataset.r, +cell.dataset.c, editorPaintValue);
    });
    window.addEventListener('pointerup', function () { editorPainting = false; });
  }

  function paintCell(r, c, val) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return;
    Game.editor.pixels[r][c] = val;
    const cell = ui.editorGrid && ui.editorGrid.querySelector('[data-r="' + r + '"][data-c="' + c + '"]');
    if (cell) cell.classList.toggle('on', !!val);
    refreshEditorHex();
    drawEditorPreview();
  }

  function editorLoadHex(str) {
    try {
      const parsed = C.parseSpriteMask(str);
      Game.editor.pixels = parsed.pixels;
      buildEditorGrid();
      drawEditorPreview();
      flashMessage('CHR-ROM MASK LOADED', 1000);
      return true;
    } catch (err) {
      flashMessage('INVALID 8-ROW HEX MASK', 1400);
      return false;
    }
  }

  function drawEditorPreview() {
    const pv = $('editorPreview');
    if (!pv) return;
    const pctx = pv.getContext('2d');
    pctx.clearRect(0, 0, pv.width, pv.height);
    drawSpritePixels(pctx, Game.editor.pixels, 0, 0, 16, Game.editor.color);
  }

  function drawSpritePixels(g, pixels, ox, oy, scale, color) {
    g.fillStyle = color;
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        if (pixels[r][c]) g.fillRect(ox + c * scale, oy + r * scale, scale, scale);
      }
    }
  }

  function exportSprite() {
    const hex = C.encodeSpriteMask(Game.editor.pixels);
    const name = (ui.editorName && ui.editorName.value.trim()) || 'CUSTOM';
    const payload = {
      name: name,
      width: 8,
      height: 8,
      rows: hex.split('/'),
      hex: hex,
      palette: Game.editor.color
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'retrosave-sprite-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    flashMessage('SPRITE JSON EXPORTED', 1200);
  }

  /* ----------------------- visualizer ----------------------------- */

  function updateVisualizer(dt) {
    Game.vizPhase += dt * 1.6;
    const seedRng = new C.RNG(Math.floor(Game.vizPhase * 8));
    for (let i = 0; i < Game.vizBars.length; i += 1) {
      const wave = Math.abs(Math.sin(Game.vizPhase * (0.6 + i * 0.012) + i * 0.35));
      const noise = seedRng.next() * 0.35;
      const target = (wave * 0.7 + noise) * (0.55 + 0.45 * Math.sin(Game.vizPhase + i * 0.08) ** 2);
      Game.vizBars[i] += (target - Game.vizBars[i]) * 0.18;
    }
  }

  /* ----------------------- button wiring -------------------------- */

  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    switch (act) {
      case 'start':
        startGame(ui.seedInput ? ui.seedInput.value : Game.seed);
        break;
      case 'resume': setMode('play'); break;
      case 'pause':
        if (Game.mode === 'play') setMode('pause');
        else if (Game.mode === 'pause') setMode('play');
        break;
      case 'step-frame':
        stepSingleFrame();
        break;
      case 'quit': setMode('play'); break;
      case 'scores': setMode('scores'); break;
      case 'title': setMode('play'); break;
      case 'editor': Game.editorReturn = Game.mode; setMode('editor'); break;
      case 'editor-back': setMode('play'); break;
      case 'viz': toggleVisualizer(); break;
      case 'replay': exportReplay(); setMode('replay'); break;
      case 'export-replay': exportReplay(); break;
      case 'copy-replay': copyReplay(); break;
      case 'import-replay': importReplay(); break;
      case 'clear-editor':
        Game.editor.pixels = Array.from({ length: 8 }, function () { return new Array(8).fill(0); });
        buildEditorGrid(); drawEditorPreview();
        break;
      case 'fill-editor':
        Game.editor.pixels = Array.from({ length: 8 }, function () { return new Array(8).fill(1); });
        buildEditorGrid(); drawEditorPreview();
        break;
      case 'load-default': editorLoadHex(C.DEFAULT_SPRITES.player); break;
      case 'flip-x':
        Game.editor.pixels = C.flipSprite(Game.editor.pixels, 'x');
        buildEditorGrid(); drawEditorPreview(); break;
      case 'flip-y':
        Game.editor.pixels = C.flipSprite(Game.editor.pixels, 'y');
        buildEditorGrid(); drawEditorPreview(); break;
      case 'rotate':
        Game.editor.pixels = C.rotateSprite(Game.editor.pixels);
        buildEditorGrid(); drawEditorPreview(); break;
      case 'load-hex':
        if (ui.editorHex) editorLoadHex(ui.editorHex.value.trim());
        break;
      case 'export-sprite': exportSprite(); break;
      case 'apply-sprite':
        spriteCache.player = Game.editor.pixels.map(function (r) { return r.slice(); });
        spriteCache.playerAlt = Game.editor.pixels.map(function (r) { return r.slice(); });
        flashMessage('PLAYER CHR-ROM PATCHED', 1200);
        setMode('play');
        break;
      case 'retry': startGame(Game.seed); break;
      case 'save-run': exportReplay(); setMode('replay'); break;
      default: break;
    }
  });

  if (ui.editorHex) {
    ui.editorHex.addEventListener('change', function () { editorLoadHex(ui.editorHex.value.trim()); });
  }

  const colorPicker = $('editorColor');
  if (colorPicker) {
    colorPicker.addEventListener('input', function () {
      Game.editor.color = colorPicker.value;
      drawEditorPreview();
    });
  }

  /* ----------------------- rendering ------------------------------ */

  const spriteCache = {};
  function getSprite(name) {
    if (spriteCache[name]) return spriteCache[name];
    spriteCache[name] = C.parseSpriteMask(C.DEFAULT_SPRITES[name] || C.DEFAULT_SPRITES.grunt).pixels;
    return spriteCache[name];
  }

  function drawSprite(g, name, ox, oy, scale, color) {
    const px = getSprite(name);
    g.fillStyle = color;
    for (let r = 0; r < 8; r += 1) {
      for (let c = 0; c < 8; c += 1) {
        if (px[r][c]) g.fillRect(Math.round(ox + c * scale), Math.round(oy + r * scale), Math.ceil(scale), Math.ceil(scale));
      }
    }
  }

  // Hardware ROM monitor colors for the dungeon viewport
  const VIEWPORT_COLORS = {
    bg: '#100e0b',
    wall: '#262119',
    wallEdge: '#473e30',
    floor: '#171410',
    floorDot: '#2c261d',
    player: '#f0b44c',
    enemy: '#d9534f',
    boss: '#ff8533',
    bullet: '#fff0b3',
    pickup: '#5cd685',
    exit: '#d9822b',
    hud: '#ede4d3',
    hudDim: '#8c8270'
  };

  function drawLevel(g, level) {
    g.fillStyle = VIEWPORT_COLORS.bg;
    g.fillRect(0, 0, VW, VH);
    const ox = 0;
    const oy = 0;
    for (let y = 0; y < level.height; y += 1) {
      for (let x = 0; x < level.width; x += 1) {
        const t = level.tiles[y * level.width + x];
        const sx = ox + x * TP;
        const sy = oy + y * TP;
        if (t === C.TILE.WALL) {
          g.fillStyle = VIEWPORT_COLORS.wall;
          g.fillRect(sx, sy, TP, TP);
          g.fillStyle = VIEWPORT_COLORS.wallEdge;
          g.fillRect(sx, sy, TP, 1);
          g.fillRect(sx, sy, 1, TP);
        } else {
          g.fillStyle = VIEWPORT_COLORS.floor;
          g.fillRect(sx, sy, TP, TP);
          g.fillStyle = VIEWPORT_COLORS.floorDot;
          g.fillRect(sx + TP / 2, sy + TP / 2, 2, 2);
          if (t === C.TILE.EXIT) {
            g.strokeStyle = VIEWPORT_COLORS.exit;
            g.lineWidth = 2;
            g.strokeRect(sx + 4, sy + 4, TP - 8, TP - 8);
            g.fillStyle = VIEWPORT_COLORS.exit;
            g.fillRect(sx + 9, sy + 9, 6, 6);
          } else if (t === C.TILE.SPAWN) {
            g.strokeStyle = VIEWPORT_COLORS.hudDim;
            g.lineWidth = 1;
            g.strokeRect(sx + 3, sy + 3, TP - 6, TP - 6);
          }
        }
      }
    }

    // pickups
    for (let i = 0; i < level.pickups.length; i += 1) {
      const pk = level.pickups[i];
      if (pk.taken) continue;
      drawSprite(g, 'pickup', ox + pk.x * TP + 2, oy + pk.y * TP + 2, (TP - 4) / 8, VIEWPORT_COLORS.pickup);
    }

    // enemies
    for (let i = 0; i < level.enemies.length; i += 1) {
      const en = level.enemies[i];
      if (en.dead) continue;
      const nm = en.kind === 'DRONE' ? 'drone' : (en.kind === 'SENTINEL' ? 'sentinel' : 'grunt');
      drawSprite(g, nm, ox + en.x * TP + 2, oy + en.y * TP, (TP - 4) / 8, VIEWPORT_COLORS.enemy);
    }

    // boss
    if (level.boss && !level.boss.dead) {
      const b = level.boss;
      const pulse = 0.85 + 0.15 * Math.sin(Game.vizPhase * 4);
      g.globalAlpha = pulse;
      drawSprite(g, 'boss', ox + b.x * TP - 12, oy + b.y * TP - 12, (TP + 24) / 8, VIEWPORT_COLORS.boss);
      g.globalAlpha = 1;
      const maxHp = 6 + (Game.sim ? Game.sim.levelIndex : 0) * 2;
      g.fillStyle = '#301a08';
      g.fillRect(ox + b.x * TP - 20, oy + b.y * TP - 30, 64, 5);
      g.fillStyle = VIEWPORT_COLORS.boss;
      g.fillRect(ox + b.x * TP - 20, oy + b.y * TP - 30, 64 * Math.max(0, b.hp) / maxHp, 5);
    }
  }

  function drawBullets(g, sim) {
    for (let i = 0; i < sim.bullets.length; i += 1) {
      const b = sim.bullets[i];
      g.fillStyle = VIEWPORT_COLORS.bullet;
      g.fillRect(b.x * TP - 3, b.y * TP - 3, 6, 6);
      g.globalAlpha = 0.35;
      g.fillRect(b.x * TP - 6, b.y * TP - 6, 12, 12);
      g.globalAlpha = 1;
    }
  }

  function drawPlayer(g, sim) {
    const p = sim.player;
    if (p.invuln > 0 && Math.floor(p.invuln / 3) % 2 === 0) return;
    const useAlt = Math.floor(sim.frame / 12) % 2 === 0;
    const spr = useAlt ? 'player' : 'playerAlt';
    drawSprite(g, spr, p.x * TP - 12, p.y * TP - 12, TP / 8, VIEWPORT_COLORS.player);
    g.fillStyle = VIEWPORT_COLORS.bullet;
    g.fillRect(p.x * TP + p.facing.x * 9 - 1, p.y * TP + p.facing.y * 9 - 1, 3, 3);
  }

  function drawParticles(g) {
    for (let i = 0; i < Game.particles.length; i += 1) {
      const p = Game.particles[i];
      g.globalAlpha = Math.max(0, p.life / p.max);
      g.fillStyle = p.color;
      g.fillRect(p.x * TP - 2, p.y * TP - 2, 4, 4);
    }
    g.globalAlpha = 1;
  }

  function drawHUD(g, sim) {
    g.fillStyle = 'rgba(14,12,9,0.88)';
    g.fillRect(0, 0, VW, 32);
    g.fillStyle = VIEWPORT_COLORS.wallEdge;
    g.fillRect(0, 31, VW, 1);
    g.font = 'bold 14px "Courier New", monospace';
    g.textBaseline = 'middle';
    g.fillStyle = VIEWPORT_COLORS.player;
    g.fillText('SCORE ' + String(sim.score).padStart(6, '0'), 14, 16);
    g.fillStyle = VIEWPORT_COLORS.hud;
    g.fillText('FLR ' + String(sim.levelIndex + 1).padStart(2, '0') + '/12', 190, 16);
    g.fillStyle = VIEWPORT_COLORS.bullet;
    g.fillText('CLK ' + C.formatTime(sim.frame) + ' [F:' + sim.frame + ']', 310, 16);
    let hx = 545;
    for (let i = 0; i < 5; i += 1) {
      g.fillStyle = i < sim.player.hp ? VIEWPORT_COLORS.pickup : '#2e2920';
      g.fillRect(hx + i * 15, 10, 11, 11);
    }
    g.fillStyle = VIEWPORT_COLORS.enemy;
    g.fillText('LIVES:' + sim.lives, 635, 16);
    g.fillStyle = VIEWPORT_COLORS.hudDim;
    g.fillText(Game.replayFrames ? 'REPLAY VERIFY' : 'SEED:' + Game.seed.slice(0, 14), 730, 16);

    const cd = sim.player.dashCooldown;
    g.fillStyle = '#2e2920';
    g.fillRect(14, VH - 16, 110, 7);
    g.fillStyle = cd <= 0 ? VIEWPORT_COLORS.player : VIEWPORT_COLORS.hudDim;
    g.fillRect(14, VH - 16, 110 * (1 - cd / 60), 7);
    g.font = '10px "Courier New", monospace';
    g.fillStyle = VIEWPORT_COLORS.hudDim;
    g.fillText('DASH CD', 132, VH - 12);
  }

  function drawCenterText(g, title, subtitle, accent) {
    g.fillStyle = 'rgba(14,12,9,0.84)';
    g.fillRect(0, VH / 2 - 75, VW, 150);
    g.strokeStyle = VIEWPORT_COLORS.wallEdge;
    g.strokeRect(1, VH / 2 - 75, VW - 2, 150);
    g.textAlign = 'center';
    g.font = 'bold 38px "Courier New", monospace';
    g.fillStyle = accent || VIEWPORT_COLORS.player;
    g.fillText(title, VW / 2, VH / 2 - 18);
    g.font = '15px "Courier New", monospace';
    g.fillStyle = VIEWPORT_COLORS.hud;
    g.fillText(subtitle, VW / 2, VH / 2 + 18);
    g.font = '12px "Courier New", monospace';
    g.fillStyle = VIEWPORT_COLORS.hudDim;
    g.fillText('ENTER: RESUME / RESTART   |   PERIOD (.): STEP +1 FRAME', VW / 2, VH / 2 + 48);
    g.textAlign = 'left';
  }

  function drawScene(now) {
    const g = sctx;
    if (Game.mode === 'visualizer') {
      drawVisualizerScene(g);
    } else if (Game.sim) {
      g.save();
      if (Game.shake > 0) {
        g.translate((Math.random() - 0.5) * Game.shake, (Math.random() - 0.5) * Game.shake);
      }
      drawLevel(g, Game.sim.level);
      drawBullets(g, Game.sim);
      drawParticles(g);
      drawPlayer(g, Game.sim);
      g.restore();
      drawHUD(g, Game.sim);
      if (Game.mode === 'pause') drawCenterText(g, 'HALTED // FRAME ' + Game.sim.frame, 'Fixed dt = 16.667 ms. Press . to step 1 frame or Enter to resume.', VIEWPORT_COLORS.bullet);
      if (Game.mode === 'gameover') drawCenterText(g, 'RUN TERMINATED', 'SCORE ' + (Game.finalScore ? Game.finalScore.score : 0) + '  |  CLK ' + C.formatTime(Game.sim.frame), VIEWPORT_COLORS.enemy);
      if (Game.mode === 'win') drawCenterText(g, 'ALL 12 FLOORS VERIFIED', 'FINAL SCORE ' + (Game.finalScore ? Game.finalScore.score : 0) + '  |  CLK ' + C.formatTime(Game.sim.frame), VIEWPORT_COLORS.pickup);
    } else {
      drawVisualizerScene(g);
    }

    if (Game.message && now < Game.messageUntil) {
      g.textAlign = 'center';
      g.font = 'bold 15px "Courier New", monospace';
      g.fillStyle = VIEWPORT_COLORS.bullet;
      g.fillText(Game.message, VW / 2, 52);
      g.textAlign = 'left';
    }

    if (Game.flash > 0) {
      g.fillStyle = 'rgba(255,240,200,' + (Game.flash * 0.28).toFixed(3) + ')';
      g.fillRect(0, 0, VW, VH);
    }
  }

  function drawVisualizerScene(g) {
    g.fillStyle = VIEWPORT_COLORS.bg;
    g.fillRect(0, 0, VW, VH);
    const t = Game.vizPhase;
    // Oscilloscope grid
    g.strokeStyle = '#241f18';
    g.lineWidth = 1;
    for (let x = 0; x < VW; x += 48) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, VH); g.stroke();
    }
    for (let y = 0; y < VH; y += 48) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(VW, y); g.stroke();
    }
    const bw = VW / Game.vizBars.length;
    for (let i = 0; i < Game.vizBars.length; i += 1) {
      const h = Game.vizBars[i] * 320;
      g.fillStyle = i % 2 ? VIEWPORT_COLORS.player : VIEWPORT_COLORS.exit;
      g.fillRect(i * bw + 3, VH - h - 40, bw - 6, h);
      g.fillStyle = VIEWPORT_COLORS.bullet;
      g.fillRect(i * bw + 3, VH - h - 45, bw - 6, 3);
    }
    g.textAlign = 'center';
    g.font = 'bold 28px "Courier New", monospace';
    g.fillStyle = VIEWPORT_COLORS.player;
    g.fillText('PSG 48-BAND SPECTRUM ANALYZER', VW / 2, 80);
    g.font = '13px "Courier New", monospace';
    g.fillStyle = VIEWPORT_COLORS.hud;
    g.fillText('SEED: ' + Game.seed + '  |  PRESS V OR CLICK TAB 01 TO RETURN TO DUNGEON VIEWPORT', VW / 2, 112);
    g.textAlign = 'left';
  }

  function drawCRT() {
    ctx.drawImage(scene, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < VH; y += 3) ctx.fillRect(0, y, VW, 1);
  }

  /* ----------------------- main loop ------------------------------ */

  let lastTelUpdate = 0;
  function frame(now) {
    if (!Game.lastTime) Game.lastTime = now;
    let dt = (now - Game.lastTime) / 1000;
    Game.lastTime = now;
    if (dt > 0.25) dt = 0.25;

    if (Game.mode === 'play' && Game.sim) {
      Game.accumulator += dt;
      let steps = 0;
      while (Game.accumulator >= C.FIXED_DT && steps < 8) {
        playStep();
        Game.accumulator -= C.FIXED_DT;
        steps += 1;
        if (Game.mode !== 'play') break;
      }
    } else {
      updateParticles();
      Game.accumulator = 0;
    }

    updateVisualizer(dt, now);
    drawScene(now);
    drawCRT(now);
    if (now - lastTelUpdate > 80) {
      updateTelemetry();
      updateHudText();
      lastTelUpdate = now;
    }
    requestAnimationFrame(frame);
  }

  function updateHudText() {
    if (!ui.hud) return;
    const bits = [];
    bits.push('DT 16.67MS');
    if (Game.sim) {
      bits.push(Game.replayFrames ? 'VERIFY ' + Game.replayCursor + '/' + Game.replayFrames.length : 'REC ' + Game.frames.length + 'F');
    }
    bits.push('PSG ' + (Synth.enabled ? 'ON' : 'MUTED'));
    bits.push('STATE ' + Game.mode.toUpperCase());
    ui.hud.textContent = bits.join(' | ');
  }

  /* ----------------------- boot ----------------------------------- */

  const params = new URLSearchParams(location.search);
  const seedParam = params.get('seed');
  if (seedParam) Game.seed = seedParam.toUpperCase();
  if (ui.seedInput) ui.seedInput.value = Game.seed;
  Game.scores = loadScores();
  buildChrRomTable();
  buildEditorGrid();
  drawEditorPreview();
  // Boot immediately into a live, playable Floor 1 run on load
  startGame(Game.seed);
  requestAnimationFrame(frame);

  // Expose a debug handle for browser console and deterministic testing.
  window.RetroSave = {
    Game: Game,
    Core: C,
    start: startGame,
    exportReplay: exportReplay,
    importReplay: importReplay,
    step: fixedStep
  };
}(typeof window !== "undefined" ? window : globalThis));
