import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation';

/**
 * Expression weights cleared whenever a custom clip starts or stops, so a
 * leftover face from the procedural system (or a previous clip) doesn't stick
 * underneath an animation that doesn't drive expressions itself.
 */
const RESET_EXPRESSIONS = [
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
  'blink',
  'blinkLeft',
  'blinkRight',
  'aa',
  'ou',
];

/**
 * Plays user-uploaded VRM Animation (`.vrma`) clips on the current VRM via a
 * Three.js `AnimationMixer`. A single clip plays at a time — either looping
 * (when used as a custom demeanor) or one-shot (a custom action). While a clip
 * is active it owns the avatar's pose, so the `ExpressionController` suspends
 * its procedural idle/gesture motion and hands timing here.
 *
 * Parsed animations are registered by name once and cached as per-VRM clips,
 * since `createVRMAnimationClip` binds tracks to a specific model's bones.
 */
export class CustomAnimationPlayer {
  private readonly registry = new Map<string, VRMAnimation>();
  private readonly clipCache = new Map<string, THREE.AnimationClip>();
  private vrm: VRM | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentName: string | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private currentLoop = false;

  /** Stores a parsed animation under `name`, replacing any previous one. */
  register(name: string, animation: VRMAnimation): void {
    this.registry.set(name, animation);
    this.clipCache.delete(name);
    if (this.currentName === name) this.stop();
  }

  /** Forgets a registered animation; stops it first if it's currently playing. */
  unregister(name: string): void {
    if (this.currentName === name) this.stop();
    this.registry.delete(name);
    this.clipCache.delete(name);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  /** Names of every registered animation, in insertion order. */
  names(): string[] {
    return [...this.registry.keys()];
  }

  /**
   * Points the player at a freshly-loaded VRM (or `null` when none is loaded),
   * rebuilding the mixer and discarding clips bound to the previous model.
   */
  setVrm(vrm: VRM | null): void {
    this.stopAction();
    this.clipCache.clear();
    this.vrm = vrm;
    this.mixer = vrm ? new THREE.AnimationMixer(vrm.scene) : null;
  }

  /** Starts `name` looping (demeanor) or one-shot (action). Returns false if it can't play. */
  play(name: string, loop: boolean): boolean {
    if (this.currentAction && this.currentName === name && this.currentLoop === loop) return true;
    if (!this.mixer || !this.vrm) return false;

    const clip = this.clipFor(name);
    if (!clip) return false;

    this.stopAction();
    this.resetPose();

    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.play();

    this.currentAction = action;
    this.currentName = name;
    this.currentLoop = loop;
    return true;
  }

  /** Advances the mixer. Call once per frame while a clip is playing. */
  update(delta: number): void {
    this.mixer?.update(delta);
  }

  isPlaying(): boolean {
    return this.currentAction !== null;
  }

  playingName(): string | null {
    return this.currentName;
  }

  /** True once a one-shot clip has played through to its end. */
  hasFinished(): boolean {
    if (!this.currentAction || this.currentLoop) return false;
    return this.currentAction.time >= this.currentAction.getClip().duration;
  }

  /** Stops the active clip (if any) and restores the model to its rest pose. */
  stop(): void {
    if (!this.currentAction) return;
    this.stopAction();
    this.resetPose();
  }

  /** Builds (and caches) the AnimationClip for `name` against the current VRM. */
  private clipFor(name: string): THREE.AnimationClip | null {
    if (!this.vrm) return null;

    const cached = this.clipCache.get(name);
    if (cached) return cached;

    const animation = this.registry.get(name);
    if (!animation) return null;

    const clip = createVRMAnimationClip(animation, this.vrm);
    this.clipCache.set(name, clip);
    return clip;
  }

  private stopAction(): void {
    if (this.currentAction) {
      this.currentAction.stop();
      this.mixer?.uncacheAction(this.currentAction.getClip());
    }
    this.currentAction = null;
    this.currentName = null;
    this.currentLoop = false;
  }

  /**
   * Returns the humanoid to its rest pose and zeroes the expressions a clip
   * might have driven, giving the procedural idle (or the next clip) a clean
   * base to take over from.
   */
  private resetPose(): void {
    if (!this.vrm) return;
    this.vrm.humanoid?.resetNormalizedPose();
    const expressions = this.vrm.expressionManager;
    if (expressions) {
      for (const name of RESET_EXPRESSIONS) expressions.setValue(name, 0);
    }
  }
}
