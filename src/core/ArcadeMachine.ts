import { AudioManager } from './AudioManager';
import { GameManager } from './GameManager';
import { InputManager } from './InputManager';
import { StateManager, type AppState } from './StateManager';
import { StorageManager } from './StorageManager';
import { Cabinet } from '../ui/Cabinet';
import { MazeChaser } from '../games/maze-chaser/MazeChaser';
import { StarInvaders } from '../games/star-invaders/StarInvaders';
import { VectorRocks } from '../games/vector-rocks/VectorRocks';
import { BlockBreaker } from '../games/block-breaker/BlockBreaker';
import { RetroPong } from '../games/retro-pong/RetroPong';
import { FallingBlocks } from '../games/falling-blocks/FallingBlocks';
import { NeonSnake } from '../games/neon-snake/NeonSnake';
import type { ArcadeSettings, CrtStrength, GameId, GameServices } from '../types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../types';

interface GameInfo {
  id: GameId;
  title: string;
  tagline: string;
  instructions: string;
  color: string;
}

const GAMES: GameInfo[] = [
  { id: 'maze-chaser', title: 'PAC-MAN', tagline: 'CHASE THE LIGHT', instructions: 'COLLECT EVERY SPARK · OUTSMART FOUR HUNTERS', color: '#ffe45b' },
  { id: 'star-invaders', title: 'SPACE INVADERS', tagline: 'DEFEND THE LAST SKY', instructions: 'MOVE · FIRE · PROTECT YOUR BARRIERS', color: '#65ff9b' },
  { id: 'vector-rocks', title: 'ASTEROIDS', tagline: 'NEON SPACE PATROL', instructions: 'ROTATE · THRUST · SPLIT THE ROCKS', color: '#8ffcff' },
  { id: 'block-breaker', title: 'BREAKOUT', tagline: 'BREAK THE GRID', instructions: 'BOUNCE · CATCH POWER-UPS · CLEAR THE WALL', color: '#ff8a4c' },
  { id: 'retro-pong', title: 'PONG', tagline: 'THE FIRST DUEL', instructions: 'FIRST TO ELEVEN · ANGLES ARE EVERYTHING', color: '#f4f4e8' },
  { id: 'falling-blocks', title: 'TETRIS', tagline: 'ORDER FROM CHAOS', instructions: 'ROTATE · HOLD · BUILD PERFECT LINES', color: '#cb72ff' },
  { id: 'neon-snake', title: 'SNAKE', tagline: 'GROW INTO THE NIGHT', instructions: 'EAT · GROW · NEVER TURN BACK', color: '#40ffcf' },
];

const PAUSE_ITEMS = ['RESUME', 'RESTART', 'GAME SELECT', 'SETTINGS', 'POWER OFF'];
const SETTINGS_ITEMS = [
  'MASTER VOLUME', 'MUSIC / HUM', 'SFX VOLUME', 'MUTE', 'CRT EFFECT',
  'SCANLINES', 'FLICKER', 'RGB SHIFT', 'GLOW', 'FULLSCREEN',
  'RESET HIGH SCORES', 'BACK',
] as const;
type SettingsItem = typeof SETTINGS_ITEMS[number];

const CRT_LEVELS: CrtStrength[] = ['off', 'low', 'medium', 'high'];
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export interface MachineSnapshot {
  state: AppState;
  selectedGame: GameId;
  activeGame: GameId | '';
  score: number;
  highScore: number;
}

export class ArcadeMachine {
  private readonly storage = new StorageManager();
  private readonly states = new StateManager();
  private readonly games = new GameManager();
  private readonly audio: AudioManager;
  private readonly input: InputManager;
  private readonly cabinet: Cabinet;
  private animationFrame = 0;
  private lastTimestamp = 0;
  private idleSeconds = 0;
  private menuIndex = 0;
  private pauseIndex = 0;
  private settingsIndex = 0;
  private settingsOrigin: 'MAIN_MENU' | 'PAUSED' = 'MAIN_MENU';
  private selectedGame: GameId = GAMES[0].id;
  private activeGame: GameId | '' = '';
  private gameOverScore = 0;
  private newHighScore = false;
  private notice = '';
  private noticeTimer = 0;
  private attractSeconds = 0;
  private randomSeed = 0x1988;

  constructor(root: HTMLElement) {
    this.audio = new AudioManager(this.storage.settings);
    this.input = new InputManager(
      () => this.handleActivity(),
      () => { void this.toggleFullscreen(); },
      () => this.pauseOnBlur(),
    );
    this.cabinet = new Cabinet(root, this.input, () => {
      this.handleActivity();
      this.audio.play('button');
      void this.toggleFullscreen();
    });
    this.registerGames();
    this.input.subscribe((action, isDown) => {
      if (!isDown) return;
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') this.audio.play('move');
      else if (action === 'buttonA' || action === 'buttonB' || action === 'buttonC' || action === 'start') this.audio.play('button');
    });
    this.cabinet.setSettings(this.storage.settings);
    this.audio.play('crtOn');
    this.animationFrame = requestAnimationFrame((time) => this.frame(time));
  }

