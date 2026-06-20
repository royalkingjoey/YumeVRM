import type { VRM } from '@pixiv/three-vrm';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import { IdleAnimation, MOOD_PARAMS } from './idleAnimation';
import { applyAction, ACTION_DURATIONS, ACTION_EXPRESSIONS, envelope } from './actions';
import { CustomAnimationPlayer } from './customAnimationPlayer';
import { GazeController } from './gazeController';
import { Spring } from './spring';
import { EMOTIONS, type EmotionName, type ActionName } from './expressionTypes';

/** Spring tuning for facial expression weights: a quick pop with a tiny cute overshoot. */
const FACE_STIFFNESS = 110;
const FACE_DAMPING = 14;

/** Expression weight while a temporary `[emotion:...]` override is active. */
const EMOTION_OVERRIDE_WEIGHT = 0.85;

/**
 * Per-emotion override weights; falls back to `EMOTION_OVERRIDE_WEIGHT`.
 * Happy reads strong at full weight, so it's dialled back to feel less manic.
 */
const EMOTION_OVERRIDE_WEIGHTS: Partial<Record<EmotionName, number>> = {
  happy: 0.5,
};

/**
 * A queued one-shot gesture: either a built-in procedural action or an
 * uploaded custom `.vrma` clip played once.
 */
type QueuedAction = { kind: 'builtin'; name: ActionName } | { kind: 'custom'; name: string };

export interface ExpressionState {
  demeanor: EmotionName;
  customDemeanor: string | null;
  emotionOverride: EmotionName | null;
  currentAction: string | null;
  queuedActions: string[];
}

/**
 * Ties together the idle animation, one-shot gesture actions, custom uploaded
 * `.vrma` animations, and VRM emotion expressions, driven by the companion's
 * `[demeanor:...]`, `[emotion:...]`, and `[action:...]` tags (see
 * `src/ai/expressionTags.ts`) as well as the developer panel.
 *
 * - `demeanor` shapes the idle loop's posture/energy and persists until
 *   `reset()` (chat memory cleared). A `customDemeanor` instead loops an
 *   uploaded clip, suspending the procedural idle while it's active.
 * - `emotionOverride` is a temporary expression that takes priority over the
 *   demeanor's default expression, until `clearEmotionOverride()` is called
 *   (typically when TTS playback for the reply finishes).
 * - Queued `actions` play one at a time. A built-in action blends its own
 *   pose/expression on top of the idle; a custom action plays its clip once,
 *   taking over the whole body for its duration.
 */
export class ExpressionController {
  private readonly idle = new IdleAnimation();
  private readonly gaze = new GazeController();
  private readonly custom = new CustomAnimationPlayer();
  private demeanor: EmotionName = 'neutral';
  private customDemeanor: string | null = null;
  private emotionOverride: EmotionName | null = null;
  private actionQueue: QueuedAction[] = [];
  private currentAction:
    | { kind: 'builtin'; name: ActionName; startedAt: number }
    | { kind: 'custom'; name: string }
    | null = null;

  /** Springy eased weight per non-neutral preset, so faces pop in with a slight bounce instead of snapping. */
  private readonly faceSprings = new Map<EmotionName, Spring>(
    EMOTIONS.filter((name) => name !== 'neutral').map(
      (name) => [name, new Spring(0, FACE_STIFFNESS, FACE_DAMPING)] as const,
    ),
  );

  captureRestPose(vrm: VRM): void {
    this.idle.captureRestPose(vrm);
    this.custom.setVrm(vrm);
  }

  resetVrm(vrm: VRM): void {
    this.idle.reset(vrm);
    this.gaze.reset();
    this.custom.setVrm(null);
    for (const [name, spring] of this.faceSprings) {
      spring.snap(0);
      vrm.expressionManager?.setValue(name, 0);
    }
  }

  // -- Custom animation registry -----------------------------------------

  /** Registers a parsed `.vrma` animation so it can be used as a custom action/demeanor. */
  registerCustomAnimation(name: string, animation: VRMAnimation): void {
    this.custom.register(name, animation);
  }

  /** Forgets a custom animation; falls back to procedural defaults if it was active. */
  unregisterCustomAnimation(name: string): void {
    this.custom.unregister(name);
    if (this.customDemeanor === name) this.customDemeanor = null;
  }

  hasCustomAnimation(name: string): boolean {
    return this.custom.has(name);
  }

  /** Sets a built-in procedural demeanor, leaving any custom-clip demeanor behind. */
  setDemeanor(name: EmotionName): void {
    this.demeanor = name;
    this.customDemeanor = null;
  }

  /** Switches the persistent idle to a looping custom `.vrma` clip. */
  setCustomDemeanor(name: string): void {
    this.customDemeanor = name;
  }

  getDemeanor(): EmotionName {
    return this.demeanor;
  }

  /** Sets a temporary expression that overrides the demeanor's default until `clearEmotionOverride()`. */
  triggerEmotion(name: EmotionName): void {
    this.emotionOverride = name;
  }

  clearEmotionOverride(): void {
    this.emotionOverride = null;
  }

