import { BaseGame } from '../BaseGame';
import type { GameServices, InputFrame } from '../../types';

type DirectionName = 'up' | 'down' | 'left' | 'right';
type GhostState = 'normal' | 'frightened' | 'eyes';

interface Direction {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

interface Mover {
  col: number;
  row: number;
  direction: DirectionName | null;
  progress: number;
}

interface Ghost extends Mover {
  readonly kind: 0 | 1 | 2 | 3;
  state: GhostState;
  respawnTimer: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  readonly maxLife: number;
  readonly color: string;
  readonly size: number;
}

const TILE = 16;
const COLS = 19;
const ROWS = 15;
const BOARD_X = 40;
const BOARD_Y = 28;
const TUNNEL_ROW = 7;
const HOME_COL = 9;
const HOME_ROW = 7;

const DIRECTIONS: Record<DirectionName, Direction> = {
  up: { x: 0, y: -1, angle: -Math.PI / 2 },
  down: { x: 0, y: 1, angle: Math.PI / 2 },
  left: { x: -1, y: 0, angle: Math.PI },
  right: { x: 1, y: 0, angle: 0 },
};

const DIRECTION_NAMES: readonly DirectionName[] = ['up', 'left', 'down', 'right'];

const OPPOSITE: Record<DirectionName, DirectionName> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

// This maze and every sprite in this game are generated specifically for Retro Arcade.
const MAZE = [
  '###################',
  '#o.......#.......o#',
  '#.###.#.#.#.#.###.#',
  '#.....#.....#.....#',
  '###.#.###.###.#.###',
  '#...#....#....#...#',
  '#.#.###.....###.#.#',
  '....#...   ...#....',
  '#.#.###.....###.#.#',
  '#...#....#....#...#',
  '###.#.###.###.#.###',
  '#.....#.....#.....#',
  '#.###.#.#.#.#.###.#',
  '#o..#....#....#..o#',
  '###################',
] as const;

const GHOST_COLORS = ['#ff4f8b', '#32e7ff', '#ff9d2e', '#b970ff'] as const;

export class MazeChaser extends BaseGame {
  readonly id = 'maze-chaser' as const;
  readonly title = 'PAC-MAN';
  readonly controls = 'JOYSTICK TO MOVE';

  private player: Mover = { col: 9, row: 11, direction: 'left', progress: 0 };
  private ghosts: Ghost[] = [];
  private dots = new Set<string>();
  private powerDots = new Set<string>();
  private queuedDirection: DirectionName | null = null;
  private frightenedTimer = 0;
  private frightenedChain = 0;
  private readyTimer = 0;
  private dyingTimer = 0;
  private levelTimer = 0;
  private behaviorClock = 0;
  private time = 0;
  private mouthClock = 0;
  private rngState = 0x51a7c3;
  private particles: Particle[] = [];

  constructor(services: GameServices) {
    super(services);
  }

  start(): void {
    this.score = 0;
    this.level = 1;
    this.lives = 3;
    this.paused = false;
    this.ended = false;
    this.time = 0;
    this.behaviorClock = 0;
    this.rngState = 0x51a7c3;
    this.particles = [];
    this.loadLevel();
    this.readyTimer = 1.05;
  }

  update(deltaSeconds: number, input: InputFrame): void {
    if (this.paused || this.ended) return;

    const dt = Math.min(Math.max(deltaSeconds, 0), 0.05);
    this.time += dt;
    this.mouthClock += dt;
    this.updateParticles(dt);
    this.captureDirection(input);

    if (this.dyingTimer > 0) {
      this.dyingTimer -= dt;
      if (this.dyingTimer <= 0) {
        if (this.lives <= 0) {
          this.gameOver();
        } else {
          this.resetActors();
          this.readyTimer = 0.72;
        }
      }
      return;
    }

    if (this.levelTimer > 0) {
      this.levelTimer -= dt;
      if (this.levelTimer <= 0) {
        this.level += 1;
        this.loadLevel();
        this.readyTimer = 0.9;
      }
      return;
    }

    if (this.readyTimer > 0) {
      this.readyTimer -= dt;
      return;
    }

    this.behaviorClock += dt;
    if (this.frightenedTimer > 0) {
      this.frightenedTimer = Math.max(0, this.frightenedTimer - dt);
      if (this.frightenedTimer === 0) {
        for (const ghost of this.ghosts) {
          if (ghost.state === 'frightened') ghost.state = 'normal';
        }
      }
    }

    this.reversePlayerIfRequested();
    this.movePlayer(dt);
    if (this.levelTimer > 0) return;
    for (const ghost of this.ghosts) this.moveGhost(ghost, dt);
    this.checkGhostCollisions();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.drawBackdrop(ctx);
    this.drawMaze(ctx);
    this.drawPickups(ctx);
    this.drawActors(ctx);
    this.drawParticles(ctx);
    this.drawHud(ctx, this.level % 2 === 0 ? '#c891ff' : '#62f7ff');
    this.drawStatus(ctx);
    ctx.restore();
  }

