import type { ArcadeSettings, GameId } from '../types';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../types';
import type { InputManager } from '../core/InputManager';
import type { AppState } from '../core/StateManager';

const requireElement = <T extends Element>(root: ParentNode, selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Cabinet element missing: ${selector}`);
  return element;
};

export class Cabinet {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  private readonly room: HTMLElement;
  private readonly cabinet: HTMLElement;
  private readonly joystick: HTMLElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly screenStatus: HTMLElement;
  private readonly screenFlash: HTMLElement;
  private readonly controls = new Map<string, HTMLElement>();
  private readonly cleanups: Array<() => void> = [];
  private flashTimer = 0;
  private lastJoystickX = Number.NaN;
  private lastJoystickY = Number.NaN;
  private lastState = '';
  private lastGame = '';
  private lastStatus = '';
  private lastSettings = '';

  constructor(root: HTMLElement, input: InputManager, onFullscreen: () => void) {
    root.innerHTML = `
      <div class="arcade-room" data-crt="medium" data-power="booting">
        <div class="ambient-glow ambient-glow--pink"></div>
        <div class="ambient-glow ambient-glow--cyan"></div>
        <div class="background-cabinets" aria-hidden="true">
          <div class="background-machine background-machine--one"><i></i></div>
          <div class="background-machine background-machine--two"><i></i></div>
          <div class="background-machine background-machine--three"><i></i></div>
        </div>
        <div class="floor-grid" aria-hidden="true"></div>
        <main class="cabinet-stage">
          <article class="arcade-cabinet" data-testid="arcade-cabinet" aria-label="Macchina Retro Arcade">
            <div class="cabinet-side cabinet-side--left"></div>
            <div class="cabinet-side cabinet-side--right"></div>
            <header class="marquee-housing">
              <span class="screw screw--tl"></span><span class="screw screw--tr"></span>
              <div class="marquee-art">
                <span class="marquee-stars" aria-hidden="true">✦ · ✧ · ✦</span>
                <h1>RETRO <em>ARCADE</em></h1>
                <p>SEVEN WORLDS · ONE MACHINE</p>
              </div>
              <div class="marquee-lip"></div>
            </header>

            <section class="speaker-bay" aria-label="Altoparlanti">
              <div class="speaker speaker--left" aria-hidden="true"></div>
              <div class="speaker-label"><b>RA-88</b><span>STEREO PHOSPHOR SYSTEM</span></div>
              <div class="speaker speaker--right" aria-hidden="true"></div>
            </section>

            <section class="monitor-hood">
              <div class="monitor-bezel">
                <span class="bezel-screw bezel-screw--tl"></span><span class="bezel-screw bezel-screw--tr"></span>
                <span class="bezel-screw bezel-screw--bl"></span><span class="bezel-screw bezel-screw--br"></span>
                <div class="crt-frame">
                  <div class="crt-screen" data-testid="crt-screen">
                    <canvas width="${SCREEN_WIDTH}" height="${SCREEN_HEIGHT}" aria-label="Schermo di gioco Retro Arcade"></canvas>
                    <div class="crt-rgb" aria-hidden="true"></div>
                    <div class="crt-scanlines" aria-hidden="true"></div>
                    <div class="crt-noise" aria-hidden="true"></div>
                    <div class="crt-vignette" aria-hidden="true"></div>
                    <div class="crt-reflection" aria-hidden="true"></div>
                    <div class="crt-flash" aria-hidden="true"></div>
                    <div class="crt-shutdown" aria-hidden="true"></div>
                  </div>
                </div>
                <div class="monitor-brand"><span>COLOR DISPLAY</span><b>384</b><span>LOW LATENCY</span></div>
              </div>
            </section>

            <section class="control-deck">
              <div class="deck-surface">
                <span class="deck-screw deck-screw--one"></span><span class="deck-screw deck-screw--two"></span>
                <div class="joystick-zone">
                  <div class="joystick-label">8-WAY</div>
                  <div class="joystick" data-testid="joystick" role="application" aria-label="Joystick arcade trascinabile" tabindex="0">
                    <div class="joystick-shadow"></div>
                    <div class="joystick-base"><div class="joystick-ring"></div></div>
                    <div class="joystick-stick"><div class="joystick-ball"></div></div>
                  </div>
                  <div class="joystick-arrows" aria-hidden="true"><i>▲</i><span>◀</span><span>▶</span><i>▼</i></div>
                </div>

                <div class="action-cluster" aria-label="Pulsanti azione">
                  <div class="action-button-wrap action-button-wrap--a">
                    <span>TURBO</span><button class="arcade-button arcade-button--a" data-action="buttonA" data-testid="button-a" aria-label="Pulsante A, tasto Z"><i></i></button><b>A</b>
                  </div>
                  <div class="action-button-wrap action-button-wrap--b">
                    <span>ALT</span><button class="arcade-button arcade-button--b" data-action="buttonB" data-testid="button-b" aria-label="Pulsante B, tasto X"><i></i></button><b>B</b>
                  </div>
                  <div class="action-button-wrap action-button-wrap--c">
                    <span>DROP</span><button class="arcade-button arcade-button--c" data-action="buttonC" data-testid="button-c" aria-label="Pulsante C, tasto C"><i></i></button><b>C</b>
                  </div>
                </div>

                <div class="system-cluster">
                  <div class="system-button-wrap">
                    <button class="system-button system-button--start is-ready" data-action="start" data-testid="start-button" aria-label="Start, tasto Invio"><i></i></button>
                    <span>START</span>
                  </div>
                  <div class="system-button-wrap">
                    <button class="system-button system-button--fullscreen" data-testid="fullscreen-button" type="button" aria-label="Attiva o disattiva schermo intero, tasto F" aria-pressed="false"><i></i></button>
                    <span>FULL</span>
                  </div>
                </div>
              </div>
              <div class="deck-front"><span>ARROWS / WASD</span><b>Z</b><b>X</b><b>C</b><span>ESC PAUSE</span><span>F FULLSCREEN</span></div>
            </section>
          </article>
        </main>
        <div class="screen-reader-status" data-testid="screen-status" aria-live="polite"></div>
      </div>
    `;

    this.room = requireElement(root, '.arcade-room');
    this.cabinet = requireElement(root, '.arcade-cabinet');
    this.joystick = requireElement(root, '.joystick');
    this.canvas = requireElement(root, 'canvas');
    this.context = this.canvas.getContext('2d', { alpha: false })!;
    this.context.imageSmoothingEnabled = false;
    this.fullscreenButton = requireElement(root, '[data-testid="fullscreen-button"]');
    this.screenStatus = requireElement(root, '[data-testid="screen-status"]');
    this.screenFlash = requireElement(root, '.crt-flash');

    for (const element of root.querySelectorAll<HTMLElement>('[data-action]')) {
      const action = element.dataset.action!;
      this.controls.set(action, element);
      input.bindButton(element, action as Parameters<InputManager['down']>[0]);
    }
    input.bindJoystick(this.joystick);
    this.cleanups.push(input.subscribe((action, down) => this.controls.get(action)?.classList.toggle('is-pressed', down)));
    const syncFullscreen = (): void => {
      this.fullscreenButton.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
    };
    this.fullscreenButton.addEventListener('click', onFullscreen);
    document.addEventListener('fullscreenchange', syncFullscreen);
    this.cleanups.push(() => this.fullscreenButton.removeEventListener('click', onFullscreen));
    this.cleanups.push(() => document.removeEventListener('fullscreenchange', syncFullscreen));

    let targetX = 0;
    let targetY = 0;
    const parallax = (event: PointerEvent): void => {
      if (this.room.dataset.state === 'PLAYING') return;
      targetX = (event.clientX / window.innerWidth - 0.5) * 1.2;
      targetY = (event.clientY / window.innerHeight - 0.5) * -0.7;
      this.cabinet.style.setProperty('--parallax-x', `${targetX}deg`);
      this.cabinet.style.setProperty('--parallax-y', `${targetY}deg`);
    };
    window.addEventListener('pointermove', parallax, { passive: true });
    this.cleanups.push(() => window.removeEventListener('pointermove', parallax));
  }

  syncControls(horizontal: number, vertical: number): void {
    if (horizontal === this.lastJoystickX && vertical === this.lastJoystickY) return;
    this.lastJoystickX = horizontal;
    this.lastJoystickY = vertical;
    this.joystick.style.setProperty('--joy-x', String(horizontal));
    this.joystick.style.setProperty('--joy-y', String(vertical));
  }

  setState(state: AppState): void {
    if (state === this.lastState) return;
    this.lastState = state;
    this.room.dataset.state = state;
    this.room.dataset.power = state === 'POWER_OFF' ? 'off' : state === 'BOOTING' ? 'booting' : 'on';
  }

  setGame(id: GameId | ''): void {
    if (id === this.lastGame) return;
    this.lastGame = id;
    this.room.dataset.game = id;
  }

  setStatus(text: string): void {
    if (text === this.lastStatus) return;
    this.lastStatus = text;
    this.screenStatus.textContent = text;
  }

  setSettings(settings: ArcadeSettings): void {
    const signature = [settings.crtStrength, settings.scanlines, settings.flicker, settings.rgbShift, settings.glow].join(':');
    if (signature === this.lastSettings) return;
    this.lastSettings = signature;
    this.room.dataset.crt = settings.crtStrength;
    this.room.classList.toggle('scanlines-off', !settings.scanlines);
    this.room.classList.toggle('flicker-off', !settings.flicker);
    this.room.classList.toggle('rgb-off', !settings.rgbShift);
    this.room.classList.toggle('glow-off', !settings.glow);
  }

  flash(color = '#ffffff', intensity = 0.6): void {
    this.screenFlash.style.setProperty('--flash-color', color);
    this.screenFlash.style.setProperty('--flash-alpha', String(Math.max(0, Math.min(1, intensity))));
    this.screenFlash.classList.remove('is-flashing');
    void this.screenFlash.offsetWidth;
    this.screenFlash.classList.add('is-flashing');
    this.flashTimer = 0.18;
  }

  update(deltaSeconds: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= deltaSeconds;
      if (this.flashTimer <= 0) this.screenFlash.classList.remove('is-flashing');
    }
  }

  destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }
}
