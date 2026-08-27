import {
  EXECUTION_ALARM_ESCALATION_MS,
  EXECUTION_ALARM_MAX_AUDIBLE_MS,
} from './executionAlarm';

type AudioContextConstructor = typeof AudioContext;

export class ExecutionAlarmSound {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  async playOnce(): Promise<void> {
    const context = await this.ensureContext();
    if (!context) return;
    if (context.state === 'suspended') await context.resume();
    this.stopSource();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = this.buffer;
    gain.gain.value = 0.58;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      if (this.source === source) this.source = null;
    };
    this.source = source;
    source.start();
  }

  async startBounded(
    maxAudibleMs = EXECUTION_ALARM_MAX_AUDIBLE_MS,
  ): Promise<void> {
    this.stop();
    for (const offset of EXECUTION_ALARM_ESCALATION_MS) {
      if (offset > maxAudibleMs) continue;
      if (offset === 0) await this.playOnce();
      else this.timers.push(setTimeout(() => { void this.playOnce(); }, offset));
    }
    this.timers.push(setTimeout(() => this.stop(), maxAudibleMs + 2_500));
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.stopSource();
  }

  private stopSource(): void {
    try {
      this.source?.stop();
    } catch {
      // An already-ended source is harmless.
    }
    this.source = null;
  }

  private async ensureContext(): Promise<AudioContext | null> {
    if (this.context && this.buffer) return this.context;
    const Constructor = audioContextConstructor();
    if (!Constructor) return null;
    try {
      this.context = new Constructor();
      this.buffer = await this.context.decodeAudioData(createOriginalExecutionAlarmWav());
      return this.context;
    } catch {
      this.context = null;
      this.buffer = null;
      return null;
    }
  }
}

export function createOriginalExecutionAlarmWav(): ArrayBuffer {
  const sampleRate = 22_050;
  const durationSeconds = 2.2;
  const samples = Math.floor(sampleRate * durationSeconds);
  const dataBytes = samples * 2;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const notes = [
    { start: 0.00, end: 0.48, frequency: 440, weight: 0.30 },
    { start: 0.00, end: 0.48, frequency: 554.37, weight: 0.16 },
    { start: 0.58, end: 1.10, frequency: 554.37, weight: 0.31 },
    { start: 0.58, end: 1.10, frequency: 659.25, weight: 0.16 },
    { start: 1.22, end: 2.08, frequency: 739.99, weight: 0.34 },
    { start: 1.22, end: 2.08, frequency: 880, weight: 0.14 },
  ];
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    let sample = 0;
    for (const note of notes) {
      if (time < note.start || time > note.end) continue;
      const position = (time - note.start) / (note.end - note.start);
      const attack = Math.min(1, position / 0.045);
      const release = Math.min(1, (1 - position) / 0.28);
      const envelope = Math.sin(Math.PI * Math.min(1, attack)) * Math.max(0, release);
      const fundamental = Math.sin(2 * Math.PI * note.frequency * time);
      const overtone = Math.sin(2 * Math.PI * note.frequency * 2 * time) * 0.12;
      const presence = Math.sin(2 * Math.PI * note.frequency * 3 * time) * 0.035;
      sample += (fundamental + overtone + presence) * envelope * note.weight;
    }
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32_767), true);
  }
  return output;
}

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = window as typeof window & { webkitAudioContext?: AudioContextConstructor };
  return window.AudioContext ?? candidate.webkitAudioContext ?? null;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
