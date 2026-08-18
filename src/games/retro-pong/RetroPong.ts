import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../types';
import type { GameServices, InputFrame } from '../../types';
import { BaseGame } from '../BaseGame';

interface PongBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  trail: Array<{ x: number; y: number }>;
}

interface Dust {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const ARENA_TOP = 34;
const ARENA_BOTTOM = 278;
const PLAYER_X = 24;
const CPU_X = SCREEN_WIDTH - 24;
const PADDLE_WIDTH = 6;
const PADDLE_HEIGHT = 44;
const TARGET_SCORE = 9;

/** Minimal early-arcade pong with a fallible, progressively stronger CPU opponent. */
export class RetroPong extends BaseGame {
  readonly id = 'retro-pong' as const;
  readonly title = 'PONG';
  readonly controls = 'UP/DOWN: MOVE  •  A: QUICK SERVE';

  private ball: PongBall = this.newBall();
  private playerY = SCREEN_HEIGHT / 2;
  private cpuY = SCREEN_HEIGHT / 2;
  private playerVelocity = 0;
  private cpuVelocity = 0;
  private playerPoints = 0;
  private cpuPoints = 0;
  private rally = 0;
  private bestRally = 0;
  private serveTimer = 0;
  private serveDirection = 1;
  private cpuThinkTimer = 0;
  private cpuTargetY = SCREEN_HEIGHT / 2;
  private pointBannerTimer = 0;
  private visualTime = 0;
  private shakeTimer = 0;
  private dust: Dust[] = [];
  private winner: 'PLAYER' | 'CPU' | null = null;

  constructor(services: GameServices) {
    super(services);
  }

  start(): void {
    this.score = 0;
    this.level = 1;
    this.lives = TARGET_SCORE;
    this.paused = false;
    this.ended = false;
    this.playerY = SCREEN_HEIGHT / 2;
    this.cpuY = SCREEN_HEIGHT / 2;
    this.playerVelocity = 0;
    this.cpuVelocity = 0;
    this.playerPoints = 0;
    this.cpuPoints = 0;
    this.rally = 0;
    this.bestRally = 0;
    this.cpuTargetY = SCREEN_HEIGHT / 2;
    this.cpuThinkTimer = 0;
    this.pointBannerTimer = 0;
    this.visualTime = 0;
    this.shakeTimer = 0;
    this.dust = [];
    this.winner = null;
    this.prepareServe(Math.random() < 0.5 ? -1 : 1, 1.1);
  }