  private loadLevel(): void {
    this.dots.clear();
    this.powerDots.clear();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const tile = MAZE[row][col];
        if (tile === '.') this.dots.add(this.key(col, row));
        if (tile === 'o') this.powerDots.add(this.key(col, row));
      }
    }
    // The starting pad is intentionally free of a pickup.
    this.dots.delete(this.key(9, 11));
    this.frightenedTimer = 0;
    this.frightenedChain = 0;
    this.levelTimer = 0;
    this.resetActors();
  }

  private resetActors(): void {
    this.player = { col: 9, row: 11, direction: 'left', progress: 0 };
    this.queuedDirection = null;
    this.dyingTimer = 0;
    this.ghosts = [
      { col: 8, row: 7, direction: 'left', progress: 0, kind: 0, state: 'normal', respawnTimer: 0 },
      { col: 9, row: 7, direction: 'up', progress: 0, kind: 1, state: 'normal', respawnTimer: 0 },
      { col: 10, row: 7, direction: 'right', progress: 0, kind: 2, state: 'normal', respawnTimer: 0 },
      { col: 9, row: 6, direction: 'down', progress: 0, kind: 3, state: 'normal', respawnTimer: 0 },
    ];
  }

  private captureDirection(input: InputFrame): void {
    let pressed: DirectionName | null = null;
    if (input.pressed('up')) pressed = 'up';
    if (input.pressed('down')) pressed = 'down';
    if (input.pressed('left')) pressed = 'left';
    if (input.pressed('right')) pressed = 'right';
    if (pressed) {
      this.queuedDirection = pressed;
      return;
    }

    // A held perpendicular direction remains buffered until the next junction.
    const current = this.player.direction;
    if (current === 'left' || current === 'right') {
      if (input.vertical < 0) this.queuedDirection = 'up';
      else if (input.vertical > 0) this.queuedDirection = 'down';
      else if (!current && input.horizontal !== 0) this.queuedDirection = input.horizontal < 0 ? 'left' : 'right';
    } else {
      if (input.horizontal < 0) this.queuedDirection = 'left';
      else if (input.horizontal > 0) this.queuedDirection = 'right';
      else if (!current && input.vertical !== 0) this.queuedDirection = input.vertical < 0 ? 'up' : 'down';
    }
  }

  private reversePlayerIfRequested(): void {
    const current = this.player.direction;
    const queued = this.queuedDirection;
    if (!current || !queued || OPPOSITE[current] !== queued || this.player.progress === 0) return;

    this.reverseMover(this.player);
    this.queuedDirection = null;
  }

  private movePlayer(dt: number): void {
    const speed = Math.min(7.15, 5.7 + (this.level - 1) * 0.11);
    let distance = speed * dt;

    if (this.player.progress === 0) this.choosePlayerDirection();
    while (distance > 0 && this.player.direction) {
      const step = Math.min(distance, 1 - this.player.progress);
      this.player.progress += step;
      distance -= step;
      if (this.player.progress >= 0.999999) {
        const direction = DIRECTIONS[this.player.direction];
        this.player.col = this.wrapCol(this.player.col + direction.x, this.player.row);
        this.player.row += direction.y;
        this.player.progress = 0;
        this.consumePickup(this.player.col, this.player.row);
        this.choosePlayerDirection();
      }
    }
  }

  private choosePlayerDirection(): void {
    if (this.queuedDirection && this.canMove(this.player.col, this.player.row, this.queuedDirection)) {
      this.player.direction = this.queuedDirection;
      this.queuedDirection = null;
    }
    if (this.player.direction && !this.canMove(this.player.col, this.player.row, this.player.direction)) {
      this.player.direction = null;
    }
  }

  private moveGhost(ghost: Ghost, dt: number): void {
    if (ghost.respawnTimer > 0) {
      ghost.respawnTimer -= dt;
      if (ghost.respawnTimer <= 0) {
        ghost.state = this.frightenedTimer > 0 ? 'frightened' : 'normal';
        ghost.direction = 'up';
      }
      return;
    }

    const levelBoost = Math.min(1.45, (this.level - 1) * 0.095);
    const speed = ghost.state === 'eyes'
      ? 8.5
      : ghost.state === 'frightened'
        ? 3.55 + levelBoost * 0.3
        : 4.55 + levelBoost + ghost.kind * 0.08;
    let distance = speed * dt;

    if (ghost.progress === 0) ghost.direction = this.chooseGhostDirection(ghost);
    while (distance > 0 && ghost.direction) {
      const step = Math.min(distance, 1 - ghost.progress);
      ghost.progress += step;
      distance -= step;
      if (ghost.progress >= 0.999999) {
        const direction = DIRECTIONS[ghost.direction];
        ghost.col = this.wrapCol(ghost.col + direction.x, ghost.row);
        ghost.row += direction.y;
        ghost.progress = 0;

        if (ghost.state === 'eyes' && ghost.col === HOME_COL && ghost.row === HOME_ROW) {
          ghost.direction = null;
          ghost.respawnTimer = 1.15;
          return;
        }
        ghost.direction = this.chooseGhostDirection(ghost);
      }
    }
  }

  private chooseGhostDirection(ghost: Ghost): DirectionName | null {
    let choices = DIRECTION_NAMES.filter((direction) => this.canMove(ghost.col, ghost.row, direction));
    if (choices.length > 1 && ghost.direction) {
      const reverse = OPPOSITE[ghost.direction];
      choices = choices.filter((direction) => direction !== reverse);
    }
    if (choices.length === 0) return ghost.direction ? OPPOSITE[ghost.direction] : null;
    if (choices.length === 1) return choices[0];

    if (ghost.state === 'frightened') {
      const playerTile = this.playerTile();
      return this.pickBest(ghost, choices, playerTile, false, true);
    }

    if (ghost.state === 'eyes') {
      return this.pickBest(ghost, choices, { col: HOME_COL, row: HOME_ROW }, true, false);
    }

    if (ghost.kind === 2) {
      // The drifter is deliberately capricious, but slightly prefers going straight.
      if (ghost.direction && choices.includes(ghost.direction) && this.random() < 0.42) return ghost.direction;
      return choices[Math.floor(this.random() * choices.length)];
    }

    const playerTile = this.playerTile();
    let target = playerTile;
    if (ghost.kind === 1) {
      const facing = this.player.direction ? DIRECTIONS[this.player.direction] : DIRECTIONS.left;
      target = this.nearestOpen(playerTile.col + facing.x * 4, playerTile.row + facing.y * 4);
    } else if (ghost.kind === 3) {
      const hunting = this.behaviorClock % 13 < 7.5;
      if (!hunting) {
        const leftCorner = { col: 1, row: 13 };
        const rightCorner = { col: 17, row: 13 };
        const leftDistance = this.manhattan(playerTile, leftCorner);
        const rightDistance = this.manhattan(playerTile, rightCorner);
        target = leftDistance > rightDistance ? leftCorner : rightCorner;
      }
    }
    return this.pickBest(ghost, choices, target, true, false);
  }

  private pickBest(
    ghost: Ghost,
    choices: DirectionName[],
    target: { col: number; row: number },
    minimize: boolean,
    jitter: boolean,
  ): DirectionName {
    let best = choices[0];
    let bestValue = minimize ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    for (const choice of choices) {
      const vector = DIRECTIONS[choice];
      const col = this.wrapCol(ghost.col + vector.x, ghost.row);
      const row = ghost.row + vector.y;
      const path = this.pathDistance(col, row, target.col, target.row);
      const value = path + (jitter ? this.random() * 2.5 : this.random() * 0.04);
      if ((minimize && value < bestValue) || (!minimize && value > bestValue)) {
        best = choice;
        bestValue = value;
      }
    }
    return best;
  }

  private consumePickup(col: number, row: number): void {
    const key = this.key(col, row);
    if (this.dots.delete(key)) {
      this.score += 10 * this.level;
      this.services.sound('move');
      this.spawnBurst(col, row, '#b8ffff', 3, 17);
    } else if (this.powerDots.delete(key)) {
      this.score += 60 * this.level;
      this.frightenedTimer = Math.max(3.5, 7.2 - (this.level - 1) * 0.42);
      this.frightenedChain = 0;
      for (const ghost of this.ghosts) {
        if (ghost.state !== 'eyes') {
          ghost.state = 'frightened';
          if (ghost.direction && ghost.progress === 0) ghost.direction = OPPOSITE[ghost.direction];
        }
      }
      this.services.sound('powerup');
      this.services.flash('#8b7dff', 0.36);
      this.spawnBurst(col, row, '#ffffff', 15, 46);
    }

    if (this.dots.size === 0 && this.powerDots.size === 0 && this.levelTimer === 0) {
      this.score += this.level * 500;
      this.levelTimer = 1.35;
      this.services.sound('level');
      this.services.flash('#72fff1', 0.48);
      this.spawnBurst(this.player.col, this.player.row, '#72fff1', 32, 75);
    }
  }

  private checkGhostCollisions(): void {
    if (this.dyingTimer > 0) return;
    const playerPosition = this.moverPosition(this.player);
    for (const ghost of this.ghosts) {
      if (ghost.state === 'eyes' || ghost.respawnTimer > 0) continue;
      const ghostPosition = this.moverPosition(ghost);
      let dx = Math.abs(playerPosition.x - ghostPosition.x);
      if (this.player.row === TUNNEL_ROW && ghost.row === TUNNEL_ROW) dx = Math.min(dx, COLS - dx);
      const dy = playerPosition.y - ghostPosition.y;
      if (dx * dx + dy * dy > 0.43) continue;

      if (ghost.state === 'frightened') {
        const bonus = 200 * (2 ** Math.min(this.frightenedChain, 3)) * this.level;
        this.frightenedChain += 1;
        this.score += bonus;
        ghost.state = 'eyes';
        this.reverseMover(ghost);
        this.services.sound('hit');
        this.services.flash('#f4eeff', 0.26);
        this.spawnBurst(ghost.col, ghost.row, '#f4eeff', 18, 65);
      } else {
        this.lives -= 1;
        this.dyingTimer = 1.18;
        this.services.sound('death');
        this.services.flash('#ff315f', 0.72);
        this.spawnBurst(this.player.col, this.player.row, '#ffcf4a', 30, 82);
        return;
      }
    }
  }

  private playerTile(): { col: number; row: number } {
    if (!this.player.direction || this.player.progress < 0.5) {
      return { col: this.player.col, row: this.player.row };
    }
    const vector = DIRECTIONS[this.player.direction];
    return {
      col: this.wrapCol(this.player.col + vector.x, this.player.row),
      row: this.player.row + vector.y,
    };
  }

  private moverPosition(mover: Mover): { x: number; y: number } {
    const vector = mover.direction ? DIRECTIONS[mover.direction] : { x: 0, y: 0 };
    return {
      x: mover.col + vector.x * mover.progress,
      y: mover.row + vector.y * mover.progress,
    };
  }

  /** Reverse a mover without changing its interpolated on-screen position. */
  private reverseMover(mover: Mover): void {
    if (!mover.direction) return;
    const oldDirection = mover.direction;
    if (mover.progress > 0) {
      const vector = DIRECTIONS[oldDirection];
      mover.col = this.wrapCol(mover.col + vector.x, mover.row);
      mover.row += vector.y;
      mover.progress = 1 - mover.progress;
    }
    mover.direction = OPPOSITE[oldDirection];
  }

  private canMove(col: number, row: number, direction: DirectionName): boolean {
    const vector = DIRECTIONS[direction];
    return this.tileAt(col + vector.x, row + vector.y) !== '#';
  }

  private tileAt(col: number, row: number): string {
    if (row === TUNNEL_ROW && (col < 0 || col >= COLS)) return ' ';
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return '#';
    return MAZE[row][col];
  }

  private wrapCol(col: number, row: number): number {
    if (row !== TUNNEL_ROW) return col;
    return (col + COLS) % COLS;
  }

  private nearestOpen(targetCol: number, targetRow: number): { col: number; row: number } {
    const clampedCol = Math.max(0, Math.min(COLS - 1, targetCol));
    const clampedRow = Math.max(0, Math.min(ROWS - 1, targetRow));
    if (this.tileAt(clampedCol, clampedRow) !== '#') return { col: clampedCol, row: clampedRow };
    for (let radius = 1; radius < Math.max(COLS, ROWS); radius += 1) {
      for (let y = -radius; y <= radius; y += 1) {
        const x = radius - Math.abs(y);
        for (const sign of x === 0 ? [0] : [-1, 1]) {
          const col = clampedCol + x * sign;
          const row = clampedRow + y;
          if (this.tileAt(col, row) !== '#') return { col, row };
        }
      }
    }
    return { col: HOME_COL, row: HOME_ROW };
  }

  private pathDistance(startCol: number, startRow: number, targetCol: number, targetRow: number): number {
    const target = this.nearestOpen(targetCol, targetRow);
    if (startCol === target.col && startRow === target.row) return 0;
    const queue: Array<{ col: number; row: number; distance: number }> = [
      { col: startCol, row: startRow, distance: 0 },
    ];
    const visited = new Set<string>([this.key(startCol, startRow)]);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const direction of DIRECTION_NAMES) {
        const vector = DIRECTIONS[direction];
        const col = this.wrapCol(current.col + vector.x, current.row);
        const row = current.row + vector.y;
        if (this.tileAt(col, row) === '#') continue;
        if (col === target.col && row === target.row) return current.distance + 1;
        const key = this.key(col, row);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ col, row, distance: current.distance + 1 });
      }
    }
    return 999;
  }

  private manhattan(a: { col: number; row: number }, b: { col: number; row: number }): number {
    return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
  }

  private key(col: number, row: number): string {
    return `${col},${row}`;
  }

  private random(): number {
    this.rngState = (Math.imul(this.rngState, 1664525) + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private spawnBurst(col: number, row: number, color: string, count: number, speed: number): void {
    const x = BOARD_X + (col + 0.5) * TILE;
    const y = BOARD_Y + (row + 0.5) * TILE;
    for (let i = 0; i < count; i += 1) {
      const angle = this.random() * Math.PI * 2;
      const velocity = speed * (0.35 + this.random() * 0.65);
      const life = 0.25 + this.random() * 0.42;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        color,
        size: 1 + Math.floor(this.random() * 2),
      });
    }
    if (this.particles.length > 180) this.particles.splice(0, this.particles.length - 180);
  }

  private updateParticles(dt: number): void {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.06, dt);
      particle.vy *= Math.pow(0.06, dt);
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, 288);
    gradient.addColorStop(0, '#02020b');
    gradient.addColorStop(0.5, '#05041a');
    gradient.addColorStop(1, '#010107');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 384, 288);

    ctx.fillStyle = 'rgba(84, 124, 255, 0.09)';
    for (let i = 0; i < 43; i += 1) {
      const x = (i * 83 + 17) % 384;
      const y = (i * i * 19 + 31) % 288;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  private drawMaze(ctx: CanvasRenderingContext2D): void {
    const hue = this.level % 3;
    const edge = hue === 0 ? '#4e7dff' : hue === 1 ? '#8e57ff' : '#1ecbd2';
    const inner = hue === 0 ? '#172159' : hue === 1 ? '#29184e' : '#103c4a';

    ctx.save();
    ctx.shadowColor = edge;
    ctx.shadowBlur = 5;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = edge;
    ctx.fillStyle = inner;

    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        if (MAZE[row][col] !== '#') continue;
        const x = BOARD_X + col * TILE;
        const y = BOARD_Y + row * TILE;
        ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
        ctx.beginPath();
        if (this.tileAt(col, row - 1) !== '#') {
          ctx.moveTo(x + 2, y + 2);
          ctx.lineTo(x + TILE - 2, y + 2);
        }
        if (this.tileAt(col, row + 1) !== '#') {
          ctx.moveTo(x + 2, y + TILE - 2);
          ctx.lineTo(x + TILE - 2, y + TILE - 2);
        }
        if (this.tileAt(col - 1, row) !== '#') {
          ctx.moveTo(x + 2, y + 2);
          ctx.lineTo(x + 2, y + TILE - 2);
        }
        if (this.tileAt(col + 1, row) !== '#') {
          ctx.moveTo(x + TILE - 2, y + 2);
          ctx.lineTo(x + TILE - 2, y + TILE - 2);
        }
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(92, 174, 255, 0.065)';
    ctx.lineWidth = 0.5;
    for (let col = 0; col <= COLS; col += 1) {
      ctx.beginPath();
      ctx.moveTo(BOARD_X + col * TILE, BOARD_Y);
      ctx.lineTo(BOARD_X + col * TILE, BOARD_Y + ROWS * TILE);
      ctx.stroke();
    }
    for (let row = 0; row <= ROWS; row += 1) {
      ctx.beginPath();
      ctx.moveTo(BOARD_X, BOARD_Y + row * TILE);
      ctx.lineTo(BOARD_X + COLS * TILE, BOARD_Y + row * TILE);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPickups(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = '#d8ffff';
    ctx.shadowColor = '#61f7ff';
    ctx.shadowBlur = 5;
    for (const key of this.dots) {
      const [col, row] = key.split(',').map(Number);
      const x = BOARD_X + (col + 0.5) * TILE;
      const y = BOARD_Y + (row + 0.5) * TILE;
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    }

    const pulse = 3.6 + Math.sin(this.time * 7) * 1.15;
    ctx.fillStyle = '#fff3a8';
    ctx.shadowColor = '#ffb52f';
    ctx.shadowBlur = 10;
    for (const key of this.powerDots) {
      const [col, row] = key.split(',').map(Number);
      const x = BOARD_X + (col + 0.5) * TILE;
      const y = BOARD_Y + (row + 0.5) * TILE;
      ctx.beginPath();
      ctx.arc(x, y, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawActors(ctx: CanvasRenderingContext2D): void {
    for (const ghost of this.ghosts) {
      if (ghost.respawnTimer > 0 && Math.floor(ghost.respawnTimer * 10) % 2 === 0) continue;
      this.drawWrappedMover(ctx, ghost, (x, y) => this.drawGhost(ctx, ghost, x, y));
    }

    if (this.dyingTimer <= 0 || Math.floor(this.dyingTimer * 16) % 2 === 0) {
      this.drawWrappedMover(ctx, this.player, (x, y) => this.drawPlayer(ctx, x, y));
    }
  }

  private drawWrappedMover(
    ctx: CanvasRenderingContext2D,
    mover: Mover,
    draw: (x: number, y: number) => void,
  ): void {
    const position = this.moverPosition(mover);
    const x = BOARD_X + (position.x + 0.5) * TILE;
    const y = BOARD_Y + (position.y + 0.5) * TILE;
    draw(x, y);
    if (position.y > TUNNEL_ROW - 0.6 && position.y < TUNNEL_ROW + 0.6) {
      if (position.x < 0.6) draw(x + COLS * TILE, y);
      if (position.x > COLS - 1.6) draw(x - COLS * TILE, y);
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const direction = this.player.direction ? DIRECTIONS[this.player.direction] : DIRECTIONS.left;
    const bite = 1.4 + Math.abs(Math.sin(this.mouthClock * 11)) * 2.1;
    const deathScale = this.dyingTimer > 0 ? Math.max(0.1, this.dyingTimer / 1.18) : 1;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(direction.angle);
    ctx.scale(deathScale, deathScale);
    ctx.shadowColor = '#ffba24';
    ctx.shadowBlur = 9;

    const body = ctx.createLinearGradient(-7, -6, 7, 6);
    body.addColorStop(0, '#fff779');
    body.addColorStop(0.55, '#ffc52e');
    body.addColorStop(1, '#ff6d2e');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(3, bite);
    ctx.lineTo(-2, 7);
    ctx.lineTo(-7, 4);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-7, -4);
    ctx.lineTo(-2, -7);
    ctx.lineTo(3, -bite);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3b1737';
    ctx.fillRect(-2, -4, 2, 2);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-2, -4, 1, 1);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillRect(-5, -2, 2, 1);
    ctx.restore();
  }

  private drawGhost(ctx: CanvasRenderingContext2D, ghost: Ghost, x: number, y: number): void {
    let color: string = GHOST_COLORS[ghost.kind];
    if (ghost.state === 'frightened') {
      const blinking = this.frightenedTimer < 1.8 && Math.floor(this.time * 8) % 2 === 0;
      color = blinking ? '#f2efff' : '#4057ff';
    }

    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    const hover = Math.sin(this.time * 8 + ghost.kind * 1.7) * 0.8;
    ctx.translate(0, hover);
    ctx.shadowColor = ghost.state === 'eyes' ? '#efffff' : color;
    ctx.shadowBlur = ghost.state === 'eyes' ? 5 : 9;

    if (ghost.state !== 'eyes') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, -5);
      ctx.lineTo(8, 1);
      ctx.lineTo(5, 7);
      ctx.lineTo(0, 5);
      ctx.lineTo(-5, 7);
      ctx.lineTo(-8, 1);
      ctx.lineTo(-6, -5);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(255,255,255,.72)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(0, -7);
      ctx.lineTo(4, -4);
      ctx.stroke();
    }

    ctx.shadowBlur = 2;
    ctx.fillStyle = ghost.state === 'frightened' ? '#b9c4ff' : '#f5ffff';
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 4);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();

    const facing = ghost.direction ? DIRECTIONS[ghost.direction] : { x: 0, y: 0 };
    ctx.fillStyle = ghost.state === 'frightened' ? '#101848' : color;
    ctx.fillRect(Math.round(facing.x * 1.5) - 1, Math.round(facing.y * 1.5) - 1, 3, 3);

    if (ghost.state !== 'eyes') {
      ctx.strokeStyle = '#17102b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (ghost.kind === 0) {
        ctx.moveTo(-3, 3); ctx.lineTo(3, 3);
      } else if (ghost.kind === 1) {
        ctx.moveTo(-3, 3); ctx.lineTo(0, 5); ctx.lineTo(3, 3);
      } else if (ghost.kind === 2) {
        ctx.moveTo(-3, 3); ctx.lineTo(-2, 4);
        ctx.moveTo(2, 4); ctx.lineTo(3, 3);
      } else {
        ctx.moveTo(-3, 4); ctx.lineTo(3, 4);
        ctx.moveTo(0, 2); ctx.lineTo(0, 6);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const particle of this.particles) {
      const alpha = Math.max(0, particle.life / particle.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 4;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
    }
    ctx.restore();
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    if (this.frightenedTimer > 0 && this.readyTimer <= 0) {
      const width = Math.min(72, this.frightenedTimer * 10);
      ctx.save();
      ctx.fillStyle = 'rgba(12, 9, 42, .9)';
      ctx.fillRect(156, 19, 72, 4);
      ctx.fillStyle = this.frightenedTimer < 1.8 ? '#fff4ff' : '#6578ff';
      ctx.shadowColor = '#6d77ff';
      ctx.shadowBlur = 5;
      ctx.fillRect(156, 19, width, 4);
      ctx.restore();
    }

    let heading = '';
    let subheading = '';
    if (this.readyTimer > 0) {
      heading = this.level === 1 && this.time < 0.85 ? 'PAC-MAN' : `LEVEL ${String(this.level).padStart(2, '0')}`;
      subheading = 'READY';
    } else if (this.levelTimer > 0) {
      heading = 'GRID CLEARED';
      subheading = `BONUS ${this.level * 500}`;
    } else if (this.dyingTimer > 0) {
      heading = this.lives > 0 ? 'SIGNAL LOST' : 'FINAL SIGNAL';
      subheading = this.lives > 0 ? `${this.lives} LIFE${this.lives === 1 ? '' : 'S'} LEFT` : '';
    }
    if (!heading) return;

    ctx.save();
    ctx.fillStyle = 'rgba(1, 2, 12, .82)';
    ctx.fillRect(112, 122, 160, 46);
    ctx.strokeStyle = '#71f8ff';
    ctx.shadowColor = '#44efff';
    ctx.shadowBlur = 8;
    ctx.strokeRect(113.5, 123.5, 157, 43);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#fff0a6';
    ctx.fillText(heading, 192, 139);
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#70f8ff';
    ctx.fillText(subheading, 192, 155);
    ctx.restore();
  }
}
