import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../types';
import type { GameServices, InputFrame } from '../../types';
import { BaseGame } from '../BaseGame';

const PLAY_TOP = 25;
const PLAY_HEIGHT = SCREEN_HEIGHT - PLAY_TOP;
const TAU = Math.PI * 2;

type RockSize = 1 | 2 | 3;

interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  size: RockSize;
  radius: number;
  outline: number[];
  phase: number;
}

interface Laser {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface VectorSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  length: number;
  color: string;
}

interface VectorStar {
  x: number;
  y: number;
  alpha: number;
  phase: number;
}

/** Inertial vector-space shooter with three-stage splitting asteroids. */
export class VectorRocks extends BaseGame {
  readonly id = 'vector-rocks' as const;
  readonly title = 'ASTEROIDS';
  readonly controls = '← → ROTATE  ·  ↑ THRUST  ·  A FIRE  ·  B HYPER';

  private ship: Ship = this.newShip();
  private shipAlive = true;
  private thrusting = false;
  private invulnerableTimer = 0;
  private respawnTimer = 0;
  private readyTimer = 0;
  private waveTimer = 0;
  private shotCooldown = 0;
  private hyperCooldown = 0;
  private shakeTimer = 0;
  private visualTime = 0;

  private rocks: Rock[] = [];
  private lasers: Laser[] = [];
  private sparks: VectorSpark[] = [];
  private stars: VectorStar[] = [];

  constructor(services: GameServices) {
    super(services);
    this.buildStars();
  }

  start(): void {
    this.score = 0;
    this.level = 1;
    this.lives = 3;
    this.paused = false;
    this.ended = false;
    this.ship = this.newShip();
    this.shipAlive = true;
    this.thrusting = false;
    this.invulnerableTimer = 2.2;
    this.respawnTimer = 0;
    this.readyTimer = 1.25;
    this.waveTimer = 0;
    this.shotCooldown = 0;
    this.hyperCooldown = 0;
    this.shakeTimer = 0;
    this.visualTime = 0;
    this.lasers = [];
    this.sparks = [];
    this.spawnWave();
  }

  update(deltaSeconds: number, input: InputFrame): void {
    if (this.paused || this.ended) return;

    const dt = Math.min(Math.max(deltaSeconds, 0), 0.05);
    this.visualTime += dt;
    this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    this.hyperCooldown = Math.max(0, this.hyperCooldown - dt);
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    this.updateSparks(dt);
    this.updateRocks(dt);

    if (this.waveTimer > 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.level += 1;
        this.ship = this.newShip();
        this.shipAlive = true;
        this.invulnerableTimer = 2;
        this.readyTimer = 1;
        this.spawnWave();
      }
      return;
    }

