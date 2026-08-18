import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../types';
import type { GameServices, InputFrame } from '../../types';
import { BaseGame } from '../BaseGame';

type PieceType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';
type Cell = PieceType | null;
type Point = readonly [number, number];

interface Piece {
  type: PieceType;
  rotation: number;
  x: number;
  y: number;
}

interface Fragment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;
const CELL_SIZE = 12;
const BOARD_X = 132;
const BOARD_Y = 40;
const TYPES: PieceType[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

const COLORS: Record<PieceType, string> = {
  I: '#4fe5ff',
  J: '#627cff',
  L: '#ff9b45',
  O: '#ffe45e',
  S: '#62ef7d',
  T: '#c970ff',
  Z: '#ff5b79',
};

const SHAPES: Record<PieceType, readonly (readonly Point[])[]> = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
};

const NORMAL_KICKS: readonly Point[] = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [-1, -1], [1, -1], [0, -2],
];

const I_KICKS: readonly Point[] = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [-3, 0], [3, 0], [0, -1], [-1, -1], [1, -1], [0, -2],
];

/** Seven-piece falling-block puzzle with bag randomization, hold, previews and wall kicks. */
export class FallingBlocks extends BaseGame {
  readonly id = 'falling-blocks' as const;
  readonly title = 'TETRIS';
  readonly controls = 'A/UP: ROTATE  B: REVERSE  C: DROP  START: HOLD';

  private board: Cell[][] = this.emptyBoard();
  private active: Piece | null = null;
  private held: PieceType | null = null;
  private holdUsed = false;
  private bag: PieceType[] = [];
  private nextQueue: PieceType[] = [];
  private totalLines = 0;
  private combo = -1;
  private fallAccumulator = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private horizontalDirection = 0;
  private horizontalHold = 0;
  private horizontalRepeat = 0;
  private softDropping = false;
  private clearingRows: number[] = [];
  private clearTimer = 0;
  private readyTimer = 0;
  private visualTime = 0;
  private shakeTimer = 0;
  private fragments: Fragment[] = [];
  private lastClear = 0;

  constructor(services: GameServices) {
    super(services);
  }

  start(): void {
    this.score = 0;
    this.level = 1;
    this.lives = 1;
    this.paused = false;
    this.ended = false;
    this.board = this.emptyBoard();
    this.active = null;
    this.held = null;
    this.holdUsed = false;
    this.bag = [];
    this.nextQueue = [];
    this.totalLines = 0;
    this.combo = -1;
    this.fallAccumulator = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.horizontalDirection = 0;
    this.horizontalHold = 0;
    this.horizontalRepeat = 0;
    this.softDropping = false;
    this.clearingRows = [];
    this.clearTimer = 0;
    this.readyTimer = 0.85;
    this.visualTime = 0;
    this.shakeTimer = 0;
    this.fragments = [];
    this.lastClear = 0;
    this.fillNextQueue();
    this.spawnNext();
  }

  update(deltaSeconds: number, input: InputFrame): void {
    if (this.paused || this.ended) return;
    const dt = Math.min(0.08, Math.max(0, deltaSeconds));
    this.visualTime += dt;
    this.updateFragments(dt);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);

    if (this.readyTimer > 0) {
      this.readyTimer -= dt;
      return;
    }

    if (this.clearTimer > 0) {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this.finishLineClear();
      return;
    }

    if (!this.active) return;

    const wantsHold = input.pressed('start') || (input.down('buttonA') && input.pressed('buttonB'));
    if (wantsHold) this.performHold();
    if (!this.active) return;

    this.handleHorizontalInput(dt, input);

    if (!wantsHold) {
      if (input.pressed('up') || input.pressed('buttonA')) this.tryRotate(1);
      else if (input.pressed('buttonB')) this.tryRotate(-1);
    }

    if (input.pressed('buttonC')) {
      this.hardDrop();
      return;
    }

