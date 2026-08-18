import type { ArcadeGame, GameFactory, GameId, GameServices } from '../types';

export class GameManager {
  private readonly factories = new Map<GameId, GameFactory>();
  private active: ArcadeGame | null = null;

  get current(): ArcadeGame | null { return this.active; }

  register(id: GameId, factory: GameFactory): void {
    this.factories.set(id, factory);
  }

  load(id: GameId, services: GameServices): ArcadeGame {
    this.unload();
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`Game is not registered: ${id}`);
    this.active = factory(services);
    this.active.start();
    return this.active;
  }

  unload(): void {
    this.active?.destroy();
    this.active = null;
  }

  pause(): void { this.active?.pause(); }
  resume(): void { this.active?.resume(); }
  restart(): void { this.active?.reset(); }
}