    if (this.respawnTimer > 0) {
      this.updateLasers(dt);
      this.resolveLaserHits();
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        if (this.lives <= 0) {
          this.gameOver();
          return;
        }
        this.respawnShip();
      }
      this.checkWaveClear();
      return;
    }

    if (this.readyTimer > 0) {
      this.readyTimer -= dt;
      return;
    }

    this.controlShip(dt, input);
    this.updateLasers(dt);
    this.resolveLaserHits();
    this.resolveShipHits();
    this.checkWaveClear();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#010403';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawStars(ctx);

    ctx.save();
    if (this.shakeTimer > 0) {
      const power = Math.min(2.4, this.shakeTimer * 8);
      ctx.translate((Math.random() - 0.5) * power, (Math.random() - 0.5) * power);
    }
    this.drawRocks(ctx);
    this.drawLasers(ctx);
    this.drawShip(ctx);
    this.drawSparks(ctx);
    ctx.restore();

    this.drawHud(ctx, '#91ffc0');
    this.drawReserveShips(ctx);
    this.drawHyperGauge(ctx);
    this.drawStatus(ctx);

    // A nearly imperceptible rolling phosphor fluctuation keeps the vector display alive.
    const flicker = 0.006 + (Math.sin(this.visualTime * 31) + 1) * 0.002;
    ctx.fillStyle = `rgba(115, 255, 177, ${flicker})`;
    ctx.fillRect(0, PLAY_TOP, SCREEN_WIDTH, SCREEN_HEIGHT - PLAY_TOP);
    ctx.restore();
  }

  private newShip(): Ship {
    return { x: SCREEN_WIDTH / 2, y: (PLAY_TOP + SCREEN_HEIGHT) / 2, vx: 0, vy: 0, angle: -Math.PI / 2 };
  }

  private buildStars(): void {
    this.stars = [];
    for (let index = 0; index < 72; index += 1) {
      this.stars.push({
        x: Math.random() * SCREEN_WIDTH,
        y: PLAY_TOP + Math.random() * PLAY_HEIGHT,
        alpha: 0.08 + Math.random() * 0.28,
        phase: Math.random() * TAU,
      });
    }
  }

  private spawnWave(): void {
    this.rocks = [];
    this.lasers = [];
    const count = Math.min(10, 3 + this.level);
    for (let index = 0; index < count; index += 1) {
      const edge = Math.floor(Math.random() * 4);
      let x: number;
      let y: number;
      if (edge === 0) {
        x = Math.random() * SCREEN_WIDTH;
        y = PLAY_TOP + 4;
      } else if (edge === 1) {
        x = SCREEN_WIDTH - 4;
        y = PLAY_TOP + Math.random() * PLAY_HEIGHT;
      } else if (edge === 2) {
        x = Math.random() * SCREEN_WIDTH;
        y = SCREEN_HEIGHT - 4;
      } else {
        x = 4;
        y = PLAY_TOP + Math.random() * PLAY_HEIGHT;
      }

      const direction = Math.random() * TAU;
      const speed = 19 + this.level * 2.5 + Math.random() * 17;
      this.rocks.push(this.createRock(3, x, y, Math.cos(direction) * speed, Math.sin(direction) * speed));
    }
  }

  private createRock(size: RockSize, x: number, y: number, vx: number, vy: number): Rock {
    const radius = size === 3 ? 23 : size === 2 ? 13 : 7;
    const vertexCount = size === 3 ? 11 : size === 2 ? 9 : 7;
    const outline: number[] = [];
    for (let index = 0; index < vertexCount; index += 1) {
      outline.push(0.72 + Math.random() * 0.35);
    }
    return {
      x,
      y,
      vx,
      vy,
      angle: Math.random() * TAU,
      spin: (Math.random() - 0.5) * (1.1 + (3 - size) * 0.32),
      size,
      radius,
      outline,
      phase: Math.random() * TAU,
    };
  }

  private controlShip(dt: number, input: InputFrame): void {
    if (!this.shipAlive) return;

    const turn = input.horizontal || (input.down('left') ? -1 : input.down('right') ? 1 : 0);
    this.ship.angle += turn * 3.9 * dt;
    if (this.ship.angle > Math.PI) this.ship.angle -= TAU;
    if (this.ship.angle < -Math.PI) this.ship.angle += TAU;

    this.thrusting = input.down('up');
    if (this.thrusting) {
      const acceleration = 128 + Math.min(32, this.level * 2);
      this.ship.vx += Math.cos(this.ship.angle) * acceleration * dt;
      this.ship.vy += Math.sin(this.ship.angle) * acceleration * dt;
      if (Math.random() < dt * 45) this.emitThrustSpark();
    }

    const drag = Math.pow(input.down('down') ? 0.955 : 0.994, dt * 60);
    this.ship.vx *= drag;
    this.ship.vy *= drag;
    const speed = Math.hypot(this.ship.vx, this.ship.vy);
    if (speed > 182) {
      this.ship.vx = (this.ship.vx / speed) * 182;
      this.ship.vy = (this.ship.vy / speed) * 182;
    }

    this.ship.x += this.ship.vx * dt;
    this.ship.y += this.ship.vy * dt;
    this.wrapPoint(this.ship);

    const wantsFire = input.pressed('buttonA') || input.pressed('buttonC') || input.down('buttonA');
    if (wantsFire && this.shotCooldown <= 0 && this.lasers.length < 6) {
      const noseX = this.ship.x + Math.cos(this.ship.angle) * 10;
      const noseY = this.ship.y + Math.sin(this.ship.angle) * 10;
      this.lasers.push({
        x: noseX,
        y: noseY,
        vx: this.ship.vx + Math.cos(this.ship.angle) * 245,
        vy: this.ship.vy + Math.sin(this.ship.angle) * 245,
        life: 1.28,
      });
      this.shotCooldown = 0.16;
      this.services.sound('shot');
    }

    if (input.pressed('buttonB') && this.hyperCooldown <= 0) this.hyperspace();
  }

  private hyperspace(): void {
    const oldX = this.ship.x;
    const oldY = this.ship.y;
    let bestX = SCREEN_WIDTH / 2;
    let bestY = (PLAY_TOP + SCREEN_HEIGHT) / 2;
    let bestClearance = -1;

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const x = 20 + Math.random() * (SCREEN_WIDTH - 40);
      const y = PLAY_TOP + 18 + Math.random() * (PLAY_HEIGHT - 36);
      let clearance = Infinity;
      for (const rock of this.rocks) {
        clearance = Math.min(clearance, Math.sqrt(this.toroidalDistanceSq(x, y, rock.x, rock.y)) - rock.radius);
      }
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestX = x;
        bestY = y;
      }
    }

    this.spawnBurst(oldX, oldY, '#78ffad', 10, 48);
    this.ship.x = bestX;
    this.ship.y = bestY;
    this.ship.vx *= 0.35;
    this.ship.vy *= 0.35;
    this.invulnerableTimer = Math.max(this.invulnerableTimer, 0.9);
    this.hyperCooldown = 3;
    this.spawnBurst(bestX, bestY, '#e4fff0', 13, 58);
    this.services.sound('powerup');
    this.services.flash('#72ffad', 0.2);
  }

  private updateRocks(dt: number): void {
    for (const rock of this.rocks) {
      rock.x += rock.vx * dt;
      rock.y += rock.vy * dt;
      rock.angle += rock.spin * dt;
      this.wrapRock(rock);
    }
  }

  private updateLasers(dt: number): void {
    for (let index = this.lasers.length - 1; index >= 0; index -= 1) {
      const laser = this.lasers[index];
      laser.life -= dt;
      if (laser.life <= 0) {
        this.lasers.splice(index, 1);
        continue;
      }
      laser.x += laser.vx * dt;
      laser.y += laser.vy * dt;
      this.wrapPoint(laser);
    }
  }

  private resolveLaserHits(): void {
    for (let laserIndex = this.lasers.length - 1; laserIndex >= 0; laserIndex -= 1) {
      const laser = this.lasers[laserIndex];
      let hitIndex = -1;
      for (let rockIndex = this.rocks.length - 1; rockIndex >= 0; rockIndex -= 1) {
        const rock = this.rocks[rockIndex];
        const hitRadius = rock.radius * 0.9 + 2;
        if (this.toroidalDistanceSq(laser.x, laser.y, rock.x, rock.y) <= hitRadius * hitRadius) {
          hitIndex = rockIndex;
          break;
        }
      }
      if (hitIndex >= 0) {
        this.lasers.splice(laserIndex, 1);
        this.breakRock(hitIndex);
      }
    }
  }

  private breakRock(index: number): void {
    const rock = this.rocks[index];
    if (!rock) return;
    this.rocks.splice(index, 1);

    const points = rock.size === 3 ? 20 : rock.size === 2 ? 50 : 100;
    this.score += points * this.level;
    const color = rock.size === 1 ? '#eafff0' : '#8dffb5';
    this.spawnBurst(rock.x, rock.y, color, rock.size === 3 ? 16 : rock.size === 2 ? 11 : 7, 46 + rock.size * 12);

    if (rock.size > 1) {
      const childSize = (rock.size - 1) as RockSize;
      const inheritedDirection = Math.atan2(rock.vy, rock.vx);
      const childSpeed = Math.hypot(rock.vx, rock.vy) + 18 + Math.random() * 12;
      for (const side of [-1, 1]) {
        const direction = inheritedDirection + side * (0.58 + Math.random() * 0.38);
        const offset = side * (childSize === 2 ? 8 : 5);
        this.rocks.push(this.createRock(
          childSize,
          rock.x + Math.cos(direction + Math.PI / 2) * offset,
          rock.y + Math.sin(direction + Math.PI / 2) * offset,
          Math.cos(direction) * childSpeed,
          Math.sin(direction) * childSpeed,
        ));
      }
    }

    this.shakeTimer = Math.max(this.shakeTimer, rock.size === 3 ? 0.16 : 0.07);
    this.services.sound(rock.size === 1 ? 'explosion' : 'hit');
    if (rock.size === 1) this.services.flash('#b8ffd0', 0.12);
  }

  private resolveShipHits(): void {
    if (!this.shipAlive || this.invulnerableTimer > 0) return;
    for (const rock of this.rocks) {
      const radius = rock.radius * 0.82 + 6;
      if (this.toroidalDistanceSq(this.ship.x, this.ship.y, rock.x, rock.y) <= radius * radius) {
        this.destroyShip();
        return;
      }
    }
  }

  private destroyShip(): void {
    if (!this.shipAlive) return;
    this.shipAlive = false;
    this.thrusting = false;
    this.lives -= 1;
    this.respawnTimer = 1.45;
    this.spawnBurst(this.ship.x, this.ship.y, '#dfffea', 24, 98);
    this.shakeTimer = 0.45;
    this.services.sound('death');
    this.services.flash('#dfffea', 0.68);
  }

  private respawnShip(): void {
    this.ship = this.newShip();
    let bestX = this.ship.x;
    let bestY = this.ship.y;
    let bestClearance = -Infinity;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const x = attempt === 0 ? SCREEN_WIDTH / 2 : 30 + Math.random() * (SCREEN_WIDTH - 60);
      const y = attempt === 0 ? (PLAY_TOP + SCREEN_HEIGHT) / 2 : PLAY_TOP + 28 + Math.random() * (PLAY_HEIGHT - 56);
      let clearance = Infinity;
      for (const rock of this.rocks) {
        clearance = Math.min(clearance, Math.sqrt(this.toroidalDistanceSq(x, y, rock.x, rock.y)) - rock.radius);
      }
      if (clearance > bestClearance) {
        bestClearance = clearance;
        bestX = x;
        bestY = y;
      }
    }
    this.ship.x = bestX;
    this.ship.y = bestY;
    this.shipAlive = true;
    this.invulnerableTimer = 2;
  }

  private checkWaveClear(): void {
    if (this.rocks.length > 0 || this.waveTimer > 0 || this.lives <= 0) return;
    this.score += this.level * 150;
    this.waveTimer = 1.7;
    this.lasers = [];
    this.services.sound('level');
    this.services.flash('#84ffb4', 0.32);
  }

  private wrapPoint(point: { x: number; y: number }): void {
    if (point.x < 0) point.x += SCREEN_WIDTH;
    else if (point.x >= SCREEN_WIDTH) point.x -= SCREEN_WIDTH;
    if (point.y < PLAY_TOP) point.y += PLAY_HEIGHT;
    else if (point.y >= SCREEN_HEIGHT) point.y -= PLAY_HEIGHT;
  }

  private wrapRock(rock: Rock): void {
    const margin = rock.radius;
    if (rock.x < -margin) rock.x = SCREEN_WIDTH + margin;
    else if (rock.x > SCREEN_WIDTH + margin) rock.x = -margin;
    if (rock.y < PLAY_TOP - margin) rock.y = SCREEN_HEIGHT + margin;
    else if (rock.y > SCREEN_HEIGHT + margin) rock.y = PLAY_TOP - margin;
  }

  private toroidalDistanceSq(ax: number, ay: number, bx: number, by: number): number {
    const rawX = Math.abs(ax - bx);
    const rawY = Math.abs(ay - by);
    const dx = Math.min(rawX, Math.abs(SCREEN_WIDTH - rawX));
    const dy = Math.min(rawY, Math.abs(PLAY_HEIGHT - rawY));
    return dx * dx + dy * dy;
  }

  private emitThrustSpark(): void {
    const angle = this.ship.angle + Math.PI + (Math.random() - 0.5) * 0.42;
    const speed = 35 + Math.random() * 48;
    const maxLife = 0.12 + Math.random() * 0.18;
    this.sparks.push({
      x: this.ship.x - Math.cos(this.ship.angle) * 8,
      y: this.ship.y - Math.sin(this.ship.angle) * 8,
      vx: this.ship.vx * 0.25 + Math.cos(angle) * speed,
      vy: this.ship.vy * 0.25 + Math.sin(angle) * speed,
      life: maxLife,
      maxLife,
      length: 2 + Math.random() * 3,
      color: Math.random() > 0.45 ? '#8effbb' : '#ffffff',
    });
  }

  private spawnBurst(x: number, y: number, color: string, count: number, speed: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * TAU;
      const velocity = speed * (0.25 + Math.random() * 0.85);
      const maxLife = 0.25 + Math.random() * 0.62;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: maxLife,
        maxLife,
        length: 2 + Math.random() * 7,
        color,
      });
    }
    if (this.sparks.length > 220) this.sparks.splice(0, this.sparks.length - 220);
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
      spark.vx *= Math.pow(0.34, dt);
      spark.vy *= Math.pow(0.34, dt);
      this.wrapPoint(spark);
    }
  }

  private drawStars(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const star of this.stars) {
      ctx.globalAlpha = star.alpha * (0.75 + Math.sin(this.visualTime * 1.3 + star.phase) * 0.25);
      ctx.fillStyle = '#8bffc0';
      ctx.fillRect(Math.round(star.x), Math.round(star.y), 1, 1);
    }
    ctx.restore();
  }

  private drawRocks(ctx: CanvasRenderingContext2D): void {
    for (const rock of this.rocks) {
      this.forEachWrappedCopy(rock.x, rock.y, rock.radius + 2, (x, y) => this.drawRock(ctx, rock, x, y));
    }
  }

  private drawRock(ctx: CanvasRenderingContext2D, rock: Rock, x: number, y: number): void {
    const jitter = Math.sin(this.visualTime * 17 + rock.phase) * 0.22;
    ctx.save();
    ctx.translate(x + jitter, y - jitter * 0.6);
    ctx.rotate(rock.angle);
    ctx.strokeStyle = rock.size === 1 ? '#d9ffe6' : '#83ffae';
    ctx.shadowColor = '#57ff91';
    ctx.shadowBlur = rock.size === 3 ? 8 : 6;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (let index = 0; index < rock.outline.length; index += 1) {
      const angle = (index / rock.outline.length) * TAU;
      const radius = rock.radius * rock.outline[index];
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    if (rock.size >= 2) {
      ctx.globalAlpha = 0.48;
      ctx.beginPath();
      ctx.moveTo(-rock.radius * 0.3, -rock.radius * 0.12);
      ctx.lineTo(rock.radius * 0.15, -rock.radius * 0.4);
      ctx.lineTo(rock.radius * 0.38, -rock.radius * 0.02);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawShip(ctx: CanvasRenderingContext2D): void {
    if (!this.shipAlive) return;
    if (this.invulnerableTimer > 0 && Math.floor(this.invulnerableTimer * 12) % 2 === 0) return;
    this.forEachWrappedCopy(this.ship.x, this.ship.y, 12, (x, y) => {
      const jitter = Math.sin(this.visualTime * 23) * 0.16;
      ctx.save();
      ctx.translate(x + jitter, y);
      ctx.rotate(this.ship.angle);
      ctx.strokeStyle = '#e6ffed';
      ctx.shadowColor = '#77ffa5';
      ctx.shadowBlur = 9;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-8, -7);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-8, 7);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(3, 0);
      ctx.stroke();

      if (this.thrusting) {
        ctx.strokeStyle = Math.random() > 0.45 ? '#9affbd' : '#ffffff';
        ctx.shadowBlur = 11;
        ctx.beginPath();
        ctx.moveTo(-7, -3);
        ctx.lineTo(-13 - Math.random() * 6, 0);
        ctx.lineTo(-7, 3);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  private drawLasers(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = '#f1fff4';
    ctx.shadowColor = '#8bffae';
    ctx.shadowBlur = 9;
    ctx.lineWidth = 1.4;
    for (const laser of this.lasers) {
      const speed = Math.max(1, Math.hypot(laser.vx, laser.vy));
      const dx = (laser.vx / speed) * 5;
      const dy = (laser.vy / speed) * 5;
      this.forEachWrappedCopy(laser.x, laser.y, 5, (x, y) => {
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  private drawSparks(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.shadowBlur = 7;
    for (const spark of this.sparks) {
      const alpha = Math.max(0, spark.life / spark.maxLife);
      const speed = Math.max(1, Math.hypot(spark.vx, spark.vy));
      const dx = (spark.vx / speed) * spark.length * alpha;
      const dy = (spark.vy / speed) * spark.length * alpha;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = spark.color;
      ctx.shadowColor = spark.color;
      ctx.beginPath();
      ctx.moveTo(spark.x - dx, spark.y - dy);
      ctx.lineTo(spark.x + dx, spark.y + dy);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawReserveShips(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = '#78ffaa';
    ctx.shadowColor = '#4cff88';
    ctx.shadowBlur = 4;
    ctx.lineWidth = 1;
    for (let index = 0; index < Math.max(0, this.lives - 1); index += 1) {
      const x = 12 + index * 12;
      const y = SCREEN_HEIGHT - 8;
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x - 4, y + 4);
      ctx.lineTo(x, y + 2);
      ctx.lineTo(x + 4, y + 4);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHyperGauge(ctx: CanvasRenderingContext2D): void {
    const ready = 1 - Math.min(1, this.hyperCooldown / 3);
    ctx.save();
    ctx.font = '7px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = ready >= 1 ? '#a4ffc5' : '#3c7351';
    ctx.fillText('HYPER', SCREEN_WIDTH - 34, SCREEN_HEIGHT - 6);
    ctx.strokeStyle = '#315e42';
    ctx.strokeRect(SCREEN_WIDTH - 31, SCREEN_HEIGHT - 11, 23, 5);
    ctx.fillStyle = ready >= 1 ? '#81ffad' : '#45825b';
    ctx.fillRect(SCREEN_WIDTH - 30, SCREEN_HEIGHT - 10, Math.round(21 * ready), 3);
    ctx.restore();
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    let line = '';
    let subline = '';
    if (this.readyTimer > 0) {
      line = this.level === 1 ? 'ASTEROIDS' : `FIELD ${this.level}`;
      subline = 'THRUST TO SURVIVE';
    } else if (this.waveTimer > 0) {
      line = 'FIELD CLEAR';
      subline = `BONUS ${this.level * 150}`;
    } else if (this.respawnTimer > 0 && this.lives > 0) {
      line = 'SIGNAL LOST';
      subline = 'RECALIBRATING';
    }
    if (!line) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#dfffea';
    ctx.shadowColor = '#6aff9b';
    ctx.shadowBlur = 9;
    ctx.fillText(line, SCREEN_WIDTH / 2, 139);
    if (subline) {
      ctx.font = '8px monospace';
      ctx.fillStyle = '#8bffb3';
      ctx.fillText(subline, SCREEN_WIDTH / 2, 156);
    }
    ctx.restore();
  }

  private forEachWrappedCopy(
    x: number,
    y: number,
    radius: number,
    draw: (drawX: number, drawY: number) => void,
  ): void {
    const xs = [x];
    const ys = [y];
    if (x < radius) xs.push(x + SCREEN_WIDTH);
    if (x > SCREEN_WIDTH - radius) xs.push(x - SCREEN_WIDTH);
    if (y < PLAY_TOP + radius) ys.push(y + PLAY_HEIGHT);
    if (y > SCREEN_HEIGHT - radius) ys.push(y - PLAY_HEIGHT);
    for (const drawX of xs) for (const drawY of ys) draw(drawX, drawY);
  }
}

export default VectorRocks;