    const isSoftDropping = input.down('down');
    if (isSoftDropping && !this.softDropping) this.fallAccumulator = Math.min(this.fallAccumulator, 0.035);
    this.softDropping = isSoftDropping;
    const interval = isSoftDropping ? 0.035 : this.gravityInterval();
    this.fallAccumulator += dt;
    let steps = 0;
    while (this.fallAccumulator >= interval && steps < 7 && this.active) {
      this.fallAccumulator -= interval;
      if (this.tryMove(0, 1, false)) {
        if (isSoftDropping) this.score += 1;
        this.lockTimer = 0;
      } else {
        this.fallAccumulator = 0;
        break;
      }
      steps += 1;
    }

    if (!this.active) return;
    if (this.isGrounded(this.active)) {
      this.lockTimer += dt;
      const lockDelay = Math.max(0.23, 0.48 - (this.level - 1) * 0.012);
      if (this.lockTimer >= lockDelay) this.lockPiece();
    } else {
      this.lockTimer = 0;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this.drawBackdrop(ctx);
    this.drawHeader(ctx);
    this.drawSidePanels(ctx);

    ctx.save();
    if (this.shakeTimer > 0) {
      const amount = Math.min(3, this.shakeTimer * 14);
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
    }
    this.drawBoard(ctx);
    this.drawGhost(ctx);
    this.drawActive(ctx);
    this.drawFragments(ctx);
    ctx.restore();

    this.drawStatus(ctx);
    ctx.restore();
  }

  private emptyBoard(): Cell[][] {
    return Array.from({ length: BOARD_HEIGHT }, () => Array<Cell>(BOARD_WIDTH).fill(null));
  }

  private emptyRow(): Cell[] {
    return Array<Cell>(BOARD_WIDTH).fill(null);
  }

  private fillNextQueue(): void {
    while (this.nextQueue.length < 5) this.nextQueue.push(this.takeFromBag());
  }

  private takeFromBag(): PieceType {
    if (this.bag.length === 0) {
      this.bag = [...TYPES];
      for (let index = this.bag.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [this.bag[index], this.bag[swap]] = [this.bag[swap], this.bag[index]];
      }
    }
    return this.bag.pop()!;
  }

  private spawnNext(): void {
    this.fillNextQueue();
    const type = this.nextQueue.shift()!;
    this.fillNextQueue();
    this.spawnType(type, true);
  }

  private spawnType(type: PieceType, resetHold: boolean): void {
    const piece: Piece = { type, rotation: 0, x: 3, y: -1 };
    if (resetHold) this.holdUsed = false;
    this.active = piece;
    this.fallAccumulator = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.softDropping = false;
    if (this.collides(piece)) this.topOut();
  }

  private performHold(): void {
    if (!this.active || this.holdUsed) return;
    const current = this.active.type;
    const previous = this.held;
    this.held = current;
    this.active = null;
    this.holdUsed = true;
    this.services.sound('button');
    if (previous) this.spawnType(previous, false);
    else this.spawnNext();
    this.holdUsed = true;
  }

  private handleHorizontalInput(dt: number, input: InputFrame): void {
    const axis = input.horizontal || (input.down('left') ? -1 : input.down('right') ? 1 : 0);
    const direction = axis === 0 ? 0 : axis < 0 ? -1 : 1;
    if (direction !== this.horizontalDirection) {
      this.horizontalDirection = direction;
      this.horizontalHold = 0;
      this.horizontalRepeat = 0;
      if (direction !== 0) this.tryMove(direction, 0, true);
      return;
    }
    if (direction === 0) return;

    this.horizontalHold += dt;
    if (this.horizontalHold < 0.145) return;
    this.horizontalRepeat += dt;
    while (this.horizontalRepeat >= 0.045) {
      this.horizontalRepeat -= 0.045;
      if (!this.tryMove(direction, 0, true)) break;
    }
  }

  private tryMove(dx: number, dy: number, playerAction: boolean): boolean {
    if (!this.active) return false;
    const moved: Piece = { ...this.active, x: this.active.x + dx, y: this.active.y + dy };
    if (this.collides(moved)) return false;
    this.active = moved;
    if (playerAction) {
      this.resetLockAfterAction();
      this.services.sound('move');
    }
    return true;
  }