  getSnapshot(): MachineSnapshot {
    const game = this.games.current;
    return {
      state: this.states.state,
      selectedGame: this.selectedGame,
      activeGame: this.activeGame,
      score: game?.score ?? this.gameOverScore,
      highScore: this.storage.getHighScore(this.activeGame || this.selectedGame),
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.input.destroy();
    this.games.unload();
    this.cabinet.destroy();
    this.audio.destroy();
  }

  private registerGames(): void {
    this.games.register('maze-chaser', (services) => new MazeChaser(services));
    this.games.register('star-invaders', (services) => new StarInvaders(services));
    this.games.register('vector-rocks', (services) => new VectorRocks(services));
    this.games.register('block-breaker', (services) => new BlockBreaker(services));
    this.games.register('retro-pong', (services) => new RetroPong(services));
    this.games.register('falling-blocks', (services) => new FallingBlocks(services));
    this.games.register('neon-snake', (services) => new NeonSnake(services));
  }

  private frame(timestamp: number): void {
    const wallSeconds = this.lastTimestamp === 0 ? 0 : clamp((timestamp - this.lastTimestamp) / 1000, 0, 1);
    const deltaSeconds = Math.min(wallSeconds, 0.05);
    this.lastTimestamp = timestamp;
    this.states.update(wallSeconds);
    this.idleSeconds += wallSeconds;
    this.update(deltaSeconds, wallSeconds);
    this.render(timestamp / 1000);
    this.cabinet.syncControls(this.input.horizontal, this.input.vertical);
    this.cabinet.update(deltaSeconds);
    this.input.endFrame();
    this.animationFrame = requestAnimationFrame((time) => this.frame(time));
  }

  private update(deltaSeconds: number, wallSeconds: number): void {
    this.cabinet.setState(this.states.state);
    if (this.noticeTimer > 0) {
      this.noticeTimer -= wallSeconds;
      if (this.noticeTimer <= 0) this.notice = '';
    }

    switch (this.states.state) {
      case 'POWER_OFF':
        if (this.input.pressed('start') || this.input.pressed('buttonA')) this.powerOn();
        break;
      case 'BOOTING':
        if (this.input.pressed('start') || this.states.stateElapsed >= 4.65) this.enterMainMenu();
        break;
      case 'MAIN_MENU':
        this.updateMainMenu();
        if (this.idleSeconds >= 30) this.enterAttractMode();
        break;
      case 'GAME_LOADING':
        if (this.states.stateElapsed >= 1.18) {
          this.states.set('PLAYING');
          this.games.current?.resume();
        }
        break;
      case 'PLAYING':
        if (this.input.pressed('pause')) this.pauseGame();
        else {
          this.games.current?.update(deltaSeconds, this.input);
          this.storage.recordPlayTime(deltaSeconds);
        }
        break;
      case 'PAUSED': this.updatePauseMenu(); break;
      case 'GAME_OVER':
        if (this.input.pressed('start') || this.input.pressed('buttonA') || this.input.pressed('pause')) this.enterMainMenu();
        break;
      case 'ATTRACT_MODE':
        this.attractSeconds += wallSeconds;
        break;
      case 'SETTINGS': this.updateSettingsMenu(); break;
      case 'HALL_OF_FAME':
        if (this.input.pressed('start') || this.input.pressed('buttonA') || this.input.pressed('pause')) this.enterMainMenu();
        break;
    }
  }

  private updateMainMenu(): void {
    const total = GAMES.length + 3;
    if (this.input.pressed('up')) this.menuIndex = (this.menuIndex - 1 + total) % total;
    if (this.input.pressed('down')) this.menuIndex = (this.menuIndex + 1) % total;
    if (this.menuIndex < GAMES.length) this.selectedGame = GAMES[this.menuIndex].id;
    if (!(this.input.pressed('start') || this.input.pressed('buttonA'))) return;
    this.audio.play('confirm');
    if (this.menuIndex < GAMES.length) {
      this.launchGame(GAMES[this.menuIndex].id);
      return;
    }
    if (this.menuIndex === GAMES.length) this.states.set('HALL_OF_FAME');
    else if (this.menuIndex === GAMES.length + 1) this.openSettings('MAIN_MENU');
    else this.powerOff();
  }

  private updatePauseMenu(): void {
    if (this.input.pressed('pause')) {
      this.resumeGame();
      return;
    }
    if (this.input.pressed('up')) this.pauseIndex = (this.pauseIndex - 1 + PAUSE_ITEMS.length) % PAUSE_ITEMS.length;
    if (this.input.pressed('down')) this.pauseIndex = (this.pauseIndex + 1) % PAUSE_ITEMS.length;
    if (!(this.input.pressed('start') || this.input.pressed('buttonA'))) return;
    this.audio.play('confirm');
    switch (this.pauseIndex) {
      case 0: this.resumeGame(); break;
      case 1:
        this.games.restart();
        this.audio.play('start');
        this.states.set('GAME_LOADING');
        break;
      case 2: this.enterMainMenu(); break;
      case 3: this.openSettings('PAUSED'); break;
      case 4: this.powerOff(); break;
    }
  }

  private updateSettingsMenu(): void {
    if (this.input.pressed('pause')) {
      this.closeSettings();
      return;
    }
    if (this.input.pressed('up')) this.settingsIndex = (this.settingsIndex - 1 + SETTINGS_ITEMS.length) % SETTINGS_ITEMS.length;
    if (this.input.pressed('down')) this.settingsIndex = (this.settingsIndex + 1) % SETTINGS_ITEMS.length;
    const direction = Number(this.input.pressed('right')) - Number(this.input.pressed('left'));
    const activate = this.input.pressed('start') || this.input.pressed('buttonA');
    if (direction !== 0) this.adjustSetting(SETTINGS_ITEMS[this.settingsIndex], direction);
    if (activate) this.activateSetting(SETTINGS_ITEMS[this.settingsIndex]);
  }

  private adjustSetting(item: SettingsItem, direction: number): void {
    const settings = this.storage.settings;
    switch (item) {
      case 'MASTER VOLUME': this.commitSettings({ masterVolume: clamp(settings.masterVolume + direction * 0.1, 0, 1) }); break;
      case 'MUSIC / HUM': this.commitSettings({ musicVolume: clamp(settings.musicVolume + direction * 0.1, 0, 1) }); break;
      case 'SFX VOLUME': this.commitSettings({ sfxVolume: clamp(settings.sfxVolume + direction * 0.1, 0, 1) }); break;
      case 'CRT EFFECT': {
        const index = CRT_LEVELS.indexOf(settings.crtStrength);
        this.commitSettings({ crtStrength: CRT_LEVELS[(index + direction + CRT_LEVELS.length) % CRT_LEVELS.length] });
        break;
      }
      case 'MUTE': this.commitSettings({ muted: direction > 0 }); break;
      case 'SCANLINES': this.commitSettings({ scanlines: direction > 0 }); break;
      case 'FLICKER': this.commitSettings({ flicker: direction > 0 }); break;
      case 'RGB SHIFT': this.commitSettings({ rgbShift: direction > 0 }); break;
      case 'GLOW': this.commitSettings({ glow: direction > 0 }); break;
      default: break;
    }
    this.audio.play('move');
  }

  private activateSetting(item: SettingsItem): void {
    const settings = this.storage.settings;
    switch (item) {
      case 'MUTE': this.commitSettings({ muted: !settings.muted }); break;
      case 'SCANLINES': this.commitSettings({ scanlines: !settings.scanlines }); break;
      case 'FLICKER': this.commitSettings({ flicker: !settings.flicker }); break;
      case 'RGB SHIFT': this.commitSettings({ rgbShift: !settings.rgbShift }); break;
      case 'GLOW': this.commitSettings({ glow: !settings.glow }); break;
      case 'FULLSCREEN': void this.toggleFullscreen(); break;
      case 'RESET HIGH SCORES':
        this.storage.resetHighScores();
        this.showNotice('HIGH SCORES RESET', 1.4);
        this.audio.play('confirm');
        break;
      case 'BACK': this.closeSettings(); break;
      default: this.adjustSetting(item, 1); break;
    }
  }

  private commitSettings(patch: Partial<ArcadeSettings>): void {
    const settings = this.storage.updateSettings(patch);
    this.audio.updateSettings(settings);
    this.cabinet.setSettings(settings);
  }

  private launchGame(id: GameId): void {
    this.activeGame = id;
    this.selectedGame = id;
    this.cabinet.setGame(id);
    const services = this.createGameServices(id);
    this.games.load(id, services);
    this.games.pause();
    this.storage.recordGame(id);
    this.states.set('GAME_LOADING');
    this.cabinet.flash('#ffffff', 0.52);
    this.audio.play('start');
  }

  private createGameServices(id: GameId): GameServices {
    return {
      sound: (name) => this.audio.play(name),
      flash: (color, intensity) => this.cabinet.flash(color, intensity),
      highScore: () => this.storage.getHighScore(id),
      endGame: (score) => this.finishGame(id, score),
    };
  }

  private finishGame(id: GameId, score: number): void {
    if (this.activeGame !== id || (this.states.state !== 'PLAYING' && this.states.state !== 'GAME_LOADING')) return;
    this.gameOverScore = Math.max(0, Math.floor(score));
    this.newHighScore = this.storage.updateHighScore(id, this.gameOverScore);
    this.games.pause();
    this.states.set('GAME_OVER');
    if (this.newHighScore) this.audio.play('highscore');
    this.cabinet.flash(this.newHighScore ? '#ffe66d' : '#ff315f', 0.55);
  }

  private pauseGame(): void {
    if (this.states.state !== 'PLAYING') return;
    this.games.pause();
    this.pauseIndex = 0;
    this.states.set('PAUSED');
  }

  private resumeGame(): void {
    this.games.resume();
    this.states.set('PLAYING');
  }

  private pauseOnBlur(): void {
    if (this.states.state === 'PLAYING') this.pauseGame();
  }

  private openSettings(origin: 'MAIN_MENU' | 'PAUSED'): void {
    this.settingsOrigin = origin;
    this.settingsIndex = 0;
    this.states.set('SETTINGS');
  }

  private closeSettings(): void {
    this.states.set(this.settingsOrigin);
  }

  private enterMainMenu(): void {
    this.games.unload();
    this.activeGame = '';
    this.cabinet.setGame('');
    this.states.set('MAIN_MENU');
    this.idleSeconds = 0;
    this.attractSeconds = 0;
    this.gameOverScore = 0;
    this.newHighScore = false;
  }

  private enterAttractMode(): void {
    this.attractSeconds = 0;
    this.states.set('ATTRACT_MODE');
  }

  private handleActivity(): void {
    this.idleSeconds = 0;
    void this.audio.unlock();
    if (this.states.state === 'ATTRACT_MODE') this.enterMainMenu();
  }

  private showNotice(message: string, duration: number): void {
    this.notice = message;
    this.noticeTimer = duration;
  }

  private powerOn(): void {
    this.states.set('BOOTING');
    this.idleSeconds = 0;
    this.audio.setPowered(true);
    this.audio.play('crtOn');
  }

  private powerOff(): void {
    this.games.unload();
    this.activeGame = '';
    this.cabinet.setGame('');
    this.audio.play('crtOff');
    this.audio.setPowered(false);
    this.states.set('POWER_OFF');
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      this.showNotice('FULLSCREEN UNAVAILABLE', 1.4);
    }
  }

