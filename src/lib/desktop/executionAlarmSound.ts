import {
  EXECUTION_ALARM_MAX_AUDIBLE_MS,
  EXECUTION_ALARM_REPEAT_MS,
} from './executionAlarm';

type AudioContextConstructor = typeof AudioContext;

export class ExecutionAlarmSound {
  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private repeatTimer: ReturnType<typeof setInterval> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  async playOnce(): Promise<void> {
    const context = await this.ensureContext();
    if (!context) return;
    if (context.state === 'suspended') await context.resume();
    this.stopSource();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = this.buffer;
    gain.gain.value = 0.42;
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => {
      if (this.source === source) this.source = null;
    };
    this.source = source;
    source.start();
  }

  async startBounded(
    repeatMs = EXECUTION_ALARM_REPEAT_MS,
    maxAudibleMs = EXECUTION_ALARM_MAX_AUDIBLE_MS,
  ): Promise<void> {
    this.stop();
    await this.playOnce();
    this.repeatTimer = setInterval(() => { void this.playOnce(); }, repeatMs);
    this.stopTimer = setTimeout(() => this.stop(), maxAudibleMs);
  }

  stop(): void {
    if (this.repeatTimer !== null) clearInterval(this.repeatTimer);
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.repeatTimer = null;
    this.stopTimer = null;
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
  const durationSeconds = 1.45;
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
    { start: 0.00, end: 0.30, frequency: 392 },
    { start: 0.34, end: 0.68, frequency: 587.33 },
    { start: 0.73, end: 1.30, frequency: 783.99 },
  ];
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    let sample = 0;
    for (const note of notes) {
      if (time < note.start || time > note.end) continue;
      const position = (time - note.start) / (note.end - note.start);
      const attack = Math.min(1, position / 0.06);
      const release = Math.min(1, (1 - position) / 0.22);
      const envelope = Math.sin(Math.PI * Math.min(1, attack)) * Math.max(0, release);
      const fundamental = Math.sin(2 * Math.PI * note.frequency * time);
      const overtone = Math.sin(2 * Math.PI * note.frequency * 2 * time) * 0.16;
      sample += (fundamental + overtone) * envelope * 0.34;
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
