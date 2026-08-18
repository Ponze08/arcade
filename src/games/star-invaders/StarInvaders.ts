import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../types';
import type { GameServices, InputFrame } from '../../types';
import { BaseGame } from '../BaseGame';

const PLAY_TOP = 25;
const PLAYER_Y = 263;
const PLAYER_WIDTH = 20;
const ENEMY_WIDTH = 16;
const ENEMY_HEIGHT = 12;

interface Invader {
  col: number;
  row: number;
  x: number;
  y: number;
  kind: 0 | 1 | 2;
  alive: boolean;
}

interface Shot {
  x: number;
  y: number;
  vy: number;
  hostile: boolean;
  phase: number;
}

interface BarrierPixel {
  x: number;
  y: number;
  alive: boolean;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface BackdropStar {
  x: number;
  y: number;
  brightness: number;
  phase: number;
}

interface BonusCraft {
  active: boolean;
  x: number;
  y: number;
  vx: number;
}

const INVADER_SPRITES: ReadonlyArray<ReadonlyArray<string>> = [
  [
    '   XX   ',
    '  XXXX  ',
    ' XXXXX  ',
    'XX XX XX',
    'XXXXXXXX',
    ' X    X ',
  ],
  [
    '  X  X  ',
    '   XX   ',
    '  XXXX  ',
    ' XX  XX ',
    'XXXXXXXX',
    'X X  X X',
  ],
  [
    '   XX   ',
    ' XXXXXX ',
    'XX XX XX',
    'XXXXXXXX',
    '  X  X  ',
    ' X XX X ',
  ],
];

/** A complete fixed-screen formation shooter with destructible pixel barriers. */
export class StarInvaders extends BaseGame {
  readonly id = 'star-invaders' as const;
  readonly title = 'SPACE INVADERS';
  readonly controls = '← → MOVE  ·  A FIRE';

  private playerX = SCREEN_WIDTH / 2;
  private playerCooldown = 0;
  private invulnerableTimer = 0;
  private deathTimer = 0;
  private readyTimer = 0;
  private waveTimer = 0;
  private visualTime = 0;

  private invaders: Invader[] = [];
  private shots: Shot[] = [];
  private barriers: BarrierPixel[] = [];
  private sparks: Spark[] = [];
  private stars: BackdropStar[] = [];
  private ufo: BonusCraft = { active: false, x: -30, y: 32, vx: 54 };

  private formationX = 0;
  private formationY = 0;
  private formationDirection: 1 | -1 = 1;
  private formationFrame = 0;
  private formationClock = 0;
  private enemyShotTimer = 0;
  private ufoTimer = 0;
  private shakeTimer = 0;
  private initialEnemyCount = 50;

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
    this.visualTime = 0;
    this.playerX = SCREEN_WIDTH / 2;
    this.playerCooldown = 0;
    this.invulnerableTimer = 0;
    this.deathTimer = 0;
    this.waveTimer = 0;
    this.shakeTimer = 0;
    this.sparks = [];
    this.prepareWave(true);
    this.readyTimer = 1.2;
  }

