import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../types';
import type { GameServices, InputFrame } from '../../types';
import { BaseGame } from '../BaseGame';

type BrickKind = 'normal' | 'tough' | 'bonus' | 'steel';
type PowerKind = 'wide' | 'narrow' | 'slow' | 'fast' | 'multi' | 'life';

interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: BrickKind;
  hp: number;
  maxHp: number;
  alive: boolean;
  pulse: number;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  stuck: boolean;
  trail: Array<{ x: number; y: number }>;
}

interface FallingPower {
  x: number;
  y: number;
  vy: number;
  kind: PowerKind;
  phase: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

const PLAY_TOP = 29;
const PLAY_BOTTOM = 280;
const PADDLE_Y = 260;
const PADDLE_HEIGHT = 7;
const BRICK_WIDTH = 32;
const BRICK_HEIGHT = 11;
const BRICK_GAP_X = 3;
const BRICK_GAP_Y = 3;
const BRICK_COLUMNS = 10;
const BRICK_ROWS = 8;
const BRICK_LEFT = 19;
const BRICK_TOP = 48;

const POWER_COLORS: Record<PowerKind, string> = {
  wide: '#66faff',
  narrow: '#ff5f9f',
  slow: '#95a9ff',
  fast: '#ff8a4f',
  multi: '#ffe266',
  life: '#71ff8d',
};

const POWER_LABELS: Record<PowerKind, string> = {
  wide: 'W',
  narrow: 'N',
  slow: 'S',
  fast: 'F',
  multi: 'M',
  life: '+',
};

/** Paddle-and-ball arcade game with varied bricks, drops, lives and generated stages. */
export class BlockBreaker extends BaseGame {
  readonly id = 'block-breaker' as const;
  readonly title = 'BLOCK BREAKER';
  readonly controls = 'LEFT/RIGHT: PADDLE  •  A: LAUNCH';

  private bricks: Brick[] = [];
  private balls: Ball[] = [];
  private powers: FallingPower[] = [];
  private sparks: Spark[] = [];
  private paddleX = SCREEN_WIDTH / 2;
  private paddleWidth = 54;
  private paddleVelocity = 0;
  private sizeEffectTimer = 0;
  private readyTimer = 0;
  private deathTimer = 0;
  private levelTimer = 0;
  private visualTime = 0;
  private shakeTimer = 0;
  private destroyedThisLevel = 0;

  constructor(services: GameServices) {
    super(services);
  }

  start(): void {
    this.score = 0;
    this.level = 1;
    this.lives = 3;
    this.paused = false;
    this.ended = false;
    this.visualTime = 0;
    this.shakeTimer = 0;
    this.deathTimer = 0;
    this.levelTimer = 0;
    this.powers = [];
    this.sparks = [];
    this.buildLevel();
    this.resetServe(1.05);
  }