  private tryRotate(direction: 1 | -1): void {
    if (!this.active) return;
    if (this.active.type === 'O') {
      this.services.sound('move');
      return;
    }
    const rotation = (this.active.rotation + direction + 4) % 4;
    const kicks = this.active.type === 'I' ? I_KICKS : NORMAL_KICKS;
    for (const [kickX, kickY] of kicks) {
      const rotated: Piece = {
        ...this.active,
        rotation,
        x: this.active.x + kickX,
        y: this.active.y + kickY,
      };
      if (this.collides(rotated)) continue;
      this.active = rotated;
      this.resetLockAfterAction();
      this.services.sound('move');
      return;
    }
    this.services.sound('button');
  }

  private resetLockAfterAction(): void {
    if (!this.active || !this.isGrounded(this.active) || this.lockResets >= 15) return;
    this.lockTimer = 0;
    this.lockResets += 1;
  }

  private hardDrop(): void {
    if (!this.active) return;
    let distance = 0;
    while (this.tryMove(0, 1, false)) distance += 1;
    this.score += distance * 2;
    this.services.sound('hit');
    this.shakeTimer = Math.max(this.shakeTimer, 0.14);
    this.lockPiece();
  }

  private lockPiece(): void {
    if (!this.active) return;
    let aboveBoard = false;
    for (const [localX, localY] of SHAPES[this.active.type][this.active.rotation]) {
      const x = this.active.x + localX;
      const y = this.active.y + localY;
      if (y < 0) {
        aboveBoard = true;
      } else if (y < BOARD_HEIGHT && x >= 0 && x < BOARD_WIDTH) {
        this.board[y][x] = this.active.type;
      }
    }
    this.active = null;
    if (aboveBoard) {
      this.topOut();
      return;
    }

    const fullRows: number[] = [];
    for (let row = 0; row < BOARD_HEIGHT; row += 1) {
      if (this.board[row].every((cell) => cell !== null)) fullRows.push(row);
    }
    if (fullRows.length > 0) {
      this.clearingRows = fullRows;
      this.clearTimer = 0.3;
      this.lastClear = fullRows.length;
      this.services.sound('line');
      this.services.flash(fullRows.length === 4 ? '#fff4a1' : '#b8ffff', fullRows.length === 4 ? 0.72 : 0.35);
      this.shakeTimer = fullRows.length === 4 ? 0.48 : 0.14 + fullRows.length * 0.05;
    } else {
      this.combo = -1;
      this.lastClear = 0;
      this.spawnNext();
    }
  }

  private finishLineClear(): void {
    const rows = new Set(this.clearingRows);
    for (const row of this.clearingRows) {
      for (let column = 0; column < BOARD_WIDTH; column += 1) {
        const type = this.board[row][column];
        if (type) this.spawnFragments(column, row, COLORS[type], 3);
      }
    }
    this.board = this.board.filter((_, row) => !rows.has(row));
    while (this.board.length < BOARD_HEIGHT) this.board.unshift(this.emptyRow());

    const count = this.clearingRows.length;
    this.combo += 1;
    const baseScores = [0, 100, 300, 500, 800];
    const comboBonus = this.combo > 0 ? this.combo * 50 * this.level : 0;
    this.score += baseScores[count] * this.level + comboBonus;
    this.totalLines += count;
    const previousLevel = this.level;
    this.level = 1 + Math.floor(this.totalLines / 10);
    if (this.level > previousLevel) {
      this.score += this.level * 250;
      this.services.sound('level');
      this.services.flash('#7dfff0', 0.42);
    }
    if (this.board.every((row) => row.every((cell) => cell === null))) {
      this.score += 2000 * this.level;
      this.services.sound('powerup');
      this.services.flash('#ffffff', 0.78);
    }

    this.clearingRows = [];
    this.clearTimer = 0;
    this.spawnNext();
  }

  private topOut(): void {
    this.lives = 0;
    this.active = null;
    this.services.sound('death');
    this.services.flash('#ff426d', 0.65);
    this.shakeTimer = 0.55;
    this.gameOver();
  }

