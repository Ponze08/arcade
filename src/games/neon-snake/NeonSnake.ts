import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../types';
import type { GameServices, InputFrame } from '../../types';
import { BaseGame } from '../BaseGame';

interface GridPoint {
  x: number;
  y: number;
}

interface BonusFood {
  position: GridPoint;
  timeLeft: number;
  duration: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

const CELL_SIZE = 12;
const GRID_WIDTH = 30;
const GRID_HEIGHT = 20;
const FIELD_X = 12;
const FIELD_Y = 36;
const MAX_OBSTACLES = 96;

const UP: GridPoint = { x: 0, y: -1 };
const DOWN: GridPoint = { x: 0, y: 1 };
const LEFT: GridPoint = { x: -1, y: 0 };
const RIGHT: GridPoint = { x: 1, y: 0 };

/** A neon, grid-based snake game built for the arcade's 384 x 288 canvas. */
export class NeonSnake extends BaseGame {
  readonly id = 'neon-snake' as const;
  readonly title = 'SNAKE';
  readonly controls = 'FRECCE/WASD: MUOVI  •  A: TURBO';

  private snake: GridPoint[] = [];
  private previousSnake: GridPoint[] = [];
  private direction: GridPoint = RIGHT;
  private turnQueue: GridPoint[] = [];
  private normalFood: GridPoint | null = null;
  private bonusFood: BonusFood | null = null;
  private readonly obstacles = new Set<string>();
  private readonly particles: Particle[] = [];
  private accumulator = 0;
  private elapsed = 0;
  private pendingGrowth = 0;
  private foodsThisLevel = 0;
  private totalFoods = 0;
  private crashTimer = 0;
  private levelBannerTimer = 0;
  private boosting = false;

  constructor(services: GameServices) {
    super(services);
  }

  start(): void {
    this.score = 0;
    this.level = 1;
    this.lives = 3;
    this.paused = false;
    this.ended = false;
    this.elapsed = 0;
    this.accumulator = 0;
    this.pendingGrowth = 0;
    this.foodsThisLevel = 0;
    this.totalFoods = 0;
    this.crashTimer = 0;
    this.levelBannerTimer = 1.15;
    this.boosting = false;
    this.normalFood = null;
    this.bonusFood = null;
    this.obstacles.clear();
    this.particles.length = 0;
    this.resetSnake();
    this.normalFood = this.findFreeCell();
  }

  update(deltaSeconds: number, input: InputFrame): void {
    if (this.paused || this.ended) return;

    const delta = Math.min(0.12, Math.max(0, deltaSeconds));
    this.elapsed += delta;
    this.updateParticles(delta);
    this.levelBannerTimer = Math.max(0, this.levelBannerTimer - delta);

    if (this.crashTimer > 0) {
      this.crashTimer -= delta;
      if (this.crashTimer <= 0) this.resetSnake();
      return;
    }

    this.captureTurn(input);
    this.boosting = input.down('buttonA');

    if (this.bonusFood) {
      this.bonusFood.timeLeft -= delta;
      if (this.bonusFood.timeLeft <= 0) {
        this.spawnBurst(this.bonusFood.position, '#ff4fd8', 8);
        this.bonusFood = null;
      }
    }

    const interval = this.currentMoveInterval();
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= interval && steps < 5 && !this.ended && this.crashTimer <= 0) {
      this.accumulator -= interval;
      this.advanceSnake();
      steps += 1;
    }

    // Do not carry a large backlog after a suspended or heavily delayed frame.
    if (steps === 5) this.accumulator = Math.min(this.accumulator, interval);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawBackdrop(ctx);
    this.drawPlayfield(ctx);

    ctx.save();
    ctx.beginPath();
    ctx.rect(FIELD_X, FIELD_Y, GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE);
    ctx.clip();

    const shake = this.crashTimer > 0 ? Math.sin(this.elapsed * 95) * this.crashTimer * 2 : 0;
    ctx.translate(shake, 0);
    this.drawObstacles(ctx);
    this.drawNormalFood(ctx);
    this.drawBonusFood(ctx);
    this.drawParticles(ctx);
    this.drawSnake(ctx);
    ctx.restore();

