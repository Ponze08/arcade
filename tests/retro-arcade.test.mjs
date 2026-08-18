import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const cwd = process.cwd();
const gameDefinitions = [
  ['maze-chaser', 'MazeChaser'],
  ['star-invaders', 'StarInvaders'],
  ['vector-rocks', 'VectorRocks'],
  ['block-breaker', 'BlockBreaker'],
  ['retro-pong', 'RetroPong'],
  ['falling-blocks', 'FallingBlocks'],
  ['neon-snake', 'NeonSnake'],
];

test('production bundle contains the complete arcade shell', async () => {
  const html = await readFile(join(cwd, 'dist', 'index.html'), 'utf8');
  assert.match(html, /<title>Retro Arcade<\/title>/);
  const assets = await readdir(join(cwd, 'dist', 'assets'));
  assert.ok(assets.some((name) => name.endsWith('.js')), 'JavaScript bundle missing');
  assert.ok(assets.some((name) => name.endsWith('.css')), 'Cabinet stylesheet missing');
});

test('all seven games are concrete BaseGame implementations', async () => {
  for (const [folder, className] of gameDefinitions) {
    const source = await readFile(join(cwd, 'src', 'games', folder, `${className}.ts`), 'utf8');
    assert.match(source, new RegExp(`export class ${className} extends BaseGame`));
    assert.match(source, /update\s*\(/);
    assert.match(source, /render\s*\(/);
    assert.doesNotMatch(source, /addEventListener|setInterval/);
    const unfinishedMarker = new RegExp(`\\b${['TO', 'DO'].join('')}\\b|\\b${['place', 'holder'].join('')}\\b`, 'i');
    assert.doesNotMatch(source, unfinishedMarker);
  }
});

test('input, audio, storage and state are centralized', async () => {
  const input = await readFile(join(cwd, 'src', 'core', 'InputManager.ts'), 'utf8');
  const machine = await readFile(join(cwd, 'src', 'core', 'ArcadeMachine.ts'), 'utf8');
  const storage = await readFile(join(cwd, 'src', 'core', 'StorageManager.ts'), 'utf8');
  assert.match(input, /ArrowUp: 'up'/);
  assert.match(input, /KeyZ: 'buttonA'/);
  assert.match(input, /Digit5: 'coin'/);
  for (const state of ['POWER_OFF', 'BOOTING', 'MAIN_MENU', 'GAME_LOADING', 'PLAYING', 'PAUSED', 'GAME_OVER', 'ATTRACT_MODE', 'SETTINGS', 'HALL_OF_FAME']) {
    assert.ok(machine.includes(state), `state ${state} is not integrated`);
  }
  for (const [id] of gameDefinitions) assert.ok(machine.includes(`'${id}'`), `${id} is not registered`);
  assert.match(storage, /localStorage\.setItem/);
  assert.match(storage, /updateHighScore/);
});

test('cabinet exposes physical controls and CRT layers', async () => {
  const cabinet = await readFile(join(cwd, 'src', 'ui', 'Cabinet.ts'), 'utf8');
  for (const testId of ['joystick', 'button-a', 'button-b', 'button-c', 'start-button', 'coin-button', 'crt-screen', 'screen-status']) {
    assert.ok(cabinet.includes(`data-testid=\\"${testId}\\"`) || cabinet.includes(`data-testid="${testId}"`), `${testId} missing`);
  }
  for (const layer of ['crt-scanlines', 'crt-noise', 'crt-vignette', 'crt-reflection', 'crt-shutdown']) {
    assert.ok(cabinet.includes(layer), `${layer} missing`);
  }
});