  private collides(piece: Piece): boolean {
    for (const [localX, localY] of SHAPES[piece.type][piece.rotation]) {
      const x = piece.x + localX;
      const y = piece.y + localY;
      if (x < 0 || x >= BOARD_WIDTH || y >= BOARD_HEIGHT) return true;
      if (y >= 0 && this.board[y][x] !== null) return true;
    }
    return false;
  }

  private isGrounded(piece: Piece): boolean {
    return this.collides({ ...piece, y: piece.y + 1 });
  }

  private ghostY(): number {
    if (!this.active) return 0;
    let y = this.active.y;
    while (!this.collides({ ...this.active, y: y + 1 })) y += 1;
    return y;
  }

  private gravityInterval(): number {
    return Math.max(0.052, 0.78 * Math.pow(0.82, this.level - 1));
  }

  private updateFragments(dt: number): void {
    for (let index = this.fragments.length - 1; index >= 0; index -= 1) {
      const fragment = this.fragments[index];
      fragment.life -= dt;
      if (fragment.life <= 0) {
        this.fragments.splice(index, 1);
        continue;
      }
      fragment.x += fragment.vx * dt;
      fragment.y += fragment.vy * dt;
      fragment.vy += 115 * dt;
      fragment.vx *= Math.pow(0.1, dt);
    }
  }

