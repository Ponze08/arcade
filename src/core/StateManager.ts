export type AppState =
  | 'POWER_OFF'
  | 'BOOTING'
  | 'MAIN_MENU'
  | 'GAME_LOADING'
  | 'PLAYING'
  | 'PAUSED'
  | 'GAME_OVER'
  | 'ATTRACT_MODE'
  | 'SETTINGS'
  | 'HALL_OF_FAME';

export class StateManager {
  private current: AppState = 'BOOTING';
  private previous: AppState = 'POWER_OFF';
  private elapsed = 0;
  get state(): AppState { return this.current; }
  get previousState(): AppState { return this.previous; }
  get stateElapsed(): number { return this.elapsed; }
  set(next: AppState): void {
    if (next === this.current) return;
    this.previous = this.current;
    this.current = next;
    this.elapsed = 0;
  }
  update(deltaSeconds: number): void { this.elapsed += deltaSeconds; }
}