  update(deltaSeconds: number, input: InputFrame): void {
    if (this.paused || this.ended) return;
    const dt = Math.min(0.05, Math.max(0, deltaSeconds));
    this.visualTime += dt;
    this.updateSparks(dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    for (const brick of this.bricks) brick.pulse = Math.max(0, brick.pulse - dt * 5);

    if (this.levelTimer > 0) {
      this.levelTimer -= dt;
      if (this.levelTimer <= 0) {
        this.level += 1;
        this.buildLevel();
        this.resetServe(0.9);
        this.services.sound('level');
      }
      return;
    }

    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.resetServe(0.72);
      return;
    }

    this.readyTimer = Math.max(0, this.readyTimer - dt);
    this.sizeEffectTimer = Math.max(0, this.sizeEffectTimer - dt);
    if (this.sizeEffectTimer <= 0 && this.paddleWidth !== 54) this.paddleWidth = this.approach(this.paddleWidth, 54, 80 * dt);

    const direction = input.horizontal || (input.down('left') ? -1 : input.down('right') ? 1 : 0);
    const previousX = this.paddleX;
    this.paddleX += direction * 205 * dt;
    this.paddleX = Math.max(8 + this.paddleWidth / 2, Math.min(SCREEN_WIDTH - 8 - this.paddleWidth / 2, this.paddleX));
    this.paddleVelocity = dt > 0 ? (this.paddleX - previousX) / dt : 0;

    for (const ball of this.balls) {
      if (ball.stuck) {
        ball.x = this.paddleX;
        ball.y = PADDLE_Y - ball.radius - 1;
      }
    }

    if (
      this.readyTimer <= 0
      && (input.pressed('buttonA') || input.pressed('buttonB') || input.pressed('buttonC'))
    ) {
      for (const ball of this.balls) {
        if (!ball.stuck) continue;
        ball.stuck = false;
        const nudge = Math.max(-0.7, Math.min(0.7, direction * 0.48 + (Math.random() - 0.5) * 0.22));
        const speed = this.baseBallSpeed();
        ball.vx = nudge * speed;
        ball.vy = -Math.sqrt(Math.max(1, speed * speed - ball.vx * ball.vx));
        this.services.sound('shot');
      }
    }

    this.updateBalls(dt);
    this.updatePowers(dt);

    if (this.countBreakableBricks() === 0 && this.levelTimer <= 0 && !this.ended) {
      this.finishLevel();
      return;
    }
    if (this.balls.length === 0 && this.deathTimer <= 0) this.loseLife();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.drawBackdrop(ctx);

    ctx.save();
    if (this.shakeTimer > 0) {
      const strength = Math.min(2.5, this.shakeTimer * 12);
      ctx.translate((Math.random() - 0.5) * strength, (Math.random() - 0.5) * strength);
    }
    this.drawBricks(ctx);
    this.drawPowers(ctx);
    this.drawPaddle(ctx);
    this.drawBalls(ctx);
    this.drawSparks(ctx);
    ctx.restore();

    this.drawHud(ctx, '#71f8ff');
    this.drawStatus(ctx);
    ctx.restore();
  }

  private buildLevel(): void {
    this.bricks = [];
    this.balls = [];
    this.powers = [];
    this.destroyedThisLevel = 0;
    const pattern = (this.level - 1) % 5;

    for (let row = 0; row < BRICK_ROWS; row += 1) {
      for (let column = 0; column < BRICK_COLUMNS; column += 1) {
        if (!this.levelCellExists(pattern, row, column)) continue;
        let kind: BrickKind = 'normal';
        const signature = row * 13 + column * 7 + this.level * 5;
        if (this.level >= 2 && signature % 11 === 0) kind = 'tough';
        if (signature % 17 === 0 || (row === 1 && column === (this.level * 3) % BRICK_COLUMNS)) kind = 'bonus';
        if (this.level >= 3 && signature % 19 === 0 && row > 0) kind = 'steel';

        const toughness = kind === 'tough' ? Math.min(4, 2 + Math.floor((this.level - 1) / 5)) : kind === 'steel' ? -1 : 1;
        this.bricks.push({
          x: BRICK_LEFT + column * (BRICK_WIDTH + BRICK_GAP_X),
          y: BRICK_TOP + row * (BRICK_HEIGHT + BRICK_GAP_Y),
          width: BRICK_WIDTH,
          height: BRICK_HEIGHT,
          kind,
          hp: toughness,
          maxHp: toughness,
          alive: true,
          pulse: 0,
        });
      }
    }
  }

  private levelCellExists(pattern: number, row: number, column: number): boolean {
    switch (pattern) {
      case 0:
        return row < 6;
      case 1:
        return row < 7 && (row + column) % 2 === 0 || row === 0;
      case 2:
        return row < 7 && Math.abs(column - 4.5) + row * 0.55 < 6.2;
      case 3:
        return row < 7 && !(row >= 3 && row <= 5 && column >= 3 && column <= 6);
      default:
        return row < 8 && (column < 2 || column > 7 || row < 2 || row > 5 || (row + column) % 3 === 0);
    }
  }

  private resetServe(delay: number): void {
    this.paddleX = SCREEN_WIDTH / 2;
    this.paddleWidth = 54;
    this.paddleVelocity = 0;
    this.sizeEffectTimer = 0;
    this.readyTimer = delay;
    this.deathTimer = 0;
    this.balls = [{
      x: this.paddleX,
      y: PADDLE_Y - 5,
      vx: 0,
      vy: -this.baseBallSpeed(),
      radius: 3,
      stuck: true,
      trail: [],
    }];
  }

