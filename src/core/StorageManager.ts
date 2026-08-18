import type { ArcadeSettings, ArcadeStats, GameId, HighScores, StoredArcadeData } from '../types';

const STORAGE_KEY = 'retro-arcade.machine.v1';
const GAME_IDS: GameId[] = [
  'maze-chaser', 'star-invaders', 'vector-rocks', 'block-breaker',
  'retro-pong', 'falling-blocks', 'neon-snake',
];

const defaultScores = (): HighScores => ({
  'maze-chaser': 0,
  'star-invaders': 0,
  'vector-rocks': 0,
  'block-breaker': 0,
  'retro-pong': 0,
  'falling-blocks': 0,
  'neon-snake': 0,
});

const defaultSettings = (): ArcadeSettings => ({
  masterVolume: 0.72,
  musicVolume: 0.45,
  sfxVolume: 0.72,
  muted: false,
  crtStrength: 'medium',
  scanlines: true,
  flicker: true,
  rgbShift: true,
  glow: true,
});

const defaultStats = (): ArcadeStats => ({
  gamesPlayed: 0,
  totalPlaySeconds: 0,
  playsByGame: Object.fromEntries(GAME_IDS.map((id) => [id, 0])) as Record<GameId, number>,
});

const defaults = (): StoredArcadeData => ({
  version: 1,
  highScores: defaultScores(),
  settings: defaultSettings(),
  stats: defaultStats(),
});

export class StorageManager {
  private data: StoredArcadeData = defaults();
  private available = true;
  private unsavedPlaySeconds = 0;

  constructor() { this.load(); }

  get settings(): ArcadeSettings { return { ...this.data.settings }; }
  get highScores(): HighScores { return { ...this.data.highScores }; }
  get stats(): ArcadeStats {
    return { ...this.data.stats, playsByGame: { ...this.data.stats.playsByGame } };
  }

  getHighScore(id: GameId): number { return this.data.highScores[id] ?? 0; }

  updateHighScore(id: GameId, score: number): boolean {
    const value = Math.max(0, Math.floor(score));
    if (value <= this.getHighScore(id)) return false;
    this.data.highScores[id] = value;
    this.save();
    return true;
  }

  resetHighScores(): void {
    this.data.highScores = defaultScores();
    this.save();
  }

  updateSettings(patch: Partial<ArcadeSettings>): ArcadeSettings {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.settings;
  }

  recordGame(id: GameId): void {
    this.data.stats.gamesPlayed += 1;
    this.data.stats.playsByGame[id] = (this.data.stats.playsByGame[id] ?? 0) + 1;
    this.save();
  }

  recordPlayTime(seconds: number): void {
    this.data.stats.totalPlaySeconds += seconds;
    this.unsavedPlaySeconds += seconds;
    if (this.unsavedPlaySeconds >= 10) {
      this.unsavedPlaySeconds = 0;
      this.save();
    }
  }

  private load(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoredArcadeData>;
      const baseline = defaults();
      this.data = {
        version: 1,
        highScores: { ...baseline.highScores, ...(parsed.highScores ?? {}) },
        settings: { ...baseline.settings, ...(parsed.settings ?? {}) },
        stats: {
          ...baseline.stats,
          ...(parsed.stats ?? {}),
          playsByGame: { ...baseline.stats.playsByGame, ...(parsed.stats?.playsByGame ?? {}) },
        },
      };
    } catch {
      this.available = false;
      this.data = defaults();
    }
  }

  private save(): void {
    if (!this.available) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      this.available = false;
    }
  }
}
