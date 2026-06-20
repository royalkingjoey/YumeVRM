import type { VRM } from '@pixiv/three-vrm';

const SMOOTHING = 0.6;
// Amplifies the measured RMS amplitude (0-1) into a usable mouth-open range.
const GAIN = 4;

/**
 * Drives a VRM's mouth-open expression ("aa") in real time from the audio
 * output of an `<audio>` element, using Web Audio API amplitude analysis.
 *
 * This is the audio-analysis fallback: the standard OpenAI-compatible
 * `/v1/audio/speech` endpoint returns raw audio bytes with no phoneme/viseme
 * timing, so amplitude-driven mouth movement is the practical option. If a
 * provider ever supplies viseme timing, that data could be applied directly
 * to `expressionManager.setValue(...)` instead of calling `update()`.
 */
export class LipSync {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  private currentValue = 0;
  private attachedElement: HTMLAudioElement | null = null;
  private muted = false;

  /**
   * Connects an `<audio>` element so its output can be analyzed for
   * lip-sync, while still routing to the speakers via the analyser.
   */
  attach(audio: HTMLAudioElement): void {
    if (this.attachedElement === audio) return;
    this.detach();

    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.dataArray = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));

    this.sourceNode = this.audioContext.createMediaElementSource(audio);
    this.sourceNode.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
    this.attachedElement = audio;
  }

  /** Disconnects from the current audio element, if any. */
  detach(): void {
    this.sourceNode?.disconnect();
    this.analyser?.disconnect();
    this.sourceNode = null;
    this.analyser = null;
    this.dataArray = null;
    this.attachedElement = null;
  }

  /** Stops driving the mouth and lets `update()` ease it back to closed. */
  stop(): void {
    this.detach();
    this.muted = false;
  }

  /** Temporarily ignores audio amplitude, easing the mouth toward closed, without detaching. */
  mute(): void {
    this.muted = true;
  }

  /** Resumes driving the mouth from audio amplitude after `mute()`. */
  unmute(): void {
    this.muted = false;
  }

  /** Updates the VRM's mouth-open expression based on the current audio amplitude. Call once per frame. */
  update(vrm: VRM): void {
    const expressionManager = vrm.expressionManager;
    if (!expressionManager) return;

    let target = 0;
    if (!this.muted && this.analyser && this.dataArray) {
      this.analyser.getByteTimeDomainData(this.dataArray);
      let sumSquares = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        const normalized = (this.dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / this.dataArray.length);
      target = Math.min(1, rms * GAIN);
    }

    this.currentValue += (target - this.currentValue) * SMOOTHING;
    if (this.currentValue < 0.01) this.currentValue = 0;
    expressionManager.setValue('aa', this.currentValue);
  }
}