  private spawnFragments(column: number, row: number, color: string, count: number): void {
    const x = BOARD_X + column * CELL_SIZE + CELL_SIZE / 2;
    const y = BOARD_Y + row * CELL_SIZE + CELL_SIZE / 2;
    for (let index = 0; index < count; index += 1) {
      const life = 0.3 + Math.random() * 0.45;
      this.fragments.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 130,
        vy: -30 - Math.random() * 100,
        life,
        maxLife: life,
        color,
      });
    }
    if (this.fragments.length > 240) this.fragments.splice(0, this.fragments.length - 240);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D): void {
    const background = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
    background.addColorStop(0, '#090520');
    background.addColorStop(0.55, '#04091a');
    background.addColorStop(1, '#02040c');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    ctx.fillStyle = 'rgba(92, 134, 255, 0.045)';
    for (let y = 2; y < SCREEN_HEIGHT; y += 4) ctx.fillRect(0, y, SCREEN_WIDTH, 1);
    const glow = ctx.createRadialGradient(SCREEN_WIDTH / 2, 160, 10, SCREEN_WIDTH / 2, 160, 200);
    glow.addColorStop(0, 'rgba(76, 237, 255, 0.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  private drawHeader(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#7ff8ff';
    ctx.shadowColor = '#58edff';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('FALLING', 8, 6);
    ctx.fillStyle = '#d774ff';
    ctx.shadowColor = '#c45cff';
    ctx.fillText('BLOCKS', 8, 17);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9ffff';
    ctx.shadowColor = '#72f8ff';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`SCORE ${String(this.score).padStart(7, '0')}`, SCREEN_WIDTH / 2, 6);
    ctx.fillStyle = '#86a7b9';
    ctx.shadowBlur = 0;
    ctx.font = '7px monospace';
    ctx.fillText(`HI ${String(Math.max(this.score, this.services.highScore())).padStart(7, '0')}`, SCREEN_WIDTH / 2, 18);

    ctx.textAlign = 'right';
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#a7ff8a';
    ctx.shadowColor = '#8aff74';
    ctx.shadowBlur = 5;
    ctx.fillText(`LV ${String(this.level).padStart(2, '0')}`, SCREEN_WIDTH - 8, 6);
    ctx.fillStyle = '#ffe37b';
    ctx.shadowColor = '#ffd65a';
    ctx.fillText(`LINES ${String(this.totalLines).padStart(3, '0')}`, SCREEN_WIDTH - 8, 18);
    ctx.restore();
  }

  private drawSidePanels(ctx: CanvasRenderingContext2D): void {
    this.drawPanel(ctx, 13, 48, 101, 64, 'HOLD');
    if (this.held) this.drawMiniPiece(ctx, this.held, 63.5, 82, 8);

    this.drawPanel(ctx, 270, 48, 101, 121, 'NEXT');
    for (let index = 0; index < 3; index += 1) {
      const type = this.nextQueue[index];
      if (type) this.drawMiniPiece(ctx, type, 320.5, 76 + index * 34, 7);
    }

    this.drawPanel(ctx, 13, 124, 101, 87, 'STATUS');
    ctx.save();
    ctx.textBaseline = 'top';
    ctx.font = 'bold 8px monospace';
    ctx.fillStyle = '#a4bfd0';
    ctx.fillText('COMBO', 23, 148);
    ctx.textAlign = 'right';
    ctx.fillStyle = this.combo > 0 ? '#ffe36b' : '#567083';
    ctx.fillText(this.combo > 0 ? `x${this.combo + 1}` : '--', 104, 148);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a4bfd0';
    ctx.fillText('SPEED', 23, 165);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#72f7dc';
    ctx.fillText(`${Math.round(1 / this.gravityInterval() * 10) / 10}/s`, 104, 165);
    ctx.textAlign = 'center';
    ctx.font = '7px monospace';
    ctx.fillStyle = '#657e91';
    ctx.fillText('ENTER = HOLD', 63, 190);
    ctx.fillText('C = HARD DROP', 63, 200);
    ctx.restore();

    this.drawPanel(ctx, 270, 181, 101, 64, 'CLEAR');
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = this.lastClear > 0 ? '#fff1a0' : '#566a7a';
    const names = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];
    ctx.fillText(names[this.lastClear] || 'READY', 320, 216);
    ctx.restore();
  }

  private drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, title: string): void {
    ctx.save();
    ctx.fillStyle = 'rgba(2, 10, 24, 0.78)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(105, 231, 255, 0.33)';
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.fillStyle = '#71eaff';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(title, x + 7, y + 6);
    ctx.fillStyle = 'rgba(113,234,255,0.22)';
    ctx.fillRect(x + 7, y + 17, width - 14, 1);
    ctx.restore();
  }

  private drawBoard(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.fillStyle = 'rgba(1, 6, 17, 0.96)';
    ctx.fillRect(BOARD_X, BOARD_Y, BOARD_WIDTH * CELL_SIZE, BOARD_HEIGHT * CELL_SIZE);

    ctx.strokeStyle = 'rgba(95, 164, 195, 0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let column = 0; column <= BOARD_WIDTH; column += 1) {
      const x = BOARD_X + column * CELL_SIZE + 0.5;
      ctx.moveTo(x, BOARD_Y);
      ctx.lineTo(x, BOARD_Y + BOARD_HEIGHT * CELL_SIZE);
    }
    for (let row = 0; row <= BOARD_HEIGHT; row += 1) {
      const y = BOARD_Y + row * CELL_SIZE + 0.5;
      ctx.moveTo(BOARD_X, y);
      ctx.lineTo(BOARD_X + BOARD_WIDTH * CELL_SIZE, y);
    }
    ctx.stroke();

    const clearing = new Set(this.clearingRows);
    for (let row = 0; row < BOARD_HEIGHT; row += 1) {
      for (let column = 0; column < BOARD_WIDTH; column += 1) {
        const type = this.board[row][column];
        if (!type) continue;
        if (clearing.has(row) && Math.floor(this.clearTimer * 30) % 2 === 0) {
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur = 11;
          ctx.fillRect(BOARD_X + column * CELL_SIZE + 1, BOARD_Y + row * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
          ctx.shadowBlur = 0;
        } else {
          this.drawCell(ctx, column, row, type, 1);
        }
      }
    }

    ctx.shadowColor = '#56eaff';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#4f99b1';
    ctx.lineWidth = 2;
    ctx.strokeRect(BOARD_X - 2, BOARD_Y - 2, BOARD_WIDTH * CELL_SIZE + 4, BOARD_HEIGHT * CELL_SIZE + 4);
    ctx.restore();
  }

  private drawGhost(ctx: CanvasRenderingContext2D): void {
    if (!this.active || this.clearTimer > 0) return;
    const ghostY = this.ghostY();
    if (ghostY === this.active.y) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = COLORS[this.active.type];
    ctx.lineWidth = 1;
    for (const [localX, localY] of SHAPES[this.active.type][this.active.rotation]) {
      const x = this.active.x + localX;
      const y = ghostY + localY;
      if (y < 0) continue;
      ctx.strokeRect(BOARD_X + x * CELL_SIZE + 2.5, BOARD_Y + y * CELL_SIZE + 2.5, CELL_SIZE - 5, CELL_SIZE - 5);
    }
    ctx.restore();
  }

  private drawActive(ctx: CanvasRenderingContext2D): void {
    if (!this.active || this.clearTimer > 0) return;
    for (const [localX, localY] of SHAPES[this.active.type][this.active.rotation]) {
      const x = this.active.x + localX;
      const y = this.active.y + localY;
      if (y >= 0) this.drawCell(ctx, x, y, this.active.type, 1);
    }
  }

  private drawCell(ctx: CanvasRenderingContext2D, column: number, row: number, type: PieceType, alpha: number): void {
    const x = BOARD_X + column * CELL_SIZE;
    const y = BOARD_Y + row * CELL_SIZE;
    const color = COLORS[type];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillRect(x + 2, y + 2, CELL_SIZE - 4, 2);
    ctx.fillRect(x + 2, y + 2, 2, CELL_SIZE - 4);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 3, y + CELL_SIZE - 3, CELL_SIZE - 5, 1);
    ctx.fillRect(x + CELL_SIZE - 3, y + 3, 1, CELL_SIZE - 5);
    ctx.restore();
  }

  private drawMiniPiece(ctx: CanvasRenderingContext2D, type: PieceType, centerX: number, centerY: number, size: number): void {
    const cells = SHAPES[type][0];
    const minX = Math.min(...cells.map(([x]) => x));
    const maxX = Math.max(...cells.map(([x]) => x));
    const minY = Math.min(...cells.map(([, y]) => y));
    const maxY = Math.max(...cells.map(([, y]) => y));
    const width = (maxX - minX + 1) * size;
    const height = (maxY - minY + 1) * size;
    const originX = centerX - width / 2 - minX * size;
    const originY = centerY - height / 2 - minY * size;
    const color = COLORS[type];
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 7;
    for (const [x, y] of cells) {
      ctx.fillRect(Math.round(originX + x * size) + 1, Math.round(originY + y * size) + 1, size - 2, size - 2);
    }
    ctx.restore();
  }

  private drawFragments(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const fragment of this.fragments) {
      ctx.globalAlpha = fragment.life / fragment.maxLife;
      ctx.fillStyle = fragment.color;
      ctx.fillRect(Math.round(fragment.x), Math.round(fragment.y), 3, 3);
    }
    ctx.restore();
  }

  private drawStatus(ctx: CanvasRenderingContext2D): void {
    if (this.readyTimer <= 0 && this.clearTimer <= 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#f2ffff';
    ctx.shadowColor = '#73f8ff';
    ctx.shadowBlur = 9;
    if (this.readyTimer > 0) {
      ctx.fillText('READY', SCREEN_WIDTH / 2, 154);
    } else {
      const labels = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD CLEAR'];
      ctx.fillStyle = this.clearingRows.length === 4 ? '#fff4a1' : '#eaffff';
      ctx.shadowColor = this.clearingRows.length === 4 ? '#ffe75e' : '#73f8ff';
      ctx.fillText(labels[this.clearingRows.length], SCREEN_WIDTH / 2, 154);
      if (this.combo > 0) {
        ctx.font = 'bold 8px monospace';
        ctx.fillText(`COMBO x${this.combo + 1}`, SCREEN_WIDTH / 2, 171);
      }
    }
    ctx.restore();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D, title: string, detail: string, color: string): void {
    ctx.save();
    ctx.fillStyle = 'rgba(1, 3, 12, 0.82)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px monospace';
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillText(title, SCREEN_WIDTH / 2, 132);
    ctx.font = 'bold 9px monospace';
    ctx.shadowBlur = 5;
    ctx.fillText(detail, SCREEN_WIDTH / 2, 158);
    ctx.restore();
  }
}

export default FallingBlocks;