  private render(time: number): void {
    const ctx = this.cabinet.context;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#010403';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    switch (this.states.state) {
      case 'POWER_OFF': this.renderPowerOff(ctx); break;
      case 'BOOTING': this.renderBoot(ctx, time); break;
      case 'MAIN_MENU': this.renderMainMenu(ctx, time); break;
      case 'GAME_LOADING': this.renderGameLoading(ctx, time); break;
      case 'PLAYING': this.games.current?.render(ctx); break;
      case 'PAUSED':
        this.games.current?.render(ctx);
        this.renderPause(ctx, time);
        break;
      case 'GAME_OVER':
        this.games.current?.render(ctx);
        this.renderGameOver(ctx, time);
        break;
      case 'ATTRACT_MODE': this.renderAttract(ctx, time); break;
      case 'SETTINGS': this.renderSettings(ctx, time); break;
      case 'HALL_OF_FAME': this.renderHallOfFame(ctx, time); break;
    }
    ctx.restore();
    this.updateAccessibleStatus();
  }

  private renderPowerOff(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    if (this.states.stateElapsed < 0.58) {
      const fade = 1 - this.states.stateElapsed / 0.58;
      ctx.fillStyle = `rgba(190,255,226,${fade})`;
      ctx.fillRect(191, 143, 2, 2);
    }
  }

  private renderBoot(ctx: CanvasRenderingContext2D, time: number): void {
    const t = this.states.stateElapsed;
    if (t < 0.62) {
      const width = clamp((t - 0.12) * 900, 0, SCREEN_WIDTH);
      ctx.fillStyle = '#d4fff2';
      ctx.shadowColor = '#76ffe0';
      ctx.shadowBlur = 12;
      ctx.fillRect((SCREEN_WIDTH - width) / 2, 143, width, 2);
      return;
    }
    if (t < 1.05) {
      for (let i = 0; i < 190; i += 1) {
        const x = Math.floor(this.random() * SCREEN_WIDTH);
        const y = Math.floor(this.random() * SCREEN_HEIGHT);
        const shade = Math.floor(this.random() * 150 + 60);
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x, y, 1 + Math.floor(this.random() * 4), 1);
      }
      return;
    }
    this.drawFrame(ctx, '#53ffd5');
    ctx.textAlign = 'center';
    ctx.shadowColor = '#53ffd5';
    ctx.shadowBlur = 7;
    ctx.fillStyle = '#d9fff4';
    ctx.font = 'bold 26px monospace';
    ctx.fillText('RETRO ARCADE', 192, 55);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#4d8b7a';
    ctx.font = '8px monospace';
    ctx.fillText('RA/OS 8-BIT SYSTEM  © 1988', 192, 72);
    ctx.textAlign = 'left';
    ctx.font = '10px monospace';
    const lines: Array<[number, string]> = [
      [1.18, 'INITIALIZING PHOSPHOR DISPLAY... OK'],
      [1.78, 'CHECKING MEMORY  64K........... OK'],
      [2.38, 'LOADING ORIGINAL GAME MODULES...'],
      [3.02, '7 GAMES FOUND'],
      [3.48, 'AUDIO / CONTROLS................. OK'],
      [3.9, 'SYSTEM READY'],
    ];
    let y = 105;
    for (const [threshold, text] of lines) {
      if (t >= threshold) {
        ctx.fillStyle = text === 'SYSTEM READY' ? '#fff26d' : '#78e8ca';
        ctx.fillText(text, 36, y);
      }
      y += 21;
    }
    if (t > 4.08 && Math.floor(time * 3) % 2 === 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff4f9f';
      ctx.fillText('PRESS START TO SKIP', 192, 260);
    }
  }

  private renderMainMenu(ctx: CanvasRenderingContext2D, time: number): void {
    this.drawStarfield(ctx, time, '#183e3d');
    this.drawTitle(ctx, 'RETRO ARCADE', '#62ffe1');
    ctx.textAlign = 'center';
    ctx.font = '8px monospace';
    ctx.fillStyle = '#a987b1';
    ctx.fillText('SELECT GAME', 192, 47);
    ctx.textAlign = 'left';
    const startY = 65;
    for (let index = 0; index < GAMES.length; index += 1) {
      const game = GAMES[index];
      const y = startY + index * 21;
      const selected = this.menuIndex === index;
      if (selected) {
        ctx.fillStyle = '#153d39';
        ctx.fillRect(36, y - 11, 312, 17);
        ctx.strokeStyle = game.color;
        ctx.strokeRect(36.5, y - 10.5, 311, 16);
      }
      ctx.font = `${selected ? 'bold ' : ''}10px monospace`;
      ctx.fillStyle = selected ? game.color : '#8bbab1';
      ctx.shadowColor = selected ? game.color : 'transparent';
      ctx.shadowBlur = selected ? 5 : 0;
      ctx.fillText(selected ? '▶' : ' ', 42, y);
      ctx.fillText(game.title, 58, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = selected ? '#eafff8' : '#52766f';
      ctx.fillText(String(this.storage.getHighScore(game.id)).padStart(6, '0'), 340, y);
      ctx.textAlign = 'left';
      ctx.shadowBlur = 0;
    }
    const utilities = ['HALL OF FAME', 'SETTINGS', 'POWER OFF'];
    for (let i = 0; i < utilities.length; i += 1) {
      const index = GAMES.length + i;
      const selected = this.menuIndex === index;
      const x = 55 + i * 116;
      ctx.font = `${selected ? 'bold ' : ''}8px monospace`;
      ctx.fillStyle = selected ? '#ffd55d' : '#735e79';
      ctx.textAlign = 'center';
      ctx.fillText(`${selected ? '▶ ' : ''}${utilities[i]}`, x, 229);
    }
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = this.notice ? '#ffdf67' : '#64ffe0';
    const prompt = this.notice || 'PRESS START TO PLAY';
    if (this.notice || Math.floor(time * 2) % 2 === 0) ctx.fillText(prompt, 192, 258);
    ctx.font = '8px monospace';
    ctx.fillStyle = '#77b0a5';
    ctx.fillText('7 CLASSIC GAMES · HIGH SCORES SAVED', 192, 276);
  }

  private renderGameLoading(ctx: CanvasRenderingContext2D, time: number): void {
    const info = GAMES.find((game) => game.id === this.activeGame)!;
    const elapsed = this.states.stateElapsed;
    if (elapsed < 0.34) {
      for (let y = 0; y < SCREEN_HEIGHT; y += 3) {
        const offset = Math.floor(this.random() * 26);
        ctx.fillStyle = this.random() > .52 ? '#bed6d0' : '#17211f';
        ctx.fillRect(offset, y, SCREEN_WIDTH - offset * 2, 1);
      }
      return;
    }
    this.drawStarfield(ctx, time, info.color);
    ctx.textAlign = 'center';
    ctx.shadowColor = info.color;
    ctx.shadowBlur = 9;
    ctx.fillStyle = info.color;
    ctx.font = 'bold 24px monospace';
    ctx.fillText(info.title, 192, 104);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#b6d9d1';
    ctx.font = '8px monospace';
    ctx.fillText(info.tagline, 192, 125);
    ctx.fillStyle = '#fff17b';
    ctx.font = 'bold 13px monospace';
    if (elapsed > .62) ctx.fillText('READY!', 192, 173);
    ctx.fillStyle = '#647b77';
    ctx.font = '8px monospace';
    ctx.fillText(info.instructions, 192, 212);
  }

  private renderPause(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.fillStyle = '#010307d9';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawPanel(ctx, 80, 37, 224, 218, '#62ffe1');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e6fff8';
    ctx.shadowColor = '#62ffe1';
    ctx.shadowBlur = 7;
    ctx.font = 'bold 25px monospace';
    ctx.fillText('PAUSED', 192, 73);
    ctx.shadowBlur = 0;
    for (let i = 0; i < PAUSE_ITEMS.length; i += 1) {
      const selected = i === this.pauseIndex;
      ctx.font = `${selected ? 'bold ' : ''}11px monospace`;
      ctx.fillStyle = selected ? '#fff16a' : '#6fa49a';
      ctx.fillText(`${selected ? '▶ ' : ''}${PAUSE_ITEMS[i]}`, 192, 116 + i * 25);
    }
    ctx.font = '7px monospace';
    ctx.fillStyle = Math.floor(time * 2) % 2 ? '#725a79' : '#92759c';
    ctx.fillText('ESC TO RESUME', 192, 239);
  }

  private renderGameOver(ctx: CanvasRenderingContext2D, time: number): void {
    ctx.fillStyle = '#030004dd';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawPanel(ctx, 52, 46, 280, 196, this.newHighScore ? '#ffe860' : '#ff3f75');
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = '#ff507f';
    ctx.shadowColor = '#ff285f';
    ctx.shadowBlur = 8;
    ctx.fillText('GAME OVER', 192, 84);
    ctx.shadowBlur = 0;
    ctx.font = '11px monospace';
    ctx.fillStyle = '#bddbd4';
    ctx.fillText(`SCORE      ${String(this.gameOverScore).padStart(7, '0')}`, 192, 121);
    ctx.fillText(`HIGH SCORE ${String(this.storage.getHighScore(this.activeGame as GameId)).padStart(7, '0')}`, 192, 143);
    if (this.newHighScore && Math.floor(time * 4) % 2 === 0) {
      ctx.fillStyle = '#ffe85d';
      ctx.font = 'bold 13px monospace';
      ctx.fillText('★ NEW HIGH SCORE! ★', 192, 174);
    }
    ctx.fillStyle = '#70d7c3';
    ctx.font = '9px monospace';
    if (Math.floor(time * 2) % 2 === 0) ctx.fillText('PRESS START', 192, 215);
  }

  private renderSettings(ctx: CanvasRenderingContext2D, time: number): void {
    this.drawStarfield(ctx, time, '#35264a');
    this.drawTitle(ctx, 'SETTINGS', '#cf75ff');
    const settings = this.storage.settings;
    const values: Record<SettingsItem, string> = {
      'MASTER VOLUME': this.barValue(settings.masterVolume),
      'MUSIC / HUM': this.barValue(settings.musicVolume),
      'SFX VOLUME': this.barValue(settings.sfxVolume),
      'MUTE': settings.muted ? 'ON' : 'OFF',
      'CRT EFFECT': settings.crtStrength.toUpperCase(),
      'SCANLINES': settings.scanlines ? 'ON' : 'OFF',
      'FLICKER': settings.flicker ? 'ON' : 'OFF',
      'RGB SHIFT': settings.rgbShift ? 'ON' : 'OFF',
      'GLOW': settings.glow ? 'ON' : 'OFF',
      'FULLSCREEN': document.fullscreenElement ? 'ON' : 'OFF',
      'RESET HIGH SCORES': '',
      'BACK': '',
    };
    ctx.font = '9px monospace';
    for (let index = 0; index < SETTINGS_ITEMS.length; index += 1) {
      const item = SETTINGS_ITEMS[index];
      const y = 57 + index * 16;
      const selected = index === this.settingsIndex;
      if (selected) {
        ctx.fillStyle = '#2a1740';
        ctx.fillRect(47, y - 10, 290, 14);
      }
      ctx.fillStyle = selected ? '#f4c9ff' : '#8b75a0';
      ctx.textAlign = 'left';
      ctx.fillText(`${selected ? '▶ ' : '  '}${item}`, 52, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = selected ? '#fff072' : '#5eb6a7';
      ctx.fillText(values[item], 331, y);
    }
    if (this.notice) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe964';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(this.notice, 192, 274);
    }
  }

  private renderHallOfFame(ctx: CanvasRenderingContext2D, time: number): void {
    this.drawStarfield(ctx, time, '#3a2812');
    this.drawTitle(ctx, 'HALL OF FAME', '#ffd65b');
    this.drawPanel(ctx, 38, 53, 308, 184, '#a77b2f');
    ctx.font = '10px monospace';
    for (let index = 0; index < GAMES.length; index += 1) {
      const game = GAMES[index];
      const y = 78 + index * 21;
      ctx.textAlign = 'left';
      ctx.fillStyle = game.color;
      ctx.fillText(`${index + 1}. ${game.title}`, 54, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f5eed8';
      ctx.fillText(String(this.storage.getHighScore(game.id)).padStart(8, '0'), 328, y);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#856f4e';
    ctx.font = '7px monospace';
    ctx.fillText(`${this.storage.stats.gamesPlayed} GAMES PLAYED · RECORDS SAVED LOCALLY`, 192, 253);
    ctx.fillStyle = '#d8c27f';
    if (Math.floor(time * 2) % 2 === 0) ctx.fillText('PRESS START TO RETURN', 192, 270);
  }

  private renderAttract(ctx: CanvasRenderingContext2D, time: number): void {
    const cycle = 6;
    const index = Math.floor(this.attractSeconds / cycle) % GAMES.length;
    const local = this.attractSeconds % cycle;
    const game = GAMES[index];
    this.drawStarfield(ctx, time, game.color);
    if (local < 2.5) {
      this.drawTitle(ctx, game.title, game.color);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e9fff9';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('HOW TO PLAY', 192, 91);
      ctx.fillStyle = '#8cbcb2';
      ctx.font = '9px monospace';
      const parts = game.instructions.split(' · ');
      parts.forEach((part, i) => ctx.fillText(part, 192, 123 + i * 20));
      ctx.fillStyle = '#fff269';
      ctx.font = '8px monospace';
      ctx.fillText(`HIGH SCORE ${String(this.storage.getHighScore(game.id)).padStart(7, '0')}`, 192, 203);
    } else {
      this.renderAttractDemo(ctx, game, local - 2.5, time);
    }
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#ff4f9b';
    if (Math.floor(time * 2) % 2 === 0) ctx.fillText('PRESS START', 192, 265);
  }

  private renderAttractDemo(ctx: CanvasRenderingContext2D, game: GameInfo, local: number, time: number): void {
    ctx.textAlign = 'center';
    ctx.fillStyle = game.color;
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`${game.title} · DEMO`, 192, 31);
    ctx.strokeStyle = '#235047';
    ctx.strokeRect(31.5, 48.5, 321, 181);
    const phase = time * 1.7;
    switch (game.id) {
      case 'maze-chaser':
        ctx.strokeStyle = '#375fff';
        for (let x = 55; x < 340; x += 40) ctx.strokeRect(x, 70, 20, 135);
        ctx.fillStyle = '#ffe557';
        for (let x = 43; x < 340; x += 16) ctx.fillRect(x, 134, 2, 2);
        ctx.beginPath(); ctx.arc(85 + (phase * 35) % 230, 135, 7, .2, Math.PI * 1.8); ctx.lineTo(85 + (phase * 35) % 230, 135); ctx.fill();
        ctx.fillStyle = '#ff4e8b'; ctx.fillRect(300 - (phase * 24) % 210, 129, 12, 12);
        break;
      case 'star-invaders':
        for (let row = 0; row < 3; row += 1) for (let col = 0; col < 8; col += 1) {
          ctx.fillStyle = row === 0 ? '#ff7ec6' : '#78ffb1';
          ctx.fillRect(72 + col * 31 + Math.sin(phase) * 12, 70 + row * 23, 13, 8);
        }
        ctx.fillStyle = '#7bffff'; ctx.fillRect(176 + Math.sin(phase * 1.5) * 85, 204, 31, 6);
        ctx.fillStyle = '#fff'; ctx.fillRect(191 + Math.sin(phase * 1.5) * 85, 172 - (local * 40) % 100, 2, 8);
        break;
      case 'vector-rocks':
        ctx.strokeStyle = '#a1fff4'; ctx.shadowColor = '#55ffe9'; ctx.shadowBlur = 5;
        for (let i = 0; i < 7; i += 1) {
          const x = 60 + ((i * 57 + phase * 18) % 275); const y = 67 + ((i * 39 + phase * 9) % 140);
          ctx.beginPath(); for (let p = 0; p < 7; p += 1) { const a = p / 7 * Math.PI * 2; const r = 8 + (p % 2) * 4; const px=x+Math.cos(a)*r,py=y+Math.sin(a)*r;p?ctx.lineTo(px,py):ctx.moveTo(px,py); } ctx.closePath();ctx.stroke();
        }
        ctx.save();ctx.translate(192,145);ctx.rotate(phase);ctx.beginPath();ctx.moveTo(13,0);ctx.lineTo(-9,-8);ctx.lineTo(-5,0);ctx.lineTo(-9,8);ctx.closePath();ctx.stroke();ctx.restore();ctx.shadowBlur=0;
        break;
      case 'block-breaker':
        for (let row=0;row<5;row+=1)for(let col=0;col<10;col+=1){ctx.fillStyle=`hsl(${row*38+local*10} 75% 58%)`;ctx.fillRect(48+col*29,65+row*14,25,9)}
        ctx.fillStyle='#fff';ctx.fillRect(160+Math.sin(phase)*90,209,64,7);ctx.beginPath();ctx.arc(192+Math.cos(phase)*100,153+Math.sin(phase)*55,4,0,Math.PI*2);ctx.fill();
        break;
      case 'retro-pong':
        ctx.fillStyle='#eee';for(let y=53;y<225;y+=14)ctx.fillRect(191,y,2,7);ctx.fillRect(43,118+Math.sin(phase)*55,5,40);ctx.fillRect(336,118+Math.sin(phase+.7)*48,5,40);ctx.fillRect(188+Math.sin(phase)*136,133+Math.cos(phase*1.3)*67,6,6);
        break;
      case 'falling-blocks':
        ctx.strokeStyle='#584071';ctx.strokeRect(139,55,106,169);for(let y=0;y<7;y+=1)for(let x=0;x<10;x+=1)if((x+y*3)%4===0||y>5){ctx.fillStyle=['#54f7dd','#ffdf54','#c66eff','#ff678d'][x%4];ctx.fillRect(142+x*10,211-y*10,8,8)}ctx.fillStyle='#56dfff';ctx.fillRect(182,72+(local*34)%100,18,8);ctx.fillRect(192,82+(local*34)%100,8,8);
        break;
      case 'neon-snake':
        ctx.strokeStyle='#133a35';for(let x=48;x<340;x+=12){ctx.beginPath();ctx.moveTo(x,60);ctx.lineTo(x,216);ctx.stroke()}for(let y=60;y<216;y+=12){ctx.beginPath();ctx.moveTo(48,y);ctx.lineTo(336,y);ctx.stroke()}ctx.fillStyle='#48ffd2';for(let i=0;i<12;i+=1)ctx.fillRect(75+i*12,120+Math.sin((i+phase)*.6)*12,10,10);ctx.fillStyle='#ff557e';ctx.fillRect(276,156,10,10);
        break;
    }
  }

  private updateAccessibleStatus(): void {
    const game = this.games.current;
    const selected = GAMES.find((entry) => entry.id === this.selectedGame)?.title ?? '';
    const parts = [
      this.states.state.replaceAll('_', ' '),
      'READY TO PLAY',
      this.activeGame ? `GAME ${GAMES.find((entry) => entry.id === this.activeGame)?.title}` : `SELECTED ${selected}`,
    ];
    if (game) parts.push(`SCORE ${game.score}`, `LEVEL ${game.level}`, `LIVES ${game.lives}`);
    if (this.states.state === 'PAUSED') parts.push(`PAUSE ITEM ${PAUSE_ITEMS[this.pauseIndex]}`);
    if (this.states.state === 'SETTINGS') parts.push(`SETTING ${SETTINGS_ITEMS[this.settingsIndex]}`);
    if (this.states.state === 'MAIN_MENU' && this.menuIndex >= GAMES.length) {
      parts.push(`MENU ITEM ${['HALL OF FAME', 'SETTINGS', 'POWER OFF'][this.menuIndex - GAMES.length]}`);
    }
    if (this.notice) parts.push(this.notice);
    this.cabinet.setStatus(parts.join(' · '));
  }

  private drawTitle(ctx: CanvasRenderingContext2D, text: string, color: string): void {
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(text, 192, 32);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.globalAlpha = .42;
    ctx.beginPath();ctx.moveTo(58,42.5);ctx.lineTo(326,42.5);ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawFrame(ctx: CanvasRenderingContext2D, color: string): void {
    ctx.strokeStyle = color;
    ctx.globalAlpha = .35;
    ctx.strokeRect(16.5, 14.5, 351, 259);
    ctx.fillStyle = color;
    for (const [x, y] of [[16,14],[362,14],[16,268],[362,268]]) ctx.fillRect(x, y, 6, 6);
    ctx.globalAlpha = 1;
  }

  private drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string): void {
    ctx.fillStyle = '#06100fef';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = color;
    ctx.globalAlpha = .65;
    ctx.strokeRect(x + .5, y + .5, width - 1, height - 1);
    ctx.strokeRect(x + 4.5, y + 4.5, width - 9, height - 9);
    ctx.globalAlpha = 1;
  }

  private drawStarfield(ctx: CanvasRenderingContext2D, time: number, color: string): void {
    ctx.fillStyle = '#010706';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    for (let i = 0; i < 46; i += 1) {
      const x = (i * 83 + Math.floor(time * (i % 3 + 1) * 2)) % SCREEN_WIDTH;
      const y = (i * 47 + 17) % SCREEN_HEIGHT;
      ctx.globalAlpha = .1 + (i % 5) * .055;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, i % 11 === 0 ? 2 : 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  private barValue(value: number): string {
    const blocks = Math.round(value * 8);
    return `${'■'.repeat(blocks)}${'·'.repeat(8 - blocks)} ${Math.round(value * 100)}`;
  }

  private random(): number {
    this.randomSeed = (this.randomSeed * 1664525 + 1013904223) >>> 0;
    return this.randomSeed / 0x100000000;
  }
}
