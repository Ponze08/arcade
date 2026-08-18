export class CreditManager {
  private value = 0;
  get credits(): number { return this.value; }
  insert(): number { this.value = Math.min(99, this.value + 1); return this.value; }
  canStart(freePlay: boolean): boolean { return freePlay || this.value > 0; }
  consume(freePlay: boolean): boolean {
    if (freePlay) return true;
    if (this.value < 1) return false;
    this.value -= 1;
    return true;
  }
}