    this.drawHud(ctx, '#54ffe1');
    this.drawStatus(ctx);

    if (this.paused) this.drawOverlay(ctx, 'PAUSA', 'PREMI PAUSA PER CONTINUARE', '#54ffe1');
    ctx.restore();
  }

  private resetSnake(): void {
    const centerY = Math.floor(GRID_HEIGHT / 2);
    const headX = Math.floor(GRID_WIDTH / 2) + 2;
    this.snake = Array.from({ length: 5 }, (_, index) => ({ x: headX - index, y: centerY }));
    this.previousSnake = this.snake.map((part) => ({ ...part }));
    this.direction = RIGHT;
    this.turnQueue.length = 0;
    this.pendingGrowth = 0;
    this.accumulator = 0;
    this.boosting = false;

    if (this.normalFood && this.snake.some((part) => this.samePoint(part, this.normalFood!))) {
      this.normalFood = this.findFreeCell();
    }
    if (this.bonusFood && this.snake.some((part) => this.samePoint(part, this.bonusFood!.position))) {
      this.bonusFood = null;
    }
  }

  private captureTurn(input: InputFrame): void {
    let requested: GridPoint | null = null;
    if (input.pressed('up')) requested = UP;
    else if (input.pressed('down')) requested = DOWN;
    else if (input.pressed('left')) requested = LEFT;
    else if (input.pressed('right')) requested = RIGHT;
    if (!requested || this.turnQueue.length >= 2) return;

    const reference = this.turnQueue[this.turnQueue.length - 1] ?? this.direction;
    const isSame = reference.x === requested.x && reference.y === requested.y;
    const isReverse = reference.x + requested.x === 0 && reference.y + requested.y === 0;
    if (!isSame && !isReverse) this.turnQueue.push(requested);
  }

  private currentMoveInterval(): number {
    const levelSpeed = Math.max(0.068, 0.148 - (this.level - 1) * 0.007);
    return this.boosting ? levelSpeed * 0.68 : levelSpeed;
  }

  private advanceSnake(): void {
    const nextDirection = this.turnQueue.shift();
    if (nextDirection) this.direction = nextDirection;

    const head = this.snake[0];
    const nextHead = { x: head.x + this.direction.x, y: head.y + this.direction.y };
    const tailMoves = this.pendingGrowth <= 0;
    const bodyCollisionLength = this.snake.length - (tailMoves ? 1 : 0);
    const hitWall = nextHead.x < 0 || nextHead.x >= GRID_WIDTH || nextHead.y < 0 || nextHead.y >= GRID_HEIGHT;
    const hitBody = this.snake.slice(0, bodyCollisionLength).some((part) => this.samePoint(part, nextHead));
    const hitObstacle = this.obstacles.has(this.pointKey(nextHead));

    if (hitWall || hitBody || hitObstacle) {
      this.handleCrash();
      return;
    }

    this.previousSnake = this.snake.map((part) => ({ ...part }));
    this.snake.unshift(nextHead);
    if (this.pendingGrowth > 0) this.pendingGrowth -= 1;
    else this.snake.pop();

    if (this.boosting) this.score += 1;

    if (this.normalFood && this.samePoint(nextHead, this.normalFood)) this.eatNormalFood();
    if (this.bonusFood && this.samePoint(nextHead, this.bonusFood.position)) this.eatBonusFood();
  }

  private eatNormalFood(): void {
    const eaten = this.normalFood;
    if (!eaten) return;

    this.score += 100 * this.level + (this.boosting ? 25 * this.level : 0);
    this.pendingGrowth += 2;
    this.foodsThisLevel += 1;
    this.totalFoods += 1;
    this.normalFood = null;
    this.services.sound('food');
    this.spawnBurst(eaten, '#ff4fd8', 14);

    const target = 5 + Math.min(5, this.level);
    if (this.foodsThisLevel >= target) this.advanceLevel();

    this.normalFood = this.findFreeCell();
    if (!this.normalFood) {
      this.score += 10_000;
      this.gameOver();
      return;
    }

    // Every third fruit creates a guaranteed, short-lived risk/reward target.
    if (!this.bonusFood && this.totalFoods % 3 === 0) this.spawnBonusFood();
  }

