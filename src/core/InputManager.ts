import type { Action, InputFrame } from '../types';

type InputListener = (action: Action, isDown: boolean) => void;

const KEY_MAP: Record<string, Action | undefined> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'buttonA', KeyX: 'buttonB', KeyC: 'buttonC',
  Enter: 'start', NumpadEnter: 'start',
  Escape: 'pause',
};

export class InputManager implements InputFrame {
  private readonly sources = new Map<Action, Set<string>>();
  private readonly justPressed = new Set<Action>();
  private readonly justReleased = new Set<Action>();
  private readonly listeners = new Set<InputListener>();
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly onActivity: () => void,
    private readonly onFullscreen: () => void,
    private readonly onBlur: () => void,
  ) {
    const keydown = (event: KeyboardEvent): void => {
      if (event.code === 'KeyF' && !event.repeat) {
        event.preventDefault();
        this.onActivity();
        this.onFullscreen();
        return;
      }
      const action = KEY_MAP[event.code];
      if (!action) return;
      event.preventDefault();
      this.setSource(action, `key:${event.code}`, true);
    };
    const keyup = (event: KeyboardEvent): void => {
      const action = KEY_MAP[event.code];
      if (!action) return;
      event.preventDefault();
      this.setSource(action, `key:${event.code}`, false);
    };
    const blur = (): void => {
      this.clearAll();
      this.onBlur();
    };
    const visibilityChange = (): void => { if (document.hidden) blur(); };
    window.addEventListener('keydown', keydown, { passive: false });
    window.addEventListener('keyup', keyup, { passive: false });
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibilityChange);
    this.cleanups.push(
      () => window.removeEventListener('keydown', keydown),
      () => window.removeEventListener('keyup', keyup),
      () => window.removeEventListener('blur', blur),
      () => document.removeEventListener('visibilitychange', visibilityChange),
    );
  }

  get horizontal(): number { return Number(this.down('right')) - Number(this.down('left')); }
  get vertical(): number { return Number(this.down('down')) - Number(this.down('up')); }
  down(action: Action): boolean { return (this.sources.get(action)?.size ?? 0) > 0; }
  pressed(action: Action): boolean { return this.justPressed.has(action); }
  released(action: Action): boolean { return this.justReleased.has(action); }

  subscribe(listener: InputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  bindButton(element: HTMLElement, action: Action): void {
    const sourcePrefix = `pointer:${action}:${Math.random().toString(36).slice(2)}`;
    const activePointers = new Set<number>();
    const press = (event: PointerEvent): void => {
      event.preventDefault();
      activePointers.add(event.pointerId);
      try { element.setPointerCapture(event.pointerId); } catch { /* capture may be unavailable */ }
      this.setSource(action, `${sourcePrefix}:${event.pointerId}`, true);
    };
    const release = (event: PointerEvent): void => {
      if (!activePointers.has(event.pointerId)) return;
      activePointers.delete(event.pointerId);
      this.setSource(action, `${sourcePrefix}:${event.pointerId}`, false);
    };
    const contextMenu = (event: MouseEvent): void => event.preventDefault();
    element.addEventListener('pointerdown', press);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', release);
    element.addEventListener('contextmenu', contextMenu);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    this.cleanups.push(() => {
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('pointerup', release);
      element.removeEventListener('pointercancel', release);
      element.removeEventListener('lostpointercapture', release);
      element.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      for (const pointerId of activePointers) this.setSource(action, `${sourcePrefix}:${pointerId}`, false);
      activePointers.clear();
    });
  }

  bindJoystick(element: HTMLElement): void {
    const source = 'pointer:joystick';
    let activePointer: number | null = null;
    const update = (event: PointerEvent): void => {
      if (activePointer !== event.pointerId) return;
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      const threshold = 0.23;
      this.setSource('left', `${source}:left`, x < -threshold);
      this.setSource('right', `${source}:right`, x > threshold);
      this.setSource('up', `${source}:up`, y < -threshold);
      this.setSource('down', `${source}:down`, y > threshold);
    };
    const press = (event: PointerEvent): void => {
      event.preventDefault();
      activePointer = event.pointerId;
      try { element.setPointerCapture(event.pointerId); } catch { /* noop */ }
      update(event);
    };
    const release = (event: PointerEvent): void => {
      if (activePointer !== event.pointerId) return;
      event.preventDefault();
      activePointer = null;
      for (const action of ['left', 'right', 'up', 'down'] as Action[]) {
        this.setSource(action, `${source}:${action}`, false);
      }
    };
    element.addEventListener('pointerdown', press);
    element.addEventListener('pointermove', update);
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('lostpointercapture', release);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    this.cleanups.push(() => {
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('pointermove', update);
      element.removeEventListener('pointerup', release);
      element.removeEventListener('pointercancel', release);
      element.removeEventListener('lostpointercapture', release);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    });
  }

  endFrame(): void {
    this.justPressed.clear();
    this.justReleased.clear();
  }

  clearAll(): void {
    for (const [action, set] of this.sources) {
      if (set.size > 0) {
        set.clear();
        this.justReleased.add(action);
        for (const listener of this.listeners) listener(action, false);
      }
    }
  }

  destroy(): void {
    this.clearAll();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.listeners.clear();
  }

  private setSource(action: Action, source: string, active: boolean): void {
    let set = this.sources.get(action);
    if (!set) {
      set = new Set();
      this.sources.set(action, set);
    }
    const wasDown = set.size > 0;
    if (active) set.add(source); else set.delete(source);
    const isDown = set.size > 0;
    if (wasDown === isDown) return;
    this.onActivity();
    if (isDown) {
      this.justPressed.add(action);
      this.justReleased.delete(action);
    } else {
      this.justReleased.add(action);
    }
    for (const listener of this.listeners) listener(action, isDown);
  }
}