  update(deltaSeconds: number, input: InputFrame): void {
    if (this.paused || this.ended) return;
    const dt = Math.min(0.05, Math.max(0, deltaSeconds));
    this.visualTime += dt;
    this.updateDust(dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    this.pointBannerTimer = Math.max(0, this.pointBannerTimer - dt);

    const move = input.vertical || (input.down('up') ? -1 : input.down('down') ? 1 : 0);
    const oldPlayerY = this.playerY;
    this.playerY += move * 188 * dt;
    this.playerY = this.clampPaddle(this.playerY);
    this.playerVelocity = dt > 0 ? (this.playerY - oldPlayerY) / dt : 0;

    this.updateCpu(dt);

    if (this.serveTimer > 0) {
      if (input.pressed('buttonA')) this.serveTimer = 0;
      else this.serveTimer -= dt;
      this.ball.x = SCREEN_WIDTH / 2;
      this.ball.y = SCREEN_HEIGHT / 2;
      this.ball.trail = [];
      if (this.serveTimer <= 0) this.launchServe();
      return;
    }

    this.advanceBall(dt);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#030704';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawPhosphorNoise(ctx);

    ctx.save();
    if (this.shakeTimer > 0) {
      const magnitude = Math.min(2, this.shakeTimer * 11);
      ctx.translate((Math.random() - 0.5) * magnitude, (Math.random() - 0.5) * magnitude);
    }
    this.drawCourt(ctx);
    this.drawPaddle(ctx, PLAYER_X, this.playerY);
    this.drawPaddle(ctx, CPU_X, this.cpuY);
    this.drawBall(ctx);
    this.drawDust(ctx);
    ctx.restore();

    this.drawScoreboard(ctx);
    this.drawStatus(ctx);
    if (this.ended) {
      const message = this.winner === 'PLAYER' ? 'YOU WIN' : 'CPU WINS';
      this.drawOverlay(ctx, message, `${this.playerPoints}  -  ${this.cpuPoints}`);
    }
    ctx.restore();
  }

  private newBall(): PongBall {
    return { x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2, vx: 0, vy: 0, radius: 3, trail: [] };
  }

  private prepareServe(direction: number, duration: number): void {
    this.serveDirection = direction < 0 ? -1 : 1;
    this.serveTimer = duration;
    this.rally = 0;
    this.ball = this.newBall();
    this.cpuThinkTimer = 0;
    this.cpuTargetY = SCREEN_HEIGHT / 2;
  }

  private launchServe(): void {
    const speed = this.baseSpeed();
    const vertical = (Math.random() * 0.72 - 0.36) * speed;
    this.ball.vx = this.serveDirection * Math.sqrt(Math.max(1, speed * speed - vertical * vertical));
    this.ball.vy = vertical;
    this.services.sound('shot');
  }

  private updateCpu(dt: number): void {
    this.cpuThinkTimer -= dt;
    if (this.cpuThinkTimer <= 0) {
      const progress = this.cpuDifficulty();
      const reaction = 0.19 - progress * 0.115;
      this.cpuThinkTimer = reaction * (0.78 + Math.random() * 0.48);

      if (this.serveTimer > 0) {
        this.cpuTargetY = SCREEN_HEIGHT / 2 + (Math.random() - 0.5) * 12;
      } else if (this.ball.vx > 0) {
        const predicted = this.predictBallYAt(CPU_X - PADDLE_WIDTH / 2 - this.ball.radius);
        const errorRange = 24 - progress * 18;
        const reactionLag = Math.abs(this.ball.vx) * reaction * (Math.random() * 0.5);
        const lagDirection = this.ball.vy === 0 ? 0 : -Math.sign(this.ball.vy);
        this.cpuTargetY = predicted + (Math.random() - 0.5) * errorRange * 2 + lagDirection * reactionLag;
      } else {
        this.cpuTargetY = SCREEN_HEIGHT / 2 + Math.sin(this.visualTime * 0.7) * (14 - progress * 8);
      }
      this.cpuTargetY = this.clampPaddle(this.cpuTargetY);
    }

    const progress = this.cpuDifficulty();
    const maxSpeed = 122 + progress * 91;
    const deadZone = 2.5 + (1 - progress) * 3.5;
    const difference = this.cpuTargetY - this.cpuY;
    const desired = Math.abs(difference) <= deadZone ? 0 : Math.sign(difference) * maxSpeed;
    this.cpuVelocity = this.approach(this.cpuVelocity, desired, 620 * dt);
    this.cpuY = this.clampPaddle(this.cpuY + this.cpuVelocity * dt);
  }

  private predictBallYAt(targetX: number): number {
    if (this.ball.vx <= 1) return SCREEN_HEIGHT / 2;
    const travel = Math.max(0, (targetX - this.ball.x) / this.ball.vx);
    const rawY = this.ball.y + this.ball.vy * travel;
    const top = ARENA_TOP + this.ball.radius;
    const bottom = ARENA_BOTTOM - this.ball.radius;
    const span = bottom - top;
    if (span <= 0) return SCREEN_HEIGHT / 2;
    let folded = (rawY - top) % (span * 2);
    if (folded < 0) folded += span * 2;
    if (folded > span) folded = span * 2 - folded;
    return top + folded;
  }

  private cpuDifficulty(): number {
    const pointsPlayed = this.playerPoints + this.cpuPoints;
    return Math.min(1, 0.18 + (this.level - 1) * 0.105 + pointsPlayed * 0.024);
  }

  private advanceBall(dt: number): void {
    const speed = Math.hypot(this.ball.vx, this.ball.vy);
    const steps = Math.max(1, Math.min(14, Math.ceil(speed * dt / 2.5)));
    const slice = dt / steps;
    this.ball.trail.unshift({ x: this.ball.x, y: this.ball.y });
    if (this.ball.trail.length > 9) this.ball.trail.pop();

    for (let step = 0; step < steps; step += 1) {
      this.ball.x += this.ball.vx * slice;
      this.ball.y += this.ball.vy * slice;

      if (this.ball.y - this.ball.radius <= ARENA_TOP && this.ball.vy < 0) {
        this.ball.y = ARENA_TOP + this.ball.radius;
        this.ball.vy = Math.abs(this.ball.vy);
        this.services.sound('hit');
        this.spawnDust(this.ball.x, this.ball.y, 4);
      } else if (this.ball.y + this.ball.radius >= ARENA_BOTTOM && this.ball.vy > 0) {
        this.ball.y = ARENA_BOTTOM - this.ball.radius;
        this.ball.vy = -Math.abs(this.ball.vy);
        this.services.sound('hit');
        this.spawnDust(this.ball.x, this.ball.y, 4);
      }

      this.collidePaddle(PLAYER_X, this.playerY, true);
      this.collidePaddle(CPU_X, this.cpuY, false);

      if (this.ball.x + this.ball.radius < 0) {
        this.awardPoint(false);
        return;
      }
      if (this.ball.x - this.ball.radius > SCREEN_WIDTH) {
        this.awardPoint(true);
        return;
      }
    }
  }

  private collidePaddle(x: number, y: number, player: boolean): void {
    if (player ? this.ball.vx >= 0 : this.ball.vx <= 0) return;
    const left = x - PADDLE_WIDTH / 2;
    const right = x + PADDLE_WIDTH / 2;
    const top = y - PADDLE_HEIGHT / 2;
    const bottom = y + PADDLE_HEIGHT / 2;
    if (
      this.ball.x + this.ball.radius < left
      || this.ball.x - this.ball.radius > right
      || this.ball.y + this.ball.radius < top
      || this.ball.y - this.ball.radius > bottom
    ) return;

    this.ball.x = player ? right + this.ball.radius + 0.2 : left - this.ball.radius - 0.2;
    const impact = Math.max(-1, Math.min(1, (this.ball.y - y) / (PADDLE_HEIGHT / 2)));
    const paddleVelocity = player ? this.playerVelocity : this.cpuVelocity;
    const currentSpeed = Math.hypot(this.ball.vx, this.ball.vy);
    const speed = Math.min(292, Math.max(this.baseSpeed(), currentSpeed + 4.2));
    const angle = Math.max(-1.08, Math.min(1.08, impact * 0.98 + paddleVelocity / 560));
    const horizontal = Math.max(0.46, Math.cos(angle)) * speed;
    this.ball.vx = (player ? 1 : -1) * horizontal;
    this.ball.vy = Math.sin(angle) * speed;
    this.rally += 1;
    this.bestRally = Math.max(this.bestRally, this.rally);
    this.score += 5 + Math.min(50, this.rally);
    this.level = Math.max(
      this.level,
      Math.min(12, 1 + Math.floor((this.playerPoints + this.cpuPoints + this.rally / 7) / 3)),
    );
    this.services.sound('hit');
    this.spawnDust(this.ball.x, this.ball.y, 9);
    this.shakeTimer = Math.max(this.shakeTimer, 0.055);
  }

  private awardPoint(playerWon: boolean): void {
    if (playerWon) {
      this.playerPoints += 1;
      this.score += 1000 + this.rally * 25;
      this.services.sound('powerup');
      this.services.flash('#eaffde', 0.3);
    } else {
      this.cpuPoints += 1;
      this.lives = Math.max(0, TARGET_SCORE - this.cpuPoints);
      this.services.sound('death');
      this.services.flash('#dcebd7', 0.2);
    }
    this.pointBannerTimer = 0.8;
    this.shakeTimer = 0.23;
    this.level = Math.max(this.level, Math.min(12, 1 + Math.floor((this.playerPoints + this.cpuPoints) / 3)));

    if (this.playerPoints >= TARGET_SCORE || this.cpuPoints >= TARGET_SCORE) {
      this.winner = this.playerPoints >= TARGET_SCORE ? 'PLAYER' : 'CPU';
      if (this.winner === 'PLAYER') {
        this.score += 5000 + Math.max(0, TARGET_SCORE - this.cpuPoints) * 500;
        this.services.sound('level');
        this.services.flash('#eeffcc', 0.65);
      }
      this.gameOver();
      return;
    }

    // The next ball travels toward the player who conceded the previous point.
    this.prepareServe(playerWon ? 1 : -1, 0.82);
  }

  private baseSpeed(): number {
    return Math.min(236, 142 + (this.level - 1) * 6);
  }

  private clampPaddle(y: number): number {
    return Math.max(ARENA_TOP + PADDLE_HEIGHT / 2 + 2, Math.min(ARENA_BOTTOM - PADDLE_HEIGHT / 2 - 2, y));
  }

  private updateDust(dt: number): void {
    for (let index = this.dust.length - 1; index >= 0; index -= 1) {
      const particle = this.dust[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        this.dust.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.03, dt);
      particle.vy *= Math.pow(0.03, dt);
    }
  }

  private spawnDust(x: number, y: number, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 52;
      const life = 0.15 + Math.random() * 0.28;
      this.dust.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life });
    }
    if (this.dust.length > 100) this.dust.splice(0, this.dust.length - 100);
  }

  private drawPhosphorNoise(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(205, 255, 190, 0.025)';
    for (let y = ARENA_TOP; y < ARENA_BOTTOM; y += 4) ctx.fillRect(0, y, SCREEN_WIDTH, 1);
    ctx.fillStyle = 'rgba(220,255,205,0.14)';
    for (let index = 0; index < 18; index += 1) {
      const x = (index * 97 + Math.floor(this.visualTime * 7) * 31) % SCREEN_WIDTH;
      const y = ARENA_TOP + ((index * 53 + Math.floor(this.visualTime * 3) * 17) % (ARENA_BOTTOM - ARENA_TOP));
      ctx.fillRect(x, y, 1, 1);
    }
  }

  private drawCourt(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#d7f4ce';
    ctx.shadowColor = '#b6efab';
    ctx.shadowBlur = 5;
    ctx.fillRect(5, ARENA_TOP - 2, SCREEN_WIDTH - 10, 2);
    ctx.fillRect(5, ARENA_BOTTOM, SCREEN_WIDTH - 10, 2);
    for (let y = ARENA_TOP + 4; y < ARENA_BOTTOM; y += 13) ctx.fillRect(SCREEN_WIDTH / 2 - 1, y, 2, 7);
    ctx.restore();
  }

  private drawPaddle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.fillStyle = '#e2fbd9';
    ctx.shadowColor = '#caffbd';
    ctx.shadowBlur = 8;
    ctx.fillRect(Math.round(x - PADDLE_WIDTH / 2), Math.round(y - PADDLE_HEIGHT / 2), PADDLE_WIDTH, PADDLE_HEIGHT);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(x - PADDLE_WIDTH / 2) + 1, Math.round(y - PADDLE_HEIGHT / 2) + 2, 1, PADDLE_HEIGHT - 4);
    ctx.restore();
  }

  private drawBall(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (let index = this.ball.trail.length - 1; index >= 0; index -= 1) {
      const trail = this.ball.trail[index];
      ctx.globalAlpha = (1 - index / this.ball.trail.length) * 0.13;
      ctx.fillStyle = '#caffbe';
      ctx.fillRect(Math.round(trail.x) - 1, Math.round(trail.y) - 1, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f0ffe9';
    ctx.shadowColor = '#d1ffc5';
    ctx.shadowBlur = 10;
    ctx.fillRect(Math.round(this.ball.x - this.ball.radius), Math.round(this.ball.y - this.ball.radius), this.ball.radius * 2, this.ball.radius * 2);
    ctx.restore();
  }

  private drawDust(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#e6ffdd';
    ctx.shadowColor = '#caffbd';
    ctx.shadowBlur = 4;
    for (const particle of this.dust) {
      ctx.globalAlpha = particle.life / particle.maxLife;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), 2, 2);
    }
    ctx.restore();
  }

  private drawScoreboard(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#d9f8d1';
    ctx.shadowColor = '#b9f4ae';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PLAYER', 64, 5);
    ctx.textAlign = 'right';
    ctx.fillText('CPU', SCREEN_WIDTH - 64, 5);
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(this.playerPoints).padStart(2, '0'), 148, 4);
    ctx.fillText(String(this.cpuPoints).padStart(2, '0'), 236, 4);
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#94b98d';
    ctx.fillText(
      `RALLY ${this.rally}  BEST ${this.bestRally}  LV ${this.level}  HI ${String(Math.max(this.score, this.services.highScore())).padStart(6, '0')}`,
      SCREEN_WIDTH / 2,
      25,
    );
    ctx.restore();
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    if (this.serveTimer <= 0 && this.pointBannerTimer <= 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#eaffdf';
    ctx.shadowColor = '#caffbe';
    ctx.shadowBlur = 8;
    ctx.font = 'bold 12px monospace';
    if (this.pointBannerTimer > 0) {
      ctx.fillText(this.serveDirection > 0 ? 'PLAYER SCORES' : 'CPU SCORES', SCREEN_WIDTH / 2, 110);
    } else {
      const count = Math.max(1, Math.ceil(this.serveTimer));
      ctx.fillText(`SERVE ${count}`, SCREEN_WIDTH / 2, 110);
      ctx.font = '8px monospace';
      ctx.fillText('PRESS A', SCREEN_WIDTH / 2, 125);
    }
    ctx.restore();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, title: string, detail: string): void {
    ctx.save();
    ctx.fillStyle = 'rgba(1, 5, 2, 0.8)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e7ffdf';
    ctx.shadowColor = '#c5ffb8';
    ctx.shadowBlur = 10;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(title, SCREEN_WIDTH / 2, 132);
    ctx.font = 'bold 11px monospace';
    ctx.fillText(detail, SCREEN_WIDTH / 2, 158);
    ctx.restore();
  }

  private approach(value: number, target: number, amount: number): number {
    if (value < target) return Math.min(target, value + amount);
    return Math.max(target, value - amount);
  }
}

export default RetroPong;