  private updateBalls(dt: number): void {
    for (let index = this.balls.length - 1; index >= 0; index -= 1) {
      const ball = this.balls[index];
      if (ball.stuck) continue;
      ball.trail.unshift({ x: ball.x, y: ball.y });
      if (ball.trail.length > 7) ball.trail.pop();

      const speed = Math.hypot(ball.vx, ball.vy);
      const steps = Math.max(1, Math.min(12, Math.ceil(speed * dt / 2.4)));
      const slice = dt / steps;
      let lost = false;

      for (let step = 0; step < steps; step += 1) {
        ball.x += ball.vx * slice;
        ball.y += ball.vy * slice;

        if (ball.x - ball.radius < 6 && ball.vx < 0) {
          ball.x = 6 + ball.radius;
          ball.vx = Math.abs(ball.vx);
          this.services.sound('hit');
        } else if (ball.x + ball.radius > SCREEN_WIDTH - 6 && ball.vx > 0) {
          ball.x = SCREEN_WIDTH - 6 - ball.radius;
          ball.vx = -Math.abs(ball.vx);
          this.services.sound('hit');
        }
        if (ball.y - ball.radius < PLAY_TOP && ball.vy < 0) {
          ball.y = PLAY_TOP + ball.radius;
          ball.vy = Math.abs(ball.vy);
          this.services.sound('hit');
        }

        if (ball.y - ball.radius > PLAY_BOTTOM) {
          lost = true;
          break;
        }

        this.collidePaddle(ball);
        if (this.collideBrick(ball)) break;
      }

      if (lost) this.balls.splice(index, 1);
    }
  }

  private collidePaddle(ball: Ball): void {
    if (ball.vy <= 0) return;
    const left = this.paddleX - this.paddleWidth / 2;
    const right = this.paddleX + this.paddleWidth / 2;
    if (
      ball.x + ball.radius < left
      || ball.x - ball.radius > right
      || ball.y + ball.radius < PADDLE_Y
      || ball.y - ball.radius > PADDLE_Y + PADDLE_HEIGHT
    ) return;

    ball.y = PADDLE_Y - ball.radius - 0.2;
    const offset = Math.max(-1, Math.min(1, (ball.x - this.paddleX) / (this.paddleWidth / 2)));
    const speed = Math.max(this.baseBallSpeed(), Math.min(270, Math.hypot(ball.vx, ball.vy) * 1.012));
    const angled = Math.max(-0.91, Math.min(0.91, offset * 0.82 + this.paddleVelocity / 760));
    ball.vx = angled * speed;
    ball.vy = -Math.sqrt(Math.max(25, speed * speed - ball.vx * ball.vx));
    this.services.sound('hit');
    this.spawnSparks(ball.x, PADDLE_Y, '#82ffff', 5, 35);
  }

  private collideBrick(ball: Ball): boolean {
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const expandedLeft = brick.x - ball.radius;
      const expandedRight = brick.x + brick.width + ball.radius;
      const expandedTop = brick.y - ball.radius;
      const expandedBottom = brick.y + brick.height + ball.radius;
      if (ball.x < expandedLeft || ball.x > expandedRight || ball.y < expandedTop || ball.y > expandedBottom) continue;

      const penetrations = [
        { axis: 'x' as const, value: ball.x - expandedLeft, direction: -1 },
        { axis: 'x' as const, value: expandedRight - ball.x, direction: 1 },
        { axis: 'y' as const, value: ball.y - expandedTop, direction: -1 },
        { axis: 'y' as const, value: expandedBottom - ball.y, direction: 1 },
      ].sort((a, b) => a.value - b.value);
      const collision = penetrations[0];
      if (collision.axis === 'x') {
        ball.x = collision.direction < 0 ? expandedLeft - 0.1 : expandedRight + 0.1;
        ball.vx = collision.direction < 0 ? -Math.abs(ball.vx) : Math.abs(ball.vx);
      } else {
        ball.y = collision.direction < 0 ? expandedTop - 0.1 : expandedBottom + 0.1;
        ball.vy = collision.direction < 0 ? -Math.abs(ball.vy) : Math.abs(ball.vy);
      }
      this.hitBrick(brick, ball.x, ball.y);
      return true;
    }
    return false;
  }