  update(deltaSeconds: number, input: InputFrame): void {
    if (this.paused || this.ended) return;

    const dt = Math.min(Math.max(deltaSeconds, 0), 0.05);
    this.visualTime += dt;
    this.updateSparks(dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    this.playerCooldown = Math.max(0, this.playerCooldown - dt);
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);

    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        if (this.lives <= 0) {
          this.gameOver();
          return;
        }
        this.playerX = SCREEN_WIDTH / 2;
        this.invulnerableTimer = 1.8;
        this.shots = this.shots.filter((shot) => !shot.hostile);
      }
      return;
    }

    if (this.waveTimer > 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.level += 1;
        this.prepareWave(true);
        this.readyTimer = 0.8;
      }
      return;
    }

    if (this.readyTimer > 0) {
      this.readyTimer -= dt;
      return;
    }

    const move = input.horizontal || (input.down('left') ? -1 : input.down('right') ? 1 : 0);
    this.playerX = Math.max(
      PLAYER_WIDTH / 2 + 7,
      Math.min(SCREEN_WIDTH - PLAYER_WIDTH / 2 - 7, this.playerX + move * 148 * dt),
    );

    const wantsFire = input.pressed('buttonA') || input.pressed('buttonB') || input.down('buttonA');
    const friendlyShots = this.shots.reduce((count, shot) => count + (shot.hostile ? 0 : 1), 0);
    if (wantsFire && this.playerCooldown <= 0 && friendlyShots < 2) {
      this.shots.push({ x: this.playerX, y: PLAYER_Y - 11, vy: -226, hostile: false, phase: 0 });
      this.playerCooldown = 0.22;
      this.services.sound('shot');
    }

    this.updateFormation(dt);
    this.updateEnemyFire(dt);
    this.updateUfo(dt);
    this.updateShots(dt);

    if (this.remainingInvaders() === 0 && this.waveTimer <= 0) {
      this.score += this.level * 100;
      this.waveTimer = 1.55;
      this.shots = [];
      this.services.sound('level');
      this.services.flash('#87fff3', 0.3);
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#02030b';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.drawStars(ctx);

    ctx.save();
    if (this.shakeTimer > 0) {
      const magnitude = Math.min(2.2, this.shakeTimer * 7);
      ctx.translate((Math.random() - 0.5) * magnitude, (Math.random() - 0.5) * magnitude);
    }
    this.drawGround(ctx);
    this.drawBarriers(ctx);
    this.drawInvaders(ctx);
    this.drawUfo(ctx);
    this.drawShots(ctx);
    this.drawPlayer(ctx);
    this.drawSparks(ctx);
    ctx.restore();

    this.drawHud(ctx, '#81fff2');
    this.drawStatus(ctx);
    ctx.restore();
  }

  private prepareWave(rebuildBarriers: boolean): void {
    this.invaders = [];
    const columns = 10;
    const rows = 5;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        this.invaders.push({
          col,
          row,
          x: 48 + col * 29,
          y: 48 + row * 18,
          kind: row === 0 ? 0 : row < 3 ? 1 : 2,
          alive: true,
        });
      }
    }
    this.initialEnemyCount = this.invaders.length;
    this.formationX = 0;
    this.formationY = 0;
    this.formationDirection = 1;
    this.formationFrame = 0;
    this.formationClock = 0;
    this.enemyShotTimer = 0.65;
    this.ufoTimer = 5.5 + Math.random() * 5;
    this.ufo = { active: false, x: -30, y: 32, vx: 54 };
    this.shots = [];
    if (rebuildBarriers) this.buildBarriers();
  }

  private buildStars(): void {
    this.stars = [];
    for (let index = 0; index < 58; index += 1) {
      this.stars.push({
        x: Math.random() * SCREEN_WIDTH,
        y: PLAY_TOP + Math.random() * (SCREEN_HEIGHT - PLAY_TOP),
        brightness: 0.2 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  private buildBarriers(): void {
    this.barriers = [];
    const centers = [55, 146, 237, 328];
    for (const center of centers) {
      const left = center - 18;
      for (let row = 0; row < 7; row += 1) {
        for (let col = 0; col < 12; col += 1) {
          const clippedCorner = row === 0 && (col < 2 || col > 9);
          const lowerCorner = row === 1 && (col === 0 || col === 11);
          const arch = row >= 4 && col >= 4 && col <= 7;
          if (!clippedCorner && !lowerCorner && !arch) {
            this.barriers.push({ x: left + col * 3, y: 222 + row * 3, alive: true });
          }
        }
      }
    }
  }

  private updateFormation(dt: number): void {
    const remaining = this.remainingInvaders();
    if (remaining === 0) return;

    const levelFactor = Math.max(0.68, 1 - (this.level - 1) * 0.055);
    const populationFactor = 0.13 + 0.87 * (remaining / this.initialEnemyCount);
    const interval = Math.max(0.055, 0.56 * levelFactor * populationFactor);
    this.formationClock += dt;

    let guard = 0;
    while (this.formationClock >= interval && guard < 3) {
      this.formationClock -= interval;
      guard += 1;
      this.marchFormation();
    }
  }

  private marchFormation(): void {
    const alive = this.invaders.filter((invader) => invader.alive);
    if (alive.length === 0) return;

    let left = Infinity;
    let right = -Infinity;
    for (const invader of alive) {
      left = Math.min(left, invader.x + this.formationX);
      right = Math.max(right, invader.x + this.formationX + ENEMY_WIDTH);
    }

    const step = 4;
    const nextLeft = left + step * this.formationDirection;
    const nextRight = right + step * this.formationDirection;
    if (nextLeft < 8 || nextRight > SCREEN_WIDTH - 8) {
      this.formationDirection = this.formationDirection === 1 ? -1 : 1;
      this.formationY += 7;
      this.erodeBarriers();
    } else {
      this.formationX += step * this.formationDirection;
    }

    this.formationFrame = 1 - this.formationFrame;
    this.services.sound('move');

    const lowest = alive.reduce(
      (bottom, invader) => Math.max(bottom, invader.y + this.formationY + ENEMY_HEIGHT),
      0,
    );
    if (lowest >= PLAYER_Y - 8) {
      this.formationX = 0;
      this.formationY = 0;
      this.formationDirection = 1;
      this.hitPlayer(true);
    }
  }

  private updateEnemyFire(dt: number): void {
    this.enemyShotTimer -= dt;
    if (this.enemyShotTimer > 0) return;

    const hostileCount = this.shots.reduce((count, shot) => count + (shot.hostile ? 1 : 0), 0);
    const maxHostile = Math.min(6, 2 + Math.floor(this.level / 2));
    if (hostileCount < maxHostile) {
      const shooters: Invader[] = [];
      for (let col = 0; col < 10; col += 1) {
        let candidate: Invader | undefined;
        for (const invader of this.invaders) {
          if (invader.alive && invader.col === col && (!candidate || invader.row > candidate.row)) {
            candidate = invader;
          }
        }
        if (candidate) shooters.push(candidate);
      }
      const shooter = shooters[Math.floor(Math.random() * shooters.length)];
      if (shooter) {
        this.shots.push({
          x: shooter.x + this.formationX + ENEMY_WIDTH / 2,
          y: shooter.y + this.formationY + ENEMY_HEIGHT,
          vy: 92 + this.level * 8,
          hostile: true,
          phase: Math.random() * 4,
        });
      }
    }

    const cadence = Math.max(0.27, 1.08 - this.level * 0.065);
    this.enemyShotTimer = cadence * (0.72 + Math.random() * 0.62);
  }

  private updateUfo(dt: number): void {
    if (!this.ufo.active) {
      this.ufoTimer -= dt;
      if (this.ufoTimer <= 0) {
        const fromLeft = Math.random() > 0.5;
        this.ufo = {
          active: true,
          x: fromLeft ? -25 : SCREEN_WIDTH + 25,
          y: 32,
          vx: (fromLeft ? 1 : -1) * (48 + this.level * 2),
        };
        this.services.sound('move');
      }
      return;
    }

    this.ufo.x += this.ufo.vx * dt;
    if (this.ufo.x < -35 || this.ufo.x > SCREEN_WIDTH + 35) {
      this.ufo.active = false;
      this.ufoTimer = 7 + Math.random() * 8;
    }
  }

  private updateShots(dt: number): void {
    for (const shot of this.shots) {
      shot.y += shot.vy * dt;
      shot.phase += dt * 18;
    }

    for (let index = this.shots.length - 1; index >= 0; index -= 1) {
      const shot = this.shots[index];
      if (shot.y < PLAY_TOP || shot.y > SCREEN_HEIGHT + 8) {
        this.shots.splice(index, 1);
        continue;
      }

      if (this.damageBarrier(shot.x, shot.y, shot.hostile ? 5.5 : 4.5)) {
        this.shots.splice(index, 1);
        this.spawnSparks(shot.x, shot.y, '#75ff9a', 4, 28);
        continue;
      }

      if (shot.hostile) {
        if (
          this.deathTimer <= 0
          && this.invulnerableTimer <= 0
          && Math.abs(shot.x - this.playerX) < PLAYER_WIDTH / 2
          && shot.y >= PLAYER_Y - 8
          && shot.y <= PLAYER_Y + 7
        ) {
          this.shots.splice(index, 1);
          this.hitPlayer(false);
        }
        continue;
      }

      if (
        this.ufo.active
        && Math.abs(shot.x - this.ufo.x) < 13
        && Math.abs(shot.y - this.ufo.y) < 7
      ) {
        this.shots.splice(index, 1);
        this.ufo.active = false;
        const bonuses = [100, 150, 200, 300];
        this.score += bonuses[Math.floor(Math.random() * bonuses.length)];
        this.spawnSparks(this.ufo.x, this.ufo.y, '#ff5cbe', 22, 75);
        this.services.sound('explosion');
        this.services.flash('#ff65ce', 0.42);
        this.shakeTimer = 0.22;
        this.ufoTimer = 8 + Math.random() * 7;
        continue;
      }

      let hit: Invader | undefined;
      for (const invader of this.invaders) {
        if (!invader.alive) continue;
        const x = invader.x + this.formationX;
        const y = invader.y + this.formationY;
        if (shot.x >= x && shot.x <= x + ENEMY_WIDTH && shot.y >= y && shot.y <= y + ENEMY_HEIGHT) {
          hit = invader;
          break;
        }
      }
      if (hit) {
        this.shots.splice(index, 1);
        hit.alive = false;
        const points = hit.kind === 0 ? 40 : hit.kind === 1 ? 20 : 10;
        this.score += points * this.level;
        const hx = hit.x + this.formationX + ENEMY_WIDTH / 2;
        const hy = hit.y + this.formationY + ENEMY_HEIGHT / 2;
        this.spawnSparks(hx, hy, hit.kind === 0 ? '#ff66d4' : '#7ffff2', 14, 54);
        this.services.sound('hit');
        this.shakeTimer = Math.max(this.shakeTimer, 0.07);
      }
    }
  }

  private hitPlayer(force: boolean): void {
    if (this.deathTimer > 0 || (!force && this.invulnerableTimer > 0)) return;
    this.lives -= 1;
    this.deathTimer = 1.25;
    this.invulnerableTimer = 0;
    this.shakeTimer = 0.45;
    this.spawnSparks(this.playerX, PLAYER_Y, '#92fff6', 28, 95);
    this.services.sound('death');
    this.services.flash('#d8ffff', 0.75);
  }

  private damageBarrier(x: number, y: number, radius: number): boolean {
    let struck = false;
    for (const pixel of this.barriers) {
      if (!pixel.alive) continue;
      if (x >= pixel.x - 1 && x <= pixel.x + 4 && y >= pixel.y - 2 && y <= pixel.y + 5) {
        struck = true;
        break;
      }
    }
    if (!struck) return false;

    const radiusSq = radius * radius;
    for (const pixel of this.barriers) {
      if (!pixel.alive) continue;
      const dx = pixel.x + 1.5 - x;
      const dy = pixel.y + 1.5 - y;
      if (dx * dx + dy * dy <= radiusSq * (0.72 + Math.random() * 0.58)) pixel.alive = false;
    }
    return true;
  }

  private erodeBarriers(): void {
    for (const invader of this.invaders) {
      if (!invader.alive) continue;
      const x = invader.x + this.formationX;
      const y = invader.y + this.formationY;
      for (const pixel of this.barriers) {
        if (
          pixel.alive
          && pixel.x + 3 >= x
          && pixel.x <= x + ENEMY_WIDTH
          && pixel.y + 3 >= y
          && pixel.y <= y + ENEMY_HEIGHT
        ) {
          pixel.alive = false;
        }
      }
    }
  }

  private spawnSparks(x: number, y: number, color: string, count: number, speed: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.35 + Math.random() * 0.75);
      const maxLife = 0.22 + Math.random() * 0.42;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: maxLife,
        maxLife,
        size: Math.random() > 0.7 ? 3 : 2,
        color,
      });
    }
    if (this.sparks.length > 180) this.sparks.splice(0, this.sparks.length - 180);
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
      spark.vx *= Math.pow(0.12, dt);
      spark.vy = spark.vy * Math.pow(0.18, dt) + 15 * dt;
    }
  }

  private remainingInvaders(): number {
    let count = 0;
    for (const invader of this.invaders) if (invader.alive) count += 1;
    return count;
  }

  private drawStars(ctx: CanvasRenderingContext2D): void {
    for (const star of this.stars) {
      const pulse = 0.65 + Math.sin(this.visualTime * 1.7 + star.phase) * 0.25;
      ctx.globalAlpha = star.brightness * pulse;
      ctx.fillStyle = '#9fb8dc';
      ctx.fillRect(Math.round(star.x), Math.round(star.y), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  private drawGround(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#315e72';
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(7, 278.5);
    ctx.lineTo(SCREEN_WIDTH - 7, 278.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawInvaders(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.shadowBlur = 7;
    for (const invader of this.invaders) {
      if (!invader.alive) continue;
      const x = Math.round(invader.x + this.formationX);
      const y = Math.round(invader.y + this.formationY);
      const color = invader.kind === 0 ? '#ff67d1' : invader.kind === 1 ? '#72f9ff' : '#a3ff69';
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      const sprite = INVADER_SPRITES[invader.kind];
      for (let row = 0; row < sprite.length; row += 1) {
        for (let col = 0; col < sprite[row].length; col += 1) {
          if (sprite[row][col] === 'X') ctx.fillRect(x + col * 2, y + row * 2, 2, 2);
        }
      }
      const footY = y + 11;
      if (this.formationFrame === 0) {
        ctx.fillRect(x, footY, 3, 2);
        ctx.fillRect(x + 13, footY, 3, 2);
      } else {
        ctx.fillRect(x + 3, footY, 3, 2);
        ctx.fillRect(x + 10, footY, 3, 2);
      }
    }
    ctx.restore();
  }

  private drawBarriers(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#59ff8e';
    ctx.shadowColor = '#59ff8e';
    ctx.shadowBlur = 5;
    for (const pixel of this.barriers) {
      if (pixel.alive) ctx.fillRect(pixel.x, pixel.y, 3, 3);
    }
    ctx.restore();
  }

  private drawUfo(ctx: CanvasRenderingContext2D): void {
    if (!this.ufo.active) return;
    const x = Math.round(this.ufo.x);
    const y = Math.round(this.ufo.y);
    ctx.save();
    ctx.fillStyle = '#ff4ebd';
    ctx.shadowColor = '#ff4ebd';
    ctx.shadowBlur = 9;
    ctx.fillRect(x - 8, y - 4, 16, 2);
    ctx.fillRect(x - 12, y - 2, 24, 4);
    ctx.fillRect(x - 8, y + 2, 4, 2);
    ctx.fillRect(x, y + 2, 4, 2);
    ctx.fillRect(x + 8, y + 2, 4, 2);
    ctx.fillStyle = '#ffe6fb';
    ctx.fillRect(x - 4, y - 6, 8, 2);
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D): void {
    if (this.deathTimer > 0) return;
    if (this.invulnerableTimer > 0 && Math.floor(this.invulnerableTimer * 11) % 2 === 0) return;
    const x = Math.round(this.playerX);
    ctx.save();
    ctx.fillStyle = '#8dfff4';
    ctx.shadowColor = '#63fff0';
    ctx.shadowBlur = 9;
    ctx.fillRect(x - 2, PLAYER_Y - 10, 4, 3);
    ctx.fillRect(x - 6, PLAYER_Y - 7, 12, 3);
    ctx.fillRect(x - 9, PLAYER_Y - 4, 18, 3);
    ctx.fillRect(x - 11, PLAYER_Y - 1, 22, 5);
    ctx.fillStyle = '#dffffc';
    ctx.fillRect(x - 1, PLAYER_Y - 9, 2, 7);
    ctx.restore();
  }

  private drawShots(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const shot of this.shots) {
      if (shot.hostile) {
        ctx.strokeStyle = '#ff965b';
        ctx.shadowColor = '#ff6b42';
        ctx.shadowBlur = 5;
        ctx.lineWidth = 2;
        const bend = Math.sin(shot.phase) * 2;
        ctx.beginPath();
        ctx.moveTo(Math.round(shot.x - bend), Math.round(shot.y - 4));
        ctx.lineTo(Math.round(shot.x + bend), Math.round(shot.y));
        ctx.lineTo(Math.round(shot.x - bend), Math.round(shot.y + 4));
        ctx.stroke();
      } else {
        ctx.fillStyle = '#fff7bd';
        ctx.shadowColor = '#fff39a';
        ctx.shadowBlur = 7;
        ctx.fillRect(Math.round(shot.x) - 1, Math.round(shot.y) - 4, 2, 8);
      }
    }
    ctx.restore();
  }

  private drawSparks(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.shadowBlur = 6;
    for (const spark of this.sparks) {
      ctx.globalAlpha = Math.max(0, spark.life / spark.maxLife);
      ctx.fillStyle = spark.color;
      ctx.shadowColor = spark.color;
      ctx.fillRect(Math.round(spark.x), Math.round(spark.y), spark.size, spark.size);
    }
    ctx.restore();
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    let line = '';
    let subline = '';
    if (this.readyTimer > 0) {
      line = this.level === 1 ? 'DEFEND THE SECTOR' : `WAVE ${this.level}`;
      subline = 'READY';
    } else if (this.waveTimer > 0) {
      line = 'SECTOR CLEAR';
      subline = `BONUS ${this.level * 100}`;
    } else if (this.deathTimer > 0 && this.lives > 0) {
      line = 'SHIP LOST';
    }
    if (!line) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#e8ffff';
    ctx.shadowColor = '#5dfff0';
    ctx.shadowBlur = 8;
    ctx.fillText(line, SCREEN_WIDTH / 2, 173);
    if (subline) {
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = '#7ffff1';
      ctx.fillText(subline, SCREEN_WIDTH / 2, 190);
    }
    ctx.restore();
  }
}

export default StarInvaders;