  private eatBonusFood(): void {
    const bonus = this.bonusFood;
    if (!bonus) return;

    this.score += 300 * this.level + Math.ceil(bonus.timeLeft) * 30;
    this.pendingGrowth += 3;
    this.services.sound('powerup');
    this.services.flash('#ffe66b', 0.36);
    this.spawnBurst(bonus.position, '#ffe66b', 24);
    this.bonusFood = null;
  }

  private advanceLevel(): void {
    this.level += 1;
    this.foodsThisLevel = 0;
    this.score += 250 * this.level;
    this.levelBannerTimer = 1.35;
    this.services.sound('level');
    this.services.flash('#54ffe1', 0.3);

    const patterns = Math.min(3, 1 + Math.floor(this.level / 4));
    for (let index = 0; index < patterns && this.obstacles.size < MAX_OBSTACLES; index += 1) {
      this.addObstaclePattern();
    }
  }

  private handleCrash(): void {
    const head = this.snake[0];
    this.lives -= 1;
    this.turnQueue.length = 0;
    this.boosting = false;
    this.services.sound('death');
    this.services.flash('#ff285f', 0.62);
    this.spawnBurst(head, '#ff285f', 30);

    if (this.lives <= 0) {
      this.gameOver();
      return;
    }
    this.crashTimer = 0.82;
  }

  private spawnBonusFood(): void {
    const position = this.findFreeCell();
    if (!position) return;
    this.bonusFood = { position, timeLeft: 7.5, duration: 7.5 };
    this.services.sound('powerup');
    this.spawnBurst(position, '#ffe66b', 10);
  }

