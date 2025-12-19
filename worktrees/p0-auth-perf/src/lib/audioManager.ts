// 🔊 GAMING AUDIO SYSTEM - Dopamine through Sound
export class AudioManager {
  private static instance: AudioManager;
  private audioContext: AudioContext | null = null;
  private masterVolume = 0.3;
  private enabled = true;
  
  private soundLibrary: Map<string, AudioBuffer> = new Map();
  
  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  async init(): Promise<void> {
    if (typeof window === 'undefined') return;
    
    try {
      this.audioContext = new AudioContext();
      await this.loadSounds();
      console.log('🎵 Audio Manager initialized');
    } catch (error) {
      console.warn('🔇 Audio context failed to initialize:', error);
    }
  }

  private async loadSounds(): Promise<void> {
    const sounds = {
      // 🎯 Task Completion Sounds
      taskComplete: this.generateTaskCompleteSound(),
      habitComplete: this.generateHabitCompleteSound(),
      goalProgress: this.generateGoalProgressSound(),
      
      // ⚡ Action Feedback
      buttonClick: this.generateButtonClickSound(),
      buttonHover: this.generateButtonHoverSound(),
      
      // 🏆 Achievement Sounds  
      achievementUnlock: this.generateAchievementSound(),
      levelUp: this.generateLevelUpSound(),
      streakMilestone: this.generateStreakSound(),
      
      // 🚨 Alert Sounds
      focusStart: this.generateFocusStartSound(),
      focusEnd: this.generateFocusEndSound(),
      breakReminder: this.generateBreakReminderSound(),
      
      // 🎮 Gaming Elements
      xpGain: this.generateXPGainSound(),
      comboMultiplier: this.generateComboSound(),
      perfectDay: this.generatePerfectDaySound(),
    };

    for (const [name, audioData] of Object.entries(sounds)) {
      if (audioData && this.audioContext) {
        const audioBuffer = await this.audioContext.decodeAudioData(audioData);
        this.soundLibrary.set(name, audioBuffer);
      }
    }
  }

  // 🎵 PROCEDURAL SOUND GENERATION
  
  private generateTaskCompleteSound(): ArrayBuffer {
    return this.createTone([
      { freq: 523, duration: 0.1, volume: 0.3 }, // C5
      { freq: 659, duration: 0.1, volume: 0.4 }, // E5  
      { freq: 784, duration: 0.2, volume: 0.5 }, // G5
    ]);
  }

  private generateHabitCompleteSound(): ArrayBuffer {
    return this.createTone([
      { freq: 440, duration: 0.15, volume: 0.3 }, // A4
      { freq: 554, duration: 0.15, volume: 0.4 }, // C#5
      { freq: 659, duration: 0.3, volume: 0.5 },  // E5
    ]);
  }

  private generateGoalProgressSound(): ArrayBuffer {
    return this.createTone([
      { freq: 392, duration: 0.1, volume: 0.2 }, // G4
      { freq: 494, duration: 0.1, volume: 0.3 }, // B4
      { freq: 587, duration: 0.1, volume: 0.4 }, // D5
      { freq: 698, duration: 0.2, volume: 0.5 }, // F5
    ]);
  }

  private generateButtonClickSound(): ArrayBuffer {
    return this.createTone([
      { freq: 800, duration: 0.05, volume: 0.2 },
      { freq: 600, duration: 0.05, volume: 0.15 },
    ]);
  }

  private generateButtonHoverSound(): ArrayBuffer {
    return this.createTone([
      { freq: 1200, duration: 0.03, volume: 0.1 },
    ]);
  }

  private generateAchievementSound(): ArrayBuffer {
    return this.createTone([
      { freq: 523, duration: 0.2, volume: 0.4 }, // C5
      { freq: 659, duration: 0.2, volume: 0.5 }, // E5
      { freq: 784, duration: 0.2, volume: 0.6 }, // G5
      { freq: 1047, duration: 0.4, volume: 0.7 }, // C6
    ]);
  }

  private generateLevelUpSound(): ArrayBuffer {
    return this.createTone([
      { freq: 261, duration: 0.1, volume: 0.3 },
      { freq: 329, duration: 0.1, volume: 0.4 },
      { freq: 392, duration: 0.1, volume: 0.5 },
      { freq: 523, duration: 0.1, volume: 0.6 },
      { freq: 659, duration: 0.1, volume: 0.7 },
      { freq: 784, duration: 0.1, volume: 0.8 },
      { freq: 1047, duration: 0.3, volume: 0.9 },
    ]);
  }

  private generateStreakSound(): ArrayBuffer {
    return this.createTone([
      { freq: 440, duration: 0.1, volume: 0.4 },
      { freq: 880, duration: 0.1, volume: 0.5 },
      { freq: 440, duration: 0.1, volume: 0.4 },
      { freq: 880, duration: 0.2, volume: 0.6 },
    ]);
  }

  private generateFocusStartSound(): ArrayBuffer {
    return this.createTone([
      { freq: 200, duration: 0.5, volume: 0.3 },
      { freq: 300, duration: 0.3, volume: 0.2 },
    ]);
  }

  private generateFocusEndSound(): ArrayBuffer {
    return this.createTone([
      { freq: 400, duration: 0.3, volume: 0.3 },
      { freq: 300, duration: 0.5, volume: 0.2 },
    ]);
  }