  private hitBrick(brick: Brick, hitX: number, hitY: number): void {
    brick.pulse = 1;
    if (brick.kind === 'steel') {
      this.score += 2;
      this.services.sound('hit');
      this.spawnSparks(hitX, hitY, '#aeb8ca', 4, 30);
      return;
    }

    brick.hp -= 1;
    if (brick.hp > 0) {
      this.score += 15 * this.level;
      this.services.sound('hit');
      this.spawnSparks(hitX, hitY, '#ff9d5d', 6, 40);
      return;
    }

    brick.alive = false;
    this.destroyedThisLevel += 1;
    this.score += (brick.kind === 'bonus' ? 150 : brick.kind === 'tough' ? 90 : 50) * this.level;
    this.services.sound(brick.kind === 'bonus' ? 'powerup' : 'explosion');
    const color = this.brickColor(brick);
    this.spawnSparks(brick.x + brick.width / 2, brick.y + brick.height / 2, color, 13, 65);
    this.shakeTimer = Math.max(this.shakeTimer, 0.07);

    const guaranteed = brick.kind === 'bonus';
    if (guaranteed || Math.random() < 0.065) {
      this.powers.push({
        x: brick.x + brick.width / 2,
        y: brick.y + brick.height / 2,
        vy: 63,
        kind: this.choosePower(),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private choosePower(): PowerKind {
    const kinds: PowerKind[] = ['wide', 'slow', 'multi', 'wide', 'fast', 'narrow', 'life'];
    return kinds[Math.floor(Math.random() * kinds.length)];
  }

  private updatePowers(dt: number): void {
    for (let index = this.powers.length - 1; index >= 0; index -= 1) {
      const power = this.powers[index];
      power.y += power.vy * dt;
      power.phase += dt * 5;
      const caught = power.y + 5 >= PADDLE_Y
        && power.y - 5 <= PADDLE_Y + PADDLE_HEIGHT
        && power.x >= this.paddleX - this.paddleWidth / 2 - 5
        && power.x <= this.paddleX + this.paddleWidth / 2 + 5;
      if (caught) {
        this.applyPower(power.kind);
        this.powers.splice(index, 1);
      } else if (power.y > PLAY_BOTTOM + 10) {
        this.powers.splice(index, 1);
      }
    }
  }

  private applyPower(kind: PowerKind): void {
    this.score += 250 * this.level;
    this.services.sound('powerup');
    this.services.flash(POWER_COLORS[kind], 0.32);
    this.spawnSparks(this.paddleX, PADDLE_Y, POWER_COLORS[kind], 16, 70);

    switch (kind) {
      case 'wide':
        this.paddleWidth = 78;
        this.sizeEffectTimer = 12;
        break;
      case 'narrow':
        this.paddleWidth = 38;
        this.sizeEffectTimer = 8;
        break;
      case 'slow':
        this.scaleBallSpeeds(0.78, 118, 210);
        break;
      case 'fast':
        this.scaleBallSpeeds(1.22, 150, 275);
        break;
      case 'multi':
        this.addMultiBall();
        break;
      case 'life':
        this.lives = Math.min(9, this.lives + 1);
        break;
    }
  }

  private scaleBallSpeeds(multiplier: number, minimum: number, maximum: number): void {
    for (const ball of this.balls) {
      if (ball.stuck) continue;
      const speed = Math.max(minimum, Math.min(maximum, Math.hypot(ball.vx, ball.vy) * multiplier));
      const angle = Math.atan2(ball.vy, ball.vx);
      ball.vx = Math.cos(angle) * speed;
      ball.vy = Math.sin(angle) * speed;
    }
  }

  private addMultiBall(): void {
    const sources = this.balls.filter((ball) => !ball.stuck).slice(0, 2);
    if (sources.length === 0) return;
    const additions: Ball[] = [];
    for (const source of sources) {
      const speed = Math.hypot(source.vx, source.vy);
      const base = Math.atan2(source.vy, source.vx);
      for (const turn of [-0.42, 0.42]) {
        if (this.balls.length + additions.length >= 6) break;
        additions.push({
          x: source.x,
          y: source.y,
          vx: Math.cos(base + turn) * speed,
          vy: Math.sin(base + turn) * speed,
          radius: source.radius,
          stuck: false,
          trail: [],
        });
      }
    }
    this.balls.push(...additions);
  }

  private loseLife(): void {
    this.lives -= 1;
    this.powers = [];
    this.sizeEffectTimer = 0;
    this.paddleWidth = 54;
    this.services.sound('death');
    this.services.flash('#ff456f', 0.58);
    this.shakeTimer = 0.35;
    if (this.lives <= 0) {
      this.gameOver();
      return;
    }
    this.deathTimer = 0.85;
  }

  private finishLevel(): void {
    this.levelTimer = 1.35;
    this.balls = [];
    this.powers = [];
    this.score += 500 * this.level + this.lives * 100;
    this.services.sound('level');
    this.services.flash('#77fff1', 0.5);
  }

  private countBreakableBricks(): number {
    let count = 0;
    for (const brick of this.bricks) if (brick.alive && brick.kind !== 'steel') count += 1;
    return count;
  }

  private baseBallSpeed(): number {
    return Math.min(238, 142 + (this.level - 1) * 10);
  }

  private updateSparks(dt: number): void {
    for (let index = this.sparks.length - 1; index >= 0; index -= 1) {
      const spark = this.sparks[index];
      spark.life -= dt;
      if (spark.life <= 0) {
        this.sparks.splice(index, 1);
        continue;
      }
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vx *= Math.pow(0.08, dt);
      spark.vy = spark.vy * Math.pow(0.1, dt) + 28 * dt;
    }
  }

  private spawnSparks(x: number, y: number, color: string, count: number, speed: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const magnitude = speed * (0.35 + Math.random() * 0.75);
      const life = 0.18 + Math.random() * 0.38;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * magnitude,
        vy: Math.sin(angle) * magnitude,
        life,
        maxLife: life,
        color,
      });
    }
    if (this.sparks.length > 220) this.sparks.splice(0, this.sparks.length - 220);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
    gradient.addColorStop(0, '#090319');
    gradient.addColorStop(0.55, '#070923');
    gradient.addColorStop(1, '#02040e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    ctx.strokeStyle = 'rgba(108, 244, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 8; x < SCREEN_WIDTH; x += 16) {
      ctx.moveTo(x + 0.5, PLAY_TOP);
      ctx.lineTo(x + 0.5, PLAY_BOTTOM);
    }
    for (let y = PLAY_TOP; y < PLAY_BOTTOM; y += 16) {
      ctx.moveTo(6, y + 0.5);
      ctx.lineTo(SCREEN_WIDTH - 6, y + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = '#294b64';
    ctx.shadowColor = '#4de8ff';
    ctx.shadowBlur = 6;
    ctx.strokeRect(5.5, PLAY_TOP - 0.5, SCREEN_WIDTH - 11, PLAY_BOTTOM - PLAY_TOP + 1);
    ctx.shadowBlur = 0;
  }

  private drawBricks(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const brick of this.bricks) {
      if (!brick.alive) continue;
      const color = this.brickColor(brick);
      const inset = brick.pulse * 1.2;
      ctx.shadowColor = color;
      ctx.shadowBlur = brick.kind === 'bonus' ? 11 + Math.sin(this.visualTime * 8) * 3 : 5 + brick.pulse * 7;
      ctx.fillStyle = color;
      ctx.fillRect(brick.x + inset, brick.y + inset, brick.width - inset * 2, brick.height - inset * 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.34)';
      ctx.fillRect(brick.x + 2, brick.y + 1, brick.width - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(brick.x + 2, brick.y + brick.height - 3, brick.width - 4, 2);

      if (brick.kind === 'tough') {
        ctx.fillStyle = '#fff2c4';
        for (let hp = 0; hp < brick.hp; hp += 1) ctx.fillRect(brick.x + 4 + hp * 5, brick.y + 5, 3, 2);
      } else if (brick.kind === 'steel') {
        ctx.strokeStyle = '#e2ecff';
        ctx.beginPath();
        ctx.moveTo(brick.x + 3, brick.y + brick.height - 2);
        ctx.lineTo(brick.x + brick.width - 3, brick.y + 2);
        ctx.stroke();
      } else if (brick.kind === 'bonus') {
        ctx.fillStyle = '#fff8b1';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', brick.x + brick.width / 2, brick.y + brick.height / 2 + 0.5);
      }
    }
    ctx.restore();
  }

  private brickColor(brick: Brick): string {
    if (brick.kind === 'steel') return '#71849a';
    if (brick.kind === 'bonus') return '#ffd64d';
    if (brick.kind === 'tough') return brick.hp === brick.maxHp ? '#ff6b72' : brick.hp > 1 ? '#ff965e' : '#ffbd69';
    const row = Math.round((brick.y - BRICK_TOP) / (BRICK_HEIGHT + BRICK_GAP_Y));
    return ['#ff4f91', '#c767ff', '#6c7cff', '#45c9ff', '#3cf4c6', '#73f06d', '#e7dc57', '#ff9f52'][row % 8];
  }

  private drawPaddle(ctx: CanvasRenderingContext2D): void {
    const x = this.paddleX - this.paddleWidth / 2;
    ctx.save();
    ctx.shadowColor = '#56faff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#50e8ef';
    ctx.fillRect(Math.round(x), PADDLE_Y, Math.round(this.paddleWidth), PADDLE_HEIGHT);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d9ffff';
    ctx.fillRect(Math.round(x) + 3, PADDLE_Y + 1, Math.max(1, Math.round(this.paddleWidth) - 6), 2);
    ctx.fillStyle = '#257d9b';
    ctx.fillRect(Math.round(x) + 4, PADDLE_Y + 5, Math.max(1, Math.round(this.paddleWidth) - 8), 2);
    ctx.restore();
  }

  private drawBalls(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const ball of this.balls) {
      for (let index = ball.trail.length - 1; index >= 0; index -= 1) {
        const point = ball.trail[index];
        ctx.globalAlpha = (1 - index / ball.trail.length) * 0.16;
        ctx.fillStyle = '#74faff';
        ctx.fillRect(Math.round(point.x) - 1, Math.round(point.y) - 1, 2, 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#80ffff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawPowers(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 8px monospace';
    for (const power of this.powers) {
      const color = POWER_COLORS[power.kind];
      const scale = 1 + Math.sin(power.phase) * 0.1;
      ctx.save();
      ctx.translate(power.x, power.y);
      ctx.scale(scale, scale);
      ctx.shadowColor = color;
      ctx.shadowBlur = 9;
      ctx.fillStyle = color;
      ctx.fillRect(-6, -5, 12, 10);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#08101e';
      ctx.fillText(POWER_LABELS[power.kind], 0, 0.5);
      ctx.restore();
    }
    ctx.restore();
  }

  private drawSparks(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const spark of this.sparks) {
      ctx.globalAlpha = Math.max(0, spark.life / spark.maxLife);
      ctx.fillStyle = spark.color;
      ctx.fillRect(Math.round(spark.x), Math.round(spark.y), 2, 2);
    }
    ctx.restore();
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    let title = '';
    let detail = '';
    if (this.levelTimer > 0) {
      title = 'STAGE CLEAR';
      detail = `BONUS ${500 * this.level + this.lives * 100}`;
    } else if (this.deathTimer > 0 && this.lives > 0) {
      title = 'BALL LOST';
      detail = `${this.lives} LEFT`;
    } else if (this.readyTimer > 0) {
      title = `STAGE ${this.level}`;
      detail = 'GET READY';
    } else if (this.balls.some((ball) => ball.stuck)) {
      title = 'PRESS A';
      detail = 'TO LAUNCH';
    }
    if (!title) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#f4ffff';
    ctx.shadowColor = '#62f7ff';
    ctx.shadowBlur = 9;
    ctx.fillText(title, SCREEN_WIDTH / 2, 187);
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#7efaff';
    ctx.fillText(detail, SCREEN_WIDTH / 2, 203);
    ctx.restore();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, title: string, detail: string, color: string): void {
    ctx.save();
    ctx.fillStyle = 'rgba(1, 2, 9, 0.78)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 21px monospace';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillText(title, SCREEN_WIDTH / 2, 133);
    ctx.shadowBlur = 0;
    ctx.font = 'bold 9px monospace';
    ctx.fillText(detail, SCREEN_WIDTH / 2, 157);
    ctx.restore();
  }

  private approach(value: number, target: number, amount: number): number {
    if (value < target) return Math.min(target, value + amount);
    return Math.max(target, value - amount);
  }
}

export default BlockBreaker;
