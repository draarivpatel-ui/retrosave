'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./game.js');
const { createPage, auditPage } = require('./dom-harness.cjs');
const action = (page, name) => { const button = page.document.querySelector('[data-act="' + name + '"]'); assert.ok(button); button.click(); };

test('real page boots a connected dungeon, valid DOM references, sprites, and silent audio', () => {
  const page = createPage(__dirname, { storageBlocked: true });
  auditPage(page);
  assert.equal(page.window.RetroSave.Game.sim.frame, 0);
  assert.match(page.get('bfsBadge').textContent, /100%/);
  assert.match(page.get('telPath').textContent, /tile moves/);
  assert.equal(page.get('chrRomTableBody').querySelectorAll('tr').length, 9);
  assert.equal(page.get('editorGrid').querySelectorAll('button').length, 64);
  assert.equal(page.get('audioBtn').getAttribute('aria-pressed'), 'false');
  page.flushFrame();
  assert.ok(page.get('screen').context.calls.length > 0);
});

test('fixed-timestep input recording follows keyboard state and exported frame count', () => {
  const page = createPage(__dirname); page.flushFrame(); page.key('KeyD'); page.flushFrame(100); page.key('KeyD', 'keyup');
  const game = page.window.RetroSave.Game;
  assert.equal(game.sim.frame, 6); assert.equal(game.frames.length, 6); assert.ok(game.frames.every(mask => mask === C.INPUT.RIGHT));
  const replay = C.parseReplay(page.window.RetroSave.exportReplay());
  assert.equal(replay.length, game.sim.frame);
  assert.equal(C.verifyReplay(page.window.RetroSave.exportReplay()).stateMatches, true);
});

test('empty exports contain zero frames and preserve mixed-case URL seeds', () => {
  const page = createPage(__dirname, { search: '?seed=MiXeD%20caf%C3%A9' });
  const replay = C.parseReplay(page.window.RetroSave.exportReplay());
  assert.equal(replay.seed, 'MiXeD café'); assert.equal(replay.length, 0);
  assert.equal(C.verifyReplay(page.window.RetroSave.exportReplay()).stateMatches, true);
});

test('pause keys ignore repeats and focused text fields do not send game input', () => {
  const page = createPage(__dirname); page.key('KeyP'); assert.equal(page.window.RetroSave.Game.mode, 'pause');
  page.key('KeyP', 'keydown', page.document.body, { repeat: true }); assert.equal(page.window.RetroSave.Game.mode, 'pause');
  page.key('KeyP', 'keyup'); page.key('KeyP'); assert.equal(page.window.RetroSave.Game.mode, 'play');
  page.key('KeyD', 'keydown', page.get('seedInput')); page.flushFrame(); page.flushFrame();
  assert.ok(page.window.RetroSave.Game.frames.every(mask => mask === 0));
  page.window.dispatchEvent({ type: 'blur' }); assert.equal(page.window.RetroSave.Game.mode, 'pause');
});

test('invalid replay import leaves the active run intact and exposes a visible error', () => {
  const page = createPage(__dirname), sim = page.window.RetroSave.Game.sim;
  page.get('replayInput').value = 'RSAVE1.bad.bad'; action(page, 'import-replay');
  assert.equal(page.window.RetroSave.Game.sim, sim); assert.match(page.get('replayReport').textContent, /Import rejected/);
  page.get('replayInput').value = C.serializeReplay({ seed: 'S', frames: [], meta: { engineVersion: 'other' } }); action(page, 'import-replay');
  assert.equal(page.window.RetroSave.Game.sim, sim); assert.match(page.get('replayReport').textContent, /another engine/);
});

test('single-step replay consumes saved inputs, records only its prefix, and reproduces its state', () => {
  const page = createPage(__dirname);
  const seed = 'lowercase café', frames = [C.INPUT.RIGHT, C.INPUT.SHOOT, 0];
  const sim = C.makeSim(seed); for (const mask of frames) C.stepSim(sim, mask);
  page.get('replayInput').value = C.serializeReplay({ seed, frames, meta: { engineVersion: C.ENGINE_VERSION, stateDigest: C.simulationDigest(sim) } });
  action(page, 'import-replay');
  action(page, 'step-frame');
  assert.deepEqual(Array.from(page.window.RetroSave.Game.frames), frames.slice(0, 1));
  assert.equal(C.parseReplay(page.window.RetroSave.exportReplay()).length, 1);
  action(page, 'step-frame'); action(page, 'step-frame');
  assert.equal(page.window.RetroSave.Game.mode, 'pause'); assert.equal(page.window.RetroSave.Game.sim.frame, 3);
  assert.equal(C.simulationDigest(page.window.RetroSave.Game.sim), C.simulationDigest(sim));
  assert.match(page.get('replayReport').textContent, /matches the reference/);
});

test('inspector resimulates displayed tokens without changing the current game', () => {
  const page = createPage(__dirname), sim = page.window.RetroSave.Game.sim;
  page.window.RetroSave.step(0); const token = page.window.RetroSave.exportReplay();
  page.get('replayInput').value = token; action(page, 'inspect-replay');
  assert.match(page.get('replayReport').textContent, /State matches: yes/);
  assert.match(page.get('replayReport').textContent, /Frames: 1/);
  assert.equal(page.window.RetroSave.Game.sim, sim);
});