  private generateBreakReminderSound(): ArrayBuffer {
    return this.createTone([
      { freq: 500, duration: 0.2, volume: 0.3 },
      { freq: 400, duration: 0.2, volume: 0.2 },
      { freq: 500, duration: 0.2, volume: 0.3 },
    ]);
  }

  private generateXPGainSound(): ArrayBuffer {
    return this.createTone([
      { freq: 800, duration: 0.1, volume: 0.3 },
      { freq: 1000, duration: 0.1, volume: 0.4 },
      { freq: 1200, duration: 0.1, volume: 0.5 },
    ]);
  }

  private generateComboSound(): ArrayBuffer {
    return this.createTone([
      { freq: 600, duration: 0.05, volume: 0.3 },
      { freq: 800, duration: 0.05, volume: 0.4 },
      { freq: 1000, duration: 0.05, volume: 0.5 },
      { freq: 1200, duration: 0.1, volume: 0.6 },
    ]);
  }

  private generatePerfectDaySound(): ArrayBuffer {
    return this.createTone([
      { freq: 523, duration: 0.2, volume: 0.5 },
      { freq: 659, duration: 0.2, volume: 0.6 },
      { freq: 784, duration: 0.2, volume: 0.7 },
      { freq: 1047, duration: 0.2, volume: 0.8 },
      { freq: 1319, duration: 0.4, volume: 0.9 },
    ]);
  }

  // 🎼 CORE SOUND SYNTHESIS
  
  private createTone(notes: Array<{ freq: number; duration: number; volume: number }>): ArrayBuffer {
    if (!this.audioContext) {
      return new ArrayBuffer(0);
    }

    const sampleRate = 44100;
    const totalDuration = notes.reduce((sum, note) => sum + note.duration, 0);
    const totalSamples = Math.floor(sampleRate * totalDuration);
    
    const audioBuffer = this.audioContext.createBuffer(1, totalSamples, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    let currentSample = 0;
    
    for (const note of notes) {
      const noteSamples = Math.floor(sampleRate * note.duration);
      
      for (let i = 0; i < noteSamples; i++) {
        const time = i / sampleRate;
        const fadeOut = Math.max(0, 1 - (i / noteSamples) * 2); // Envelope
        
        // Create rich harmonic sound
        const fundamental = Math.sin(2 * Math.PI * note.freq * time);
        const harmonic2 = Math.sin(2 * Math.PI * note.freq * 2 * time) * 0.3;
        const harmonic3 = Math.sin(2 * Math.PI * note.freq * 3 * time) * 0.1;
        
        channelData[currentSample + i] = (fundamental + harmonic2 + harmonic3) * note.volume * fadeOut;
      }
      
      currentSample += noteSamples;
    }
    
    // Convert to ArrayBuffer (simplified - in real implementation would need proper encoding)
    return audioBuffer.getChannelData(0).buffer.slice();
  }

  // 🎮 PUBLIC API

  play(soundName: string, volume: number = 1): void {
    if (!this.enabled || !this.audioContext || !this.soundLibrary.has(soundName)) {
      return;
    }

    try {
      const audioBuffer = this.soundLibrary.get(soundName)!;
      const source = this.audioContext.createBufferSource();
      const gainNode = this.audioContext.createGain();
      
      source.buffer = audioBuffer;
      gainNode.gain.value = this.masterVolume * volume;
      
      source.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      source.start(0);
    } catch (error) {
      console.warn('🔇 Failed to play sound:', soundName, error);
    }
  }

  // 🎵 CONVENIENCE METHODS
  
  taskCompleted(): void {
    this.play('taskComplete');
    setTimeout(() => this.play('xpGain'), 200);
  }

  habitCompleted(streakCount: number): void {
    this.play('habitComplete');
    
    // Special effects for milestones
    if (streakCount % 7 === 0) {
      setTimeout(() => this.play('streakMilestone'), 300);
    }
    if (streakCount >= 30) {
      setTimeout(() => this.play('achievementUnlock'), 500);
    }
  }

  goalProgress(percentComplete: number): void {
    this.play('goalProgress');
    
    // Celebrate major milestones
    if (percentComplete >= 100) {
      setTimeout(() => this.play('levelUp'), 300);
    } else if (percentComplete % 25 === 0 && percentComplete > 0) {
      setTimeout(() => this.play('achievementUnlock'), 200);
    }
  }

  buttonFeedback(): void {
    this.play('buttonClick');
  }

  buttonHover(): void {
    this.play('buttonHover', 0.5);
  }

  comboAchieved(comboCount: number): void {
    this.play('comboMultiplier');
    
    // Escalating excitement
    if (comboCount >= 5) {
      setTimeout(() => this.play('achievementUnlock'), 200);
    }
  }

  perfectDay(): void {
    this.play('perfectDay');
    setTimeout(() => this.play('levelUp'), 500);
  }

  focusSession(isStarting: boolean): void {
    if (isStarting) {
      this.play('focusStart');
    } else {
      this.play('focusEnd');
      setTimeout(() => this.play('xpGain'), 300);
    }
  }

  // ⚙️ SETTINGS
  
  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// 🎵 Global audio manager instance
export const audioManager = AudioManager.getInstance();