import type { ArcadeGame, GameId, GameServices, InputFrame } from '../types';

export abstract class BaseGame implements ArcadeGame {
  abstract readonly id: GameId;
  abstract readonly title: string;
  abstract readonly controls: string;
  score = 0;
  level = 1;
  lives = 3;
  protected paused = false;
  protected ended = false;

  constructor(protected readonly services: GameServices) {}

  abstract start(): void;
  abstract update(deltaSeconds: number, input: InputFrame): void;
  abstract render(ctx: CanvasRenderingContext2D): void;

  pause(): void { this.paused = true; }
  resume(): void { this.paused = false; }
  reset(): void { this.start(); }
  destroy(): void { this.paused = true; }

  protected gameOver(): void {
    if (this.ended) return;
    this.ended = true;
    this.services.sound('gameover');
    this.services.endGame(this.score);
  }

  protected drawHud(ctx: CanvasRenderingContext2D, accent = '#7dffeb'): void {
    ctx.save();
    ctx.font = 'bold 9px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 4;
    ctx.fillText(`SCORE ${String(this.score).padStart(6, '0')}`, 8, 6);
    ctx.textAlign = 'center';
    ctx.fillText(`HI ${String(Math.max(this.score, this.services.highScore())).padStart(6, '0')}`, 192, 6);
    ctx.textAlign = 'right';
    ctx.fillText(`L${String(this.level).padStart(2, '0')}  LIFE ${this.lives}`, 376, 6);
    ctx.restore();
  }
}