  private addObstaclePattern(): void {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const horizontal = Math.random() < 0.5;
      const length = Math.min(6, 2 + Math.ceil(this.level / 3));
      const startX = 2 + Math.floor(Math.random() * (GRID_WIDTH - 4));
      const startY = 2 + Math.floor(Math.random() * (GRID_HEIGHT - 4));
      const candidate: GridPoint[] = [];

      for (let offset = 0; offset < length; offset += 1) {
        candidate.push({
          x: startX + (horizontal ? offset : 0),
          y: startY + (horizontal ? 0 : offset),
        });
      }

      if (!candidate.every((point) => this.canPlaceObstacle(point))) continue;
      const candidateKeys = new Set(this.obstacles);
      candidate.forEach((point) => candidateKeys.add(this.pointKey(point)));
      const reachable = this.collectReachableCells(this.snake[0], candidateKeys);
      const freeCount = GRID_WIDTH * GRID_HEIGHT - candidateKeys.size;
      if (reachable.length < freeCount * 0.72) continue;
      if (this.normalFood && !reachable.some((point) => this.samePoint(point, this.normalFood!))) continue;

      candidate.forEach((point) => this.obstacles.add(this.pointKey(point)));
      return;
    }
  }

  private canPlaceObstacle(point: GridPoint): boolean {
    if (point.x < 1 || point.x >= GRID_WIDTH - 1 || point.y < 1 || point.y >= GRID_HEIGHT - 1) return false;
    // The central launch lane remains safe on every life.
    if (Math.abs(point.x - (Math.floor(GRID_WIDTH / 2) + 2)) <= 7 && Math.abs(point.y - Math.floor(GRID_HEIGHT / 2)) <= 3) return false;
    if (this.obstacles.has(this.pointKey(point))) return false;
    if (this.snake.some((part) => this.samePoint(part, point))) return false;
    if (this.normalFood && this.samePoint(this.normalFood, point)) return false;
    if (this.bonusFood && this.samePoint(this.bonusFood.position, point)) return false;
    return true;
  }

  private findFreeCell(): GridPoint | null {
    const origin = this.snake[0] ?? { x: Math.floor(GRID_WIDTH / 2), y: Math.floor(GRID_HEIGHT / 2) };
    const reachable = this.collectReachableCells(origin, this.obstacles).filter((point) => {
      if (this.snake.some((part) => this.samePoint(part, point))) return false;
      if (this.normalFood && this.samePoint(this.normalFood, point)) return false;
      if (this.bonusFood && this.samePoint(this.bonusFood.position, point)) return false;
      return true;
    });
    if (reachable.length === 0) return null;

    // Prefer cells a useful distance from the head, while retaining a fallback.
    const distant = reachable.filter((point) => Math.abs(point.x - origin.x) + Math.abs(point.y - origin.y) >= 7);
    const pool = distant.length > 0 ? distant : reachable;
    return { ...pool[Math.floor(Math.random() * pool.length)] };
  }

  private collectReachableCells(origin: GridPoint, blocked: Set<string>): GridPoint[] {
    if (blocked.has(this.pointKey(origin))) return [];
    const result: GridPoint[] = [];
    const queue: GridPoint[] = [{ ...origin }];
    const visited = new Set<string>([this.pointKey(origin)]);

    for (let index = 0; index < queue.length; index += 1) {
      const point = queue[index];
      result.push(point);
      for (const direction of [UP, DOWN, LEFT, RIGHT]) {
        const next = { x: point.x + direction.x, y: point.y + direction.y };
        const key = this.pointKey(next);
        if (next.x < 0 || next.x >= GRID_WIDTH || next.y < 0 || next.y >= GRID_HEIGHT) continue;
        if (blocked.has(key) || visited.has(key)) continue;
        visited.add(key);
        queue.push(next);
      }
    }
    return result;
  }

  private updateParticles(delta: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= delta;
      if (particle.life <= 0) {
        this.particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= Math.pow(0.08, delta);
      particle.vy *= Math.pow(0.08, delta);
    }
  }

  private spawnBurst(point: GridPoint, color: string, count: number): void {
    const center = this.cellCenter(point);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 24 + Math.random() * 66;
      const life = 0.28 + Math.random() * 0.48;
      this.particles.push({
        x: center.x,
        y: center.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: 1 + Math.random() * 2.4,
        color,
      });
    }
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const background = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
    background.addColorStop(0, '#090521');
    background.addColorStop(0.5, '#050817');
    background.addColorStop(1, '#02040c');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    const horizon = ctx.createRadialGradient(192, 150, 12, 192, 150, 225);
    horizon.addColorStop(0, 'rgba(29, 255, 215, 0.07)');
    horizon.addColorStop(0.55, 'rgba(105, 36, 255, 0.04)');
    horizon.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    ctx.fillStyle = 'rgba(142, 113, 255, 0.13)';
    for (let y = 31; y < SCREEN_HEIGHT; y += 5) ctx.fillRect(0, y, SCREEN_WIDTH, 1);
  }

  private drawPlayfield(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(2, 9, 19, 0.91)';
    ctx.fillRect(FIELD_X, FIELD_Y, GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE);

    ctx.strokeStyle = 'rgba(83, 255, 225, 0.075)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GRID_WIDTH; x += 1) {
      const px = FIELD_X + x * CELL_SIZE + 0.5;
      ctx.moveTo(px, FIELD_Y);
      ctx.lineTo(px, FIELD_Y + GRID_HEIGHT * CELL_SIZE);
    }
    for (let y = 0; y <= GRID_HEIGHT; y += 1) {
      const py = FIELD_Y + y * CELL_SIZE + 0.5;
      ctx.moveTo(FIELD_X, py);
      ctx.lineTo(FIELD_X + GRID_WIDTH * CELL_SIZE, py);
    }
    ctx.stroke();

    ctx.shadowColor = '#54ffe1';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(84, 255, 225, 0.72)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(FIELD_X - 2.5, FIELD_Y - 2.5, GRID_WIDTH * CELL_SIZE + 5, GRID_HEIGHT * CELL_SIZE + 5);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(184, 94, 255, 0.44)';
    ctx.strokeRect(FIELD_X - 5.5, FIELD_Y - 5.5, GRID_WIDTH * CELL_SIZE + 11, GRID_HEIGHT * CELL_SIZE + 11);
    ctx.restore();
  }

  private drawObstacles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const key of this.obstacles) {
      const [xText, yText] = key.split(',');
      const x = FIELD_X + Number(xText) * CELL_SIZE;
      const y = FIELD_Y + Number(yText) * CELL_SIZE;
      ctx.shadowColor = '#b84cff';
      ctx.shadowBlur = 7;
      ctx.fillStyle = '#441367';
      ctx.fillRect(x + 1.5, y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8d31c5';
      ctx.fillRect(x + 3, y + 3, CELL_SIZE - 6, CELL_SIZE - 6);
      ctx.fillStyle = 'rgba(255, 157, 255, 0.58)';
      ctx.fillRect(x + 3, y + 3, CELL_SIZE - 6, 1.5);
      ctx.fillRect(x + 3, y + 3, 1.5, CELL_SIZE - 6);
    }
    ctx.restore();
  }

  private drawNormalFood(ctx: CanvasRenderingContext2D): void {
    if (!this.normalFood) return;
    const center = this.cellCenter(this.normalFood);
    const pulse = 1 + Math.sin(this.elapsed * 7) * 0.12;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = '#ff3e96';
    ctx.shadowBlur = 13;
    ctx.fillStyle = '#ff3e96';
    ctx.beginPath();
    ctx.arc(0, 0.6, 4.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffb4dc';
    ctx.beginPath();
    ctx.arc(-1.3, -1, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#83ff9f';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.quadraticCurveTo(2, -6, 4, -4.5);
    ctx.stroke();
    ctx.restore();
  }

  private drawBonusFood(ctx: CanvasRenderingContext2D): void {
    if (!this.bonusFood) return;
    const center = this.cellCenter(this.bonusFood.position);
    const ratio = Math.max(0, this.bonusFood.timeLeft / this.bonusFood.duration);
    const pulse = 1 + Math.sin(this.elapsed * 12) * 0.16;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(this.elapsed * 2.2);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = '#ffe66b';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffe66b';
    ctx.beginPath();
    ctx.moveTo(0, -5.2);
    ctx.lineTo(4.6, 0);
    ctx.lineTo(0, 5.2);
    ctx.lineTo(-4.6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fffbd0';
    ctx.fillRect(-1.2, -2.8, 2.4, 5.6);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = ratio < 0.32 ? '#ff476f' : '#fff08a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(center.x, center.y, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.stroke();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
    ctx.restore();
  }

  private drawSnake(ctx: CanvasRenderingContext2D): void {
    if (this.snake.length === 0) return;
    const alpha = this.crashTimer > 0 ? 1 : Math.min(1, this.accumulator / this.currentMoveInterval());
    const positions = this.snake.map((part, index) => {
      const previous = this.previousSnake[index] ?? this.previousSnake[this.previousSnake.length - 1] ?? part;
      return this.cellCenter({
        x: previous.x + (part.x - previous.x) * alpha,
        y: previous.y + (part.y - previous.y) * alpha,
      });
    });

    ctx.save();
    ctx.globalAlpha = this.crashTimer > 0 ? 0.48 + Math.sin(this.elapsed * 44) * 0.32 : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = this.boosting ? '#f6ff63' : '#36ffd0';
    ctx.shadowBlur = this.boosting ? 14 : 9;
    ctx.strokeStyle = this.boosting ? 'rgba(217, 255, 78, 0.58)' : 'rgba(54, 255, 208, 0.42)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    const tail = positions[positions.length - 1];
    ctx.moveTo(tail.x, tail.y);
    for (let index = positions.length - 2; index >= 0; index -= 1) ctx.lineTo(positions[index].x, positions[index].y);
    ctx.stroke();

    for (let index = positions.length - 1; index >= 1; index -= 1) {
      const position = positions[index];
      const taper = positions.length <= 2 ? 0 : index / (positions.length - 1);
      const size = 9.3 - taper * 2.8;
      ctx.shadowBlur = 5;
      ctx.fillStyle = `hsl(${165 - Math.min(48, index * 2.1)} 100% ${58 - taper * 10}%)`;
      this.roundedRect(ctx, position.x - size / 2, position.y - size / 2, size, size, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(225, 255, 245, 0.28)';
      ctx.fillRect(position.x - size * 0.25, position.y - size * 0.3, size * 0.42, 1.2);
    }

    const head = positions[0];
    ctx.shadowBlur = 11;
    ctx.fillStyle = this.boosting ? '#dbff45' : '#37ffd1';
    this.roundedRect(ctx, head.x - 5.3, head.y - 5.3, 10.6, 10.6, 4);
    ctx.fill();
    this.drawSnakeFace(ctx, head);
    ctx.restore();
  }

  private drawSnakeFace(ctx: CanvasRenderingContext2D, head: { x: number; y: number }): void {
    const perpendicular = { x: -this.direction.y, y: this.direction.x };
    ctx.shadowBlur = 0;
    for (const side of [-1, 1]) {
      const eyeX = head.x + this.direction.x * 2.1 + perpendicular.x * side * 2.3;
      const eyeY = head.y + this.direction.y * 2.1 + perpendicular.y * side * 2.3;
      ctx.fillStyle = '#edffff';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, 1.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#10122d';
      ctx.beginPath();
      ctx.arc(eyeX + this.direction.x * 0.45, eyeY + this.direction.y * 0.45, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.boosting && Math.sin(this.elapsed * 24) > -0.2) {
      ctx.strokeStyle = '#ff4b9d';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const mouthX = head.x + this.direction.x * 5;
      const mouthY = head.y + this.direction.y * 5;
      ctx.moveTo(mouthX, mouthY);
      ctx.lineTo(mouthX + this.direction.x * 4, mouthY + this.direction.y * 4);
      ctx.stroke();
    }
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.font = 'bold 8px monospace';
    ctx.textBaseline = 'top';
    if (this.bonusFood) {
      ctx.textAlign = 'center';
      ctx.fillStyle = this.bonusFood.timeLeft < 2.5 ? '#ff527e' : '#ffe66b';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 5;
      ctx.fillText(`BONUS ${this.bonusFood.timeLeft.toFixed(1)}s`, SCREEN_WIDTH / 2, 19);
    } else if (this.boosting) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#dcff59';
      ctx.fillText('TURBO', SCREEN_WIDTH / 2, 19);
    }

    if (this.levelBannerTimer > 0 && !this.ended) {
      const opacity = Math.min(1, this.levelBannerTimer * 2);
      ctx.globalAlpha = opacity;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 19px monospace';
      ctx.fillStyle = '#54ffe1';
      ctx.shadowColor = '#54ffe1';
      ctx.shadowBlur = 12;
      ctx.fillText(`LEVEL ${this.level}`, SCREEN_WIDTH / 2, FIELD_Y + GRID_HEIGHT * CELL_SIZE / 2 - 5);
      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = '#d8fff7';
      ctx.fillText('GET READY', SCREEN_WIDTH / 2, FIELD_Y + GRID_HEIGHT * CELL_SIZE / 2 + 13);
    }

    if (this.crashTimer > 0) {
      ctx.globalAlpha = Math.min(1, this.crashTimer * 2.5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = '#ff527e';
      ctx.shadowColor = '#ff285f';
      ctx.shadowBlur = 10;
      ctx.fillText('SIGNAL LOST', SCREEN_WIDTH / 2, FIELD_Y + GRID_HEIGHT * CELL_SIZE / 2);
    }
    ctx.restore();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, title: string, subtitle: string, color: string): void {
    ctx.save();
    ctx.fillStyle = 'rgba(1, 3, 12, 0.76)';
    ctx.fillRect(FIELD_X, FIELD_Y, GRID_WIDTH * CELL_SIZE, GRID_HEIGHT * CELL_SIZE);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillText(title, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 8);
    ctx.shadowBlur = 0;
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#d8fff7';
    ctx.fillText(subtitle, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 17);
    ctx.restore();
  }

  private roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private cellCenter(point: GridPoint): { x: number; y: number } {
    return {
      x: FIELD_X + point.x * CELL_SIZE + CELL_SIZE / 2,
      y: FIELD_Y + point.y * CELL_SIZE + CELL_SIZE / 2,
    };
  }

  private pointKey(point: GridPoint): string {
    return `${point.x},${point.y}`;
  }

  private samePoint(a: GridPoint, b: GridPoint): boolean {
    return a.x === b.x && a.y === b.y;
  }
}
