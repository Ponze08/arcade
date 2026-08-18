export const SCREEN_WIDTH = 384;
export const SCREEN_HEIGHT = 288;

export type GameId =
  | 'maze-chaser'
  | 'star-invaders'
  | 'vector-rocks'
  | 'block-breaker'
  | 'retro-pong'
  | 'falling-blocks'
  | 'neon-snake';

export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'buttonA'
  | 'buttonB'
  | 'buttonC'
  | 'start'
  | 'coin'
  | 'pause';

export type SoundName =
  | 'move'
  | 'button'
  | 'coin'
  | 'start'
  | 'confirm'
  | 'shot'
  | 'hit'
  | 'explosion'
  | 'death'
  | 'powerup'
  | 'line'
  | 'food'
  | 'level'
  | 'gameover'
  | 'highscore'
  | 'crtOn'
  | 'crtOff';

export interface InputFrame {
  down(action: Action): boolean;
  pressed(action: Action): boolean;
  released(action: Action): boolean;
  readonly horizontal: number;
  readonly vertical: number;
}

export interface GameServices {
  sound(name: SoundName): void;
  endGame(score: number): void;
  flash(color?: string, intensity?: number): void;
  highScore(): number;
}

export interface ArcadeGame {
  readonly id: GameId;
  readonly title: string;
  readonly controls: string;
  readonly score: number;
  readonly level: number;
  readonly lives: number;
  start(): void;
  update(deltaSeconds: number, input: InputFrame): void;
  render(ctx: CanvasRenderingContext2D): void;
  pause(): void;
  resume(): void;
  reset(): void;
  destroy(): void;
}

export type GameFactory = (services: GameServices) => ArcadeGame;

export interface HighScores {
  'maze-chaser': number;
  'star-invaders': number;
  'vector-rocks': number;
  'block-breaker': number;
  'retro-pong': number;
  'falling-blocks': number;
  'neon-snake': number;
}

export type CrtStrength = 'off' | 'low' | 'medium' | 'high';

export interface ArcadeSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  crtStrength: CrtStrength;
  scanlines: boolean;
  flicker: boolean;
  rgbShift: boolean;
  glow: boolean;
  freePlay: boolean;
}

export interface ArcadeStats {
  gamesPlayed: number;
  totalPlaySeconds: number;
  coinsInserted: number;
  playsByGame: Record<GameId, number>;
}

export interface StoredArcadeData {
  version: 1;
  highScores: HighScores;
  settings: ArcadeSettings;
  stats: ArcadeStats;
}