test('touch inputs support multiple held actions and release on cancellation', () => {
  const page = createPage(__dirname); page.flushFrame();
  const right = page.document.querySelector('[data-input="RIGHT"]'), fire = page.document.querySelector('[data-input="SHOOT"]');
  page.fire(right, 'pointerdown', { pointerId: 1 }); page.fire(fire, 'pointerdown', { pointerId: 2 }); page.flushFrame();
  assert.equal(page.window.RetroSave.Game.frames.at(-1), C.INPUT.RIGHT | C.INPUT.SHOOT);
  page.window.dispatchEvent({ type: 'pointercancel', pointerId: 1 }); page.window.dispatchEvent({ type: 'pointerup', pointerId: 2 }); page.flushFrame();
  assert.equal(page.window.RetroSave.Game.frames.at(-1), 0); assert.equal(right.getAttribute('aria-pressed'), 'false');
});

test('sprite grid, transforms, validated JSON import, and appearance patching are wired', async () => {
  const page = createPage(__dirname); action(page, 'editor');
  const first = page.get('editorGrid').querySelector('button'); first.click();
  assert.equal(first.getAttribute('aria-pressed'), 'true');
  action(page, 'rotate'); action(page, 'flip-x'); action(page, 'export-sprite');
  const download = page.document.downloads.at(-1), sheet = C.importSpriteSheet(await page.blobs.get(download.href).text());
  assert.equal(sheet.hex, page.get('editorHex').value);
  const altered = { ...sheet, name: 'Blue', palette: '#28598a', rows: C.DEFAULT_SPRITES.boss.split('/'), hex: C.DEFAULT_SPRITES.boss };
  page.get('spriteJson').value = C.exportSpriteSheet(altered); action(page, 'import-sprite'); action(page, 'apply-sprite');
  assert.equal(page.window.RetroSave.Game.playerColor, '#28598a');
  assert.equal(page.get('editorName').value, 'Blue');
  const before = page.get('editorHex').value; page.get('spriteJson').value = '{}'; action(page, 'import-sprite'); assert.equal(page.get('editorHex').value, before);
});

test('theme, signal display, score view, and clipboard fallback are connected', () => {
  const page = createPage(__dirname);
  page.get('sheetToggle').click(); assert.equal(page.document.documentElement.getAttribute('data-sheet'), 'charcoal');
  action(page, 'viz'); assert.equal(page.window.RetroSave.Game.mode, 'visualizer'); page.flushFrame();
  action(page, 'title'); action(page, 'scores'); assert.match(page.get('scoreList').textContent, /No scores/);
  action(page, 'replay'); const token = page.get('replayInput').value; action(page, 'copy-replay');
  assert.equal(page.get('replayInput').value, token); assert.equal(page.get('replayInput').selected, true);
  auditPage(page);
});

test('unavailable audio remains muted and reports the actual state', async () => {
  const page = createPage(__dirname);
  let created = 0; page.window.AudioContext = class { constructor() { created++; throw new Error('blocked'); } };
  assert.equal(created, 0); page.get('audioBtn').click(); assert.equal(created, 1);
  assert.equal(page.get('audioBtn').getAttribute('aria-pressed'), 'false'); assert.match(page.get('workbenchStatus').textContent, /unavailable/);
  const suspended = createPage(__dirname);
  suspended.window.AudioContext = class {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 0, setTargetAtTime() {} }, connect() {} }; }
    resume() { return Promise.reject(new Error('blocked')); }
  };
  suspended.get('audioBtn').click(); await Promise.resolve();
  assert.equal(suspended.get('audioBtn').getAttribute('aria-pressed'), 'false');
  assert.match(suspended.get('workbenchStatus').textContent, /could not resume/);
});

test('damaged stored scores are discarded before rendering', () => {
  const good = C.serializeScore({ name: 'AAA', score: 10, level: 1, timeFrames: 60, seed: 'S', date: '2026-11-15' });
  const page = createPage(__dirname, { storage: { 'retrosave.scores.v1': good + '\nRSCORE1.invalid.invalid' } });
  action(page, 'scores'); assert.equal(page.get('scoreList').querySelectorAll('.score-row').length, 1);
});

test('stored score ledgers render only the highest eight valid entries', () => {
  const scores = Array.from({ length: 10 }, (_, score) => C.serializeScore({ name: 'AAA', score, level: 1, timeFrames: 60, seed: 'S', date: '2026-11-15' })).join('\n');
  const page = createPage(__dirname, { storage: { 'retrosave.scores.v1': scores } });
  action(page, 'scores');
  assert.equal(page.get('scoreList').querySelectorAll('.score-row').length, 8);
  assert.deepEqual(Array.from(page.window.RetroSave.Game.scores, entry => entry.score), [9, 8, 7, 6, 5, 4, 3, 2]);
});

test('completed live runs enter the ledger and replay playback does not add duplicate scores', () => {
  for (const isReplay of [false, true]) {
    const page = createPage(__dirname);
    if (isReplay) page.window.RetroSave.start('S', [0]);
    const sim = page.window.RetroSave.Game.sim;
    sim.lives = 1; sim.player.hp = 1;
    sim.level.enemies = [{ x: Math.floor(sim.player.x), y: Math.floor(sim.player.y), hp: 3, kind: 'GRUNT' }];
    page.window.RetroSave.step(0);
    assert.equal(sim.status, 'gameover'); assert.equal(sim.frame, 1);
    const stored = page.storage.get('retrosave.scores.v1');
    if (isReplay) assert.equal(stored, undefined);
    else { assert.ok(C.parseScore(stored)); assert.equal(C.parseScore(stored).timeFrames, 1); }
  }
});

test('unavailable gamepad access falls back to keyboard input without uncaught errors', () => {
  const page = createPage(__dirname); page.navigator.getGamepads = () => { throw new Error('unavailable'); };
  page.flushFrame(); page.key('KeyD'); page.flushFrame();
  assert.equal(page.window.RetroSave.Game.frames.at(-1), C.INPUT.RIGHT);
});
