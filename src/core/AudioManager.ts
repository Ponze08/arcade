import type { ArcadeSettings, SoundName } from '../types';

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private humGain: GainNode | null = null;
  private settings: ArcadeSettings;
  private powered = true;

  constructor(settings: ArcadeSettings) { this.settings = settings; }

  async unlock(): Promise<void> {
    try {
      if (!this.context) {
        const Constructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
        if (!Constructor) return;
        this.context = new Constructor();
        this.master = this.context.createGain();
        this.sfx = this.context.createGain();
        this.humGain = this.context.createGain();
        this.sfx.connect(this.master);
        this.humGain.connect(this.master);
        this.master.connect(this.context.destination);
        const hum = this.context.createOscillator();
        hum.type = 'sine';
        hum.frequency.value = 58;
        const harmonic = this.context.createOscillator();
        harmonic.type = 'triangle';
        harmonic.frequency.value = 116;
        const harmonicGain = this.context.createGain();
        harmonicGain.gain.value = 0.18;
        hum.connect(this.humGain);
        harmonic.connect(harmonicGain).connect(this.humGain);
        hum.start();
        harmonic.start();
        this.applySettings();
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Audio is an enhancement; gameplay must remain available. */ }
  }

  updateSettings(settings: ArcadeSettings): void {
    this.settings = settings;
    this.applySettings();
  }

  setPowered(powered: boolean): void {
    this.powered = powered;
    this.applySettings();
  }

  destroy(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    this.sfx = null;
    this.humGain = null;
    if (context && context.state !== 'closed') void context.close();
  }

  play(name: SoundName): void {
    if (!this.context || !this.sfx || this.settings.muted) return;
    const patterns: Record<SoundName, [number, number, OscillatorType, number, number?]> = {
      move: [160, 0.035, 'square', 0.035, 120],
      button: [95, 0.045, 'square', 0.07, 65],
      start: [240, 0.24, 'sawtooth', 0.09, 720],
      confirm: [420, 0.1, 'square', 0.075, 840],
      shot: [720, 0.09, 'square', 0.065, 180],
      hit: [140, 0.07, 'square', 0.08, 85],
      explosion: [75, 0.34, 'sawtooth', 0.12, 28],
      death: [360, 0.55, 'sawtooth', 0.1, 38],
      powerup: [380, 0.28, 'triangle', 0.09, 1240],
      line: [220, 0.3, 'square', 0.09, 1320],
      food: [640, 0.11, 'square', 0.07, 980],
      level: [260, 0.42, 'triangle', 0.1, 1560],
      gameover: [260, 0.8, 'sawtooth', 0.09, 42],
      highscore: [440, 0.7, 'square', 0.085, 1760],
      crtOn: [45, 0.5, 'sawtooth', 0.055, 380],
      crtOff: [460, 0.45, 'sine', 0.055, 25],
    };
    const [frequency, duration, type, volume, endFrequency] = patterns[name];
    if (name === 'explosion' || name === 'death' || name === 'crtOn') this.noise(duration, volume * 0.62);
    this.tone(frequency, duration, type, volume, endFrequency);
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, endFrequency?: number): void {
    if (!this.context || !this.sfx) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(12, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + Math.min(0.012, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.sfx);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private noise(duration: number, volume: number): void {
    if (!this.context || !this.sfx) return;
    const rate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, Math.ceil(rate * duration), rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.sfx);
    source.start();
  }

  private applySettings(): void {
    if (!this.context || !this.master || !this.sfx || !this.humGain) return;
    const now = this.context.currentTime;
    const mute = this.settings.muted ? 0 : 1;
    this.master.gain.setTargetAtTime(this.settings.masterVolume * mute, now, 0.02);
    this.sfx.gain.setTargetAtTime(this.settings.sfxVolume, now, 0.02);
    this.humGain.gain.setTargetAtTime(this.settings.musicVolume * 0.008 * Number(this.powered), now, 0.08);
  }
}