  /** Queues a built-in one-shot gesture to play once any current/earlier ones finish. */
  queueAction(name: ActionName): void {
    this.actionQueue.push({ kind: 'builtin', name });
  }

  /** Queues an uploaded custom `.vrma` clip to play once, as a one-shot action. */
  queueCustomAction(name: string): void {
    this.actionQueue.push({ kind: 'custom', name });
  }

  /** Clears demeanor/emotion/action state back to defaults, e.g. when chat memory is cleared. */
  reset(): void {
    this.demeanor = 'neutral';
    this.customDemeanor = null;
    this.emotionOverride = null;
    this.actionQueue = [];
    this.currentAction = null;
    this.custom.stop();
  }

  getState(): ExpressionState {
    return {
      demeanor: this.demeanor,
      customDemeanor: this.customDemeanor,
      emotionOverride: this.emotionOverride,
      currentAction: this.currentAction?.name ?? null,
      queuedActions: this.actionQueue.map((action) => action.name),
    };
  }

  /** True while a one-shot gesture is playing or waiting to play, e.g. so callers can pause speech for it. */
  hasPendingOrActiveAction(): boolean {
    return this.currentAction !== null || this.actionQueue.length > 0;
  }

  update(vrm: VRM, delta: number, elapsed: number, isSpeaking = false): void {
    // Promote the next queued gesture once nothing is playing.
    if (!this.currentAction && this.actionQueue.length > 0) {
      const next = this.actionQueue.shift() as QueuedAction;
      this.currentAction =
        next.kind === 'builtin'
          ? { kind: 'builtin', name: next.name, startedAt: elapsed }
          : { kind: 'custom', name: next.name };
    }

    // Advance a built-in gesture and retire it once its fixed duration elapses.
    let builtinActionProgress: number | null = null;
    if (this.currentAction?.kind === 'builtin') {
      const duration = ACTION_DURATIONS[this.currentAction.name];
      const progress = duration > 0 ? (elapsed - this.currentAction.startedAt) / duration : 1;
      if (progress >= 1) this.currentAction = null;
      else builtinActionProgress = progress;
    }

    // A one-shot custom action takes priority over a looping custom demeanor;
    // either one suspends the procedural idle/gesture system while it plays.
    const customActionName = this.currentAction?.kind === 'custom' ? this.currentAction.name : null;
    const desiredCustom = customActionName ?? this.customDemeanor;
    let customActive = false;
    if (desiredCustom) {
      customActive = this.custom.play(desiredCustom, customActionName === null);
    } else if (this.custom.isPlaying()) {
      this.custom.stop();
    }

    // Retire a custom action that couldn't start or has played through, so it
    // never wedges the queue (a custom demeanor then resumes on the next frame).
    if (this.currentAction?.kind === 'custom' && (!customActive || this.custom.hasFinished())) {
      this.currentAction = null;
    }

    if (customActive) {
      // The clip owns the avatar's pose and expressions this frame.
      this.custom.update(delta);
      return;
    }

    this.idle.update(vrm, delta, elapsed, this.demeanor);

    if (this.currentAction?.kind === 'builtin' && builtinActionProgress !== null) {
      applyAction(vrm, this.currentAction.name, builtinActionProgress, this.idle.getRestPose());
    }

    this.gaze.update(vrm, delta, this.demeanor, isSpeaking);

    this.applyExpressionWeights(vrm, delta, builtinActionProgress);
  }

  /**
   * Eases every preset's weight toward the demeanor's resting face (or a
   * temporary emotion override) through underdamped springs, then lets an
   * active one-shot gesture push its own expression on top. Demeanors can
   * blend several presets at once — e.g. neutral keeps a subtle smile.
   */
  private applyExpressionWeights(vrm: VRM, delta: number, actionProgress: number | null): void {
    const expressions = vrm.expressionManager;
    if (!expressions) return;

    const builtinAction = this.currentAction?.kind === 'builtin' ? this.currentAction.name : null;

    // While a one-shot gesture plays, its own expression takes over and every
    // other preset eases back to neutral; the demeanor/emotion resumes once it ends.
    // A 'neutral' override maps to an empty face, easing everything back to baseline.
    const face: Partial<Record<EmotionName, number>> = builtinAction
      ? {}
      : this.emotionOverride
        ? {
            [this.emotionOverride]:
              EMOTION_OVERRIDE_WEIGHTS[this.emotionOverride] ?? EMOTION_OVERRIDE_WEIGHT,
          }
        : MOOD_PARAMS[this.demeanor].face;

    const action =
      builtinAction && actionProgress !== null ? ACTION_EXPRESSIONS[builtinAction] : null;
    const actionWeight = action && actionProgress !== null ? action.weight * envelope(actionProgress) : 0;

    for (const [name, spring] of this.faceSprings) {
      let weight = spring.update(face[name] ?? 0, delta);
      // Springs overshoot by design; keep the applied weight in range.
      weight = Math.min(1, Math.max(0, weight));
      if (action && action.name === name) weight = Math.max(weight, actionWeight);
      expressions.setValue(name, weight);
    }
  }
}
