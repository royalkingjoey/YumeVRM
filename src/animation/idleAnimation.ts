import * as THREE from 'three';
import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { Spring } from './spring';
import { type EmotionName } from './expressionTypes';

/**
 * Per-demeanor tuning for the idle loop. Tuned for a bouncy, cute,
 * anime-girl presence — happier demeanors are springier and more open,
 * sadder/angrier ones are slower or tighter, and every demeanor keeps a
 * soft breathing/sway/blink loop running underneath.
 *
 * All numeric fields except the blink timing are blended through springs
 * when the demeanor changes, so posture shifts overshoot slightly and
 * settle with a bounce.
 */
interface MoodParams {
  /** Time scale of the general sway loop. */
  swaySpeed: number;
  /** Amplitude multiplier for head/body/arm sway. */
  swayAmount: number;
  /** Amplitude multiplier for the springy secondary bounce/jiggle terms. */
  bounce: number;
  /** Breathing rate multiplier (1 = one breath per ~3.4s). */
  breathSpeed: number;
  /** Breathing amplitude multiplier (chest rise, shoulder lift). */
  breathDepth: number;
  headTiltX: number;
  headTiltZ: number;
  /** How strongly the head bobs along with the breath cycle. */
  headBob: number;
  /** Added to the upper arms' rest Z rotation (positive = arms drawn in/down, negative = arms lift/open). */
  armZOffset: number;
  spineLean: number;
  /** Sassy resting hip tilt (tsundere hip-cock and the like). */
  hipTiltZ: number;
  /** Constant eyelid droop under the blink — 0 = wide open, ~0.3 = dreamy half-lidded. */
  eyelidDroop: number;
  /** 0-1 strength of the trembling-lip pout (sad only). */
  lipTremble: number;
  /** Multiplier on the pause between blinks (>1 blinks less often — wide surprised eyes). */
  blinkIntervalScale: number;
  /** How long one blink takes, in seconds (sleepy demeanors blink slower). */
  blinkDuration: number;
  /**
   * Resting facial expression: VRM 1.0 preset weights blended in while this
   * demeanor is active (e.g. neutral keeps a very subtle smile). Applied by
   * the ExpressionController with springy easing.
   */
  face: Partial<Record<EmotionName, number>>;
}

/** Mood params blended through springs on demeanor change (all numeric fields except blink timing). */
const SPRUNG_KEYS = [
  'swaySpeed',
  'swayAmount',
  'bounce',
  'breathSpeed',
  'breathDepth',
  'headTiltX',
  'headTiltZ',
  'headBob',
  'armZOffset',
  'spineLean',
  'hipTiltZ',
  'eyelidDroop',
  'lipTremble',
] as const;
type SprungKey = (typeof SPRUNG_KEYS)[number];
type SprungParams = Record<SprungKey, number>;

/** Captured rest rotations for the arm/hand bones gesture actions animate. */
export interface ArmRestPose {
  leftUpperArm: THREE.Euler;
  rightUpperArm: THREE.Euler;
  leftLowerArm: THREE.Euler;
  rightLowerArm: THREE.Euler;
  leftHand: THREE.Euler;
  rightHand: THREE.Euler;
}

export const MOOD_PARAMS: Record<EmotionName, MoodParams> = {
  // Soft, approachable default: gentle breathing, light bob, neutral resting face.
  neutral: {
    swaySpeed: 1, swayAmount: 1, bounce: 1, breathSpeed: 1, breathDepth: 1,
    headTiltX: 0, headTiltZ: 0.02, headBob: 1, armZOffset: 0, spineLean: 0,
    hipTiltZ: 0, eyelidDroop: 0, lipTremble: 0,
    blinkIntervalScale: 1, blinkDuration: 0.12,
    face: {},
  },
  // Bright joy: big smile, perky energy, but a gentle sway rather than a bounce.
  happy: {
    swaySpeed: 1.15, swayAmount: 1, bounce: 1.2, breathSpeed: 1.15, breathDepth: 1.1,
    headTiltX: 0, headTiltZ: 0, headBob: 1.1, armZOffset: -0.09, spineLean: 0.02,
    hipTiltZ: 0.015, eyelidDroop: 0, lipTremble: 0,
    blinkIntervalScale: 0.9, blinkDuration: 0.11,
    face: { happy: 0.55 },
  },
  // Tsundere pout, not menace: narrowed eyes, arms drawn in, hip cocked.
  angry: {
    swaySpeed: 1.15, swayAmount: 0.8, bounce: 1.25, breathSpeed: 1.25, breathDepth: 1.15,
    headTiltX: 0, headTiltZ: 0, headBob: 0.7, armZOffset: 0.14, spineLean: -0.03,
    hipTiltZ: 0.05, eyelidDroop: 0.12, lipTremble: 0,
    blinkIntervalScale: 0.85, blinkDuration: 0.1,
    face: { angry: 0.55 },
  },
  // Teary-soft: head down, droopy lids, slow shallow breaths, quivering lip.
  sad: {
    swaySpeed: 0.55, swayAmount: 0.6, bounce: 0.35, breathSpeed: 0.75, breathDepth: 0.8,
    headTiltX: 0.17, headTiltZ: 0.04, headBob: 0.4, armZOffset: 0.1, spineLean: 0.06,
    hipTiltZ: 0, eyelidDroop: 0.18, lipTremble: 1,
    blinkIntervalScale: 1.4, blinkDuration: 0.18,
    face: { sad: 0.7 },
  },
  // Dreamy contentment: half-lidded eyes, gentle smile, slow deep breathing.
  relaxed: {
    swaySpeed: 0.7, swayAmount: 0.95, bounce: 0.6, breathSpeed: 0.7, breathDepth: 1.35,
    headTiltX: 0, headTiltZ: 0, headBob: 0.6, armZOffset: -0.05, spineLean: 0.025,
    hipTiltZ: 0.03, eyelidDroop: 0.3, lipTremble: 0,
    blinkIntervalScale: 1.3, blinkDuration: 0.18,
    face: { relaxed: 0.35, happy: 0.12 },
  },
  // Classic anime "eek!": wide unblinking eyes, quick breaths, otherwise held still.
  surprised: {
    swaySpeed: 1.1, swayAmount: 0.8, bounce: 1, breathSpeed: 1.2, breathDepth: 1,
    headTiltX: 0, headTiltZ: 0, headBob: 0.7, armZOffset: -0.05, spineLean: -0.04,
    hipTiltZ: 0, eyelidDroop: 0, lipTremble: 0,
    blinkIntervalScale: 2.2, blinkDuration: 0.09,
    face: { surprised: 0.8 },
  },
};

/** Baseline breathing angular speed: one breath per ~3.4 seconds at breathSpeed 1. */
const BREATH_RATE = (Math.PI * 2) / 3.4;

/** Spring tuning for demeanor posture transitions — quick, with a light overshoot. */
const MOOD_STIFFNESS = 70;
const MOOD_DAMPING = 11;

/** How long the one-shot entry flourish plays after a demeanor change. */
const FLOURISH_DURATION = 1.3;

/**
 * Drives a continuous, lively "alive" idle loop for a loaded VRM: breathing
 * (chest/spine scale + rise), head sway and bob, a weight-shift sway through
 * the hips/spine, soft blinking (with cute double-blinks and half-lidded
 * states), and arm drift — all shaped by the current `demeanor` (one of the
 * VRM 1.0 emotion presets).
 *
 * On top of the base loop:
 * - Demeanor changes blend through underdamped springs, so the new posture
 *   arrives with a bouncy overshoot instead of a snap, and play a short
 *   mood-specific entry flourish (e.g. a startled flinch for surprised).
 *
 * All motion is additive on top of the VRM's bind pose / current pose, and
 * the resulting head/body impulses keep spring-bone hair and clothing
 * physics (simulated by `vrm.update`) gently jiggling for free.
 *
 * To extend: add another `applyX(...)` method and call it from `update`.
 * Each helper should be self-contained aside from the bones it owns.
 */
export class IdleAnimation {
  /** Per-instance random offset so multiple avatars don't move in lockstep. */
  private readonly seed = Math.random() * Math.PI * 2;

  /** Integrated sway/breath phases — advanced by the sprung speeds each frame,
   * so a demeanor's different tempo glides in instead of jumping phase. */
  private phase = this.seed;
  private breathPhase = this.seed;

  private nextBlinkAt = 0;
  private blinkProgress = 1; // 1 = eyes fully open / blink complete
  private blinkDuration = MOOD_PARAMS.neutral.blinkDuration;
  private lastBlinkWasDouble = false;

  private lastMood: EmotionName | null = null;
  private moodChangedAt = -Infinity;

  private readonly springs: Record<SprungKey, Spring> = Object.fromEntries(
    SPRUNG_KEYS.map((key) => [key, new Spring(MOOD_PARAMS.neutral[key], MOOD_STIFFNESS, MOOD_DAMPING)]),
  ) as Record<SprungKey, Spring>;

  /** Scratch object the sprung params are written into each frame (no per-frame allocation). */
  private readonly current: SprungParams = Object.fromEntries(
    SPRUNG_KEYS.map((key) => [key, MOOD_PARAMS.neutral[key]]),
  ) as SprungParams;

  /** Hips rest position, captured on first update so the breathing bob can
   * be applied as an offset rather than overwriting the bind pose. */
  private hipsRestY: number | null = null;

  /** Arm/hand rest rotations (e.g. from `applyNaturalRestPose`), captured via
   * `captureRestPose` so arm sway and gesture actions can be layered on top
   * of the relaxed stance instead of overwriting it back to a T-pose, and so
   * gestures can return exactly to rest when they finish. */
  private restPose: ArmRestPose | null = null;

  /**
   * Records the current arm/hand rotations as the "rest" pose. Call this
   * once after applying a static rest pose (e.g. `applyNaturalRestPose`) and
   * before the first `update`.
   */
  captureRestPose(vrm: VRM): void {
    const get = (name: VRMHumanBoneName) =>
      vrm.humanoid?.getNormalizedBoneNode(name)?.rotation.clone() ?? new THREE.Euler();

    this.restPose = {
      leftUpperArm: get(VRMHumanBoneName.LeftUpperArm),
      rightUpperArm: get(VRMHumanBoneName.RightUpperArm),
      leftLowerArm: get(VRMHumanBoneName.LeftLowerArm),
      rightLowerArm: get(VRMHumanBoneName.RightLowerArm),
      leftHand: get(VRMHumanBoneName.LeftHand),
      rightHand: get(VRMHumanBoneName.RightHand),
    };
  }

  /** The captured arm/hand rest pose, or all-zero rotations if not yet captured. */
  getRestPose(): ArmRestPose {
    return (
      this.restPose ?? {
        leftUpperArm: new THREE.Euler(),
        rightUpperArm: new THREE.Euler(),
        leftLowerArm: new THREE.Euler(),
        rightLowerArm: new THREE.Euler(),
        leftHand: new THREE.Euler(),
        rightHand: new THREE.Euler(),
      }
    );
  }

  /** @param mood The active demeanor (VRM 1.0 emotion preset) shaping posture and energy. */
  update(vrm: VRM, delta: number, elapsed: number, mood: EmotionName = 'neutral'): void {
    const target = MOOD_PARAMS[mood];

    if (mood !== this.lastMood) {
      // No flourish on the very first frame — that's the initial pose, not a mood switch.
      this.moodChangedAt = this.lastMood === null ? -Infinity : elapsed;
      this.lastMood = mood;
    }

    const p = this.current;
    for (const key of SPRUNG_KEYS) {
      p[key] = this.springs[key].update(target[key], delta);
    }

    this.phase += delta * p.swaySpeed;
    this.breathPhase += delta * p.breathSpeed * BREATH_RATE;

    this.applyBreathing(vrm, p);
    this.applyHeadSway(vrm, p);
    this.applyBodySway(vrm, p);
    this.applyArmSway(vrm, p);
    this.applyEntryFlourish(vrm, elapsed - this.moodChangedAt, mood);
    this.applyBlink(vrm, delta, elapsed, target, p);
    this.applyLipTremble(vrm, elapsed, p);
  }

  private bone(vrm: VRM, name: VRMHumanBoneName): THREE.Object3D | null {
    return vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  }

  /** Gentle chest expansion and shoulder rise synced to the breathing cycle. */
  private applyBreathing(vrm: VRM, p: SprungParams): void {
    const breathCycle = Math.sin(this.breathPhase);
    const chest = this.bone(vrm, VRMHumanBoneName.Chest);
    const spine = this.bone(vrm, VRMHumanBoneName.Spine);

    if (chest) {
      chest.rotation.x = breathCycle * 0.028 * p.breathDepth;
      chest.rotation.y = 0;
      chest.scale.setScalar(1 + breathCycle * 0.014 * p.breathDepth);
    }

    if (spine) {
      spine.rotation.x = breathCycle * 0.013 * p.breathDepth;
    }

    const leftShoulder = this.bone(vrm, VRMHumanBoneName.LeftShoulder);
    const rightShoulder = this.bone(vrm, VRMHumanBoneName.RightShoulder);
    const shoulderRise = breathCycle * 0.012 * p.breathDepth;
    if (leftShoulder) leftShoulder.rotation.z = -shoulderRise;
    if (rightShoulder) rightShoulder.rotation.z = shoulderRise;
  }

  /** Head sway, a breath-synced bob, and the demeanor's resting tilt. */
  private applyHeadSway(vrm: VRM, p: SprungParams): void {
    const head = this.bone(vrm, VRMHumanBoneName.Head);
    const neck = this.bone(vrm, VRMHumanBoneName.Neck);
    if (!head) return;

    const t = this.phase;
    // Slight downward nod-and-release, a beat behind the breathing bounce.
    const bobCycle = Math.sin(this.breathPhase - 0.6);
    const swayX = Math.sin(t * 0.6) * 0.045 * p.swayAmount + bobCycle * 0.022 * p.headBob;
    const swayY = Math.sin(t * 0.27 + 1.3) * 0.08 * p.swayAmount;
    // Head tilts gently opposite the hip weight-shift for a graceful,
    // counter-balanced look, plus a faster micro-wobble that keeps
    // spring-bone hair physics gently excited.
    const tiltZ =
      (Math.sin(t * 0.18 + Math.PI) * 0.05 + Math.sin(t * 0.35 + 0.5) * 0.018) * p.swayAmount +
      Math.sin(t * 1.1 + 0.9) * 0.008 * p.bounce;

    head.rotation.x = swayX + p.headTiltX;
    head.rotation.y = swayY;
    head.rotation.z = tiltZ + p.headTiltZ;

    if (neck) {
      neck.rotation.x = swayX * 0.4 + p.headTiltX * 0.3;
      neck.rotation.y = swayY * 0.4;
      neck.rotation.z = tiltZ * 0.3 + p.headTiltZ * 0.3;
    }
  }

  /** Weight-shift sway through hips and spine, with springy secondary bounce and a mood-driven lean. */
  private applyBodySway(vrm: VRM, p: SprungParams): void {
    const hips = this.bone(vrm, VRMHumanBoneName.Hips);
    const spine = this.bone(vrm, VRMHumanBoneName.Spine);

    const t = this.phase;
    const swayCycle = Math.sin(t * 0.18);
    // A slightly faster echo of the breathing cycle for a springy,
    // jiggly follow-through feel, expressed as rotation only (no vertical
    // hip movement, so the model never appears to hop).
    const bounceCycle = Math.sin(this.breathPhase * 1.6 - 0.4);

    if (hips) {
      if (this.hipsRestY === null) {
        this.hipsRestY = hips.position.y;
      }
      hips.rotation.z = swayCycle * 0.04 * p.swayAmount + p.hipTiltZ;
      hips.position.y = this.hipsRestY;
    }

    if (spine) {
      spine.rotation.z =
        -swayCycle * 0.02 * p.swayAmount +
        bounceCycle * 0.008 * p.bounce +
        Math.sin(t * 0.85 + 2.1) * 0.006 * p.bounce;
      spine.rotation.y = Math.sin(t * 0.13 + 0.8) * 0.02 * p.swayAmount;
      // Added on top of the breathing tilt set in applyBreathing.
      spine.rotation.x += bounceCycle * 0.01 * p.bounce + p.spineLean;
    }
  }

  /** Tiny independent arm drift, layered on top of the relaxed rest pose plus a mood-driven offset. */
  private applyArmSway(vrm: VRM, p: SprungParams): void {
    const leftUpperArm = this.bone(vrm, VRMHumanBoneName.LeftUpperArm);
    const rightUpperArm = this.bone(vrm, VRMHumanBoneName.RightUpperArm);
    const restPose = this.getRestPose();
    const leftRest = restPose.leftUpperArm;
    const rightRest = restPose.rightUpperArm;

    const t = this.phase;
    if (leftUpperArm) {
      leftUpperArm.rotation.z = leftRest.z - p.armZOffset + Math.sin(t * 0.5 + 1.0) * 0.02 * p.swayAmount;
      leftUpperArm.rotation.x = leftRest.x + Math.sin(t * 0.4) * 0.014 * p.swayAmount;
    }
    if (rightUpperArm) {
      rightUpperArm.rotation.z = rightRest.z + p.armZOffset - Math.sin(t * 0.5 + 2.0) * 0.02 * p.swayAmount;
      rightUpperArm.rotation.x = rightRest.x + Math.sin(t * 0.4 + 1.5) * 0.014 * p.swayAmount;
    }
  }

  /**
   * Short one-shot animation right after a demeanor change, giving the
   * switch a readable, bouncy "anime beat" — e.g. surprised recoils sharply
   * then springs back. All offsets decay to ~zero by FLOURISH_DURATION.
   */
  private applyEntryFlourish(vrm: VRM, ts: number, mood: EmotionName): void {
    if (!(ts >= 0) || ts > FLOURISH_DURATION) return;

    const head = this.bone(vrm, VRMHumanBoneName.Head);
    const neck = this.bone(vrm, VRMHumanBoneName.Neck);
    const spine = this.bone(vrm, VRMHumanBoneName.Spine);
    const chest = this.bone(vrm, VRMHumanBoneName.Chest);
    const leftShoulder = this.bone(vrm, VRMHumanBoneName.LeftShoulder);
    const rightShoulder = this.bone(vrm, VRMHumanBoneName.RightShoulder);

    const decay = Math.exp(-3.2 * ts);

    switch (mood) {
      case 'surprised': {
        // Brief pull-back at full amplitude on frame one, then a springy
        // oscillating recovery — a quick startled flinch, not a flail.
        const recoil = Math.cos(ts * 13) * decay;
        if (head) head.rotation.x -= recoil * 0.08;
        if (neck) neck.rotation.x -= recoil * 0.03;
        if (spine) spine.rotation.x -= recoil * 0.025;
        if (leftShoulder) leftShoulder.rotation.z -= recoil * 0.035;
        if (rightShoulder) rightShoulder.rotation.z += recoil * 0.035;
        break;
      }
      case 'happy': {
        // Excited little double-bounce with a head waggle.
        const bounce = Math.abs(Math.sin(ts * 9)) * decay;
        if (spine) spine.rotation.x += bounce * 0.045;
        if (head) {
          head.rotation.x += bounce * 0.03;
          head.rotation.z += Math.sin(ts * 9) * decay * 0.05;
        }
        break;
      }
      case 'angry': {
        // Quick "hmph!" head shake while the chin dips into the pout.
        if (head) {
          head.rotation.y += Math.sin(ts * 19) * decay * 0.07;
          head.rotation.x += decay * 0.04;
        }
        break;
      }
      case 'sad': {
        // One soft deflating exhale: shoulders drop, head sinks, then settles.
        const dip = Math.sin(Math.min(ts / FLOURISH_DURATION, 1) * Math.PI);
        if (head) head.rotation.x += dip * 0.05;
        if (chest) chest.rotation.x += dip * 0.03;
        if (leftShoulder) leftShoulder.rotation.z += dip * 0.05;
        if (rightShoulder) rightShoulder.rotation.z -= dip * 0.05;
        break;
      }
      default: {
        // neutral / relaxed: a soft, barely-there settle bounce.
        if (spine) spine.rotation.x += Math.sin(ts * 7) * decay * 0.018;
        if (head) head.rotation.z += Math.sin(ts * 7 + 0.5) * decay * 0.015;
        break;
      }
    }
  }

  /**
   * Natural blinking with per-demeanor pacing: occasional cute double-blinks,
   * slower sleepy blinks when relaxed/sad, and a constant eyelid droop that
   * gives half-lidded dreamy or narrowed tsundere eyes.
   */
  private applyBlink(
    vrm: VRM,
    delta: number,
    elapsed: number,
    target: MoodParams,
    p: SprungParams,
  ): void {
    const expressions = vrm.expressionManager;
    if (!expressions) return;

    if (elapsed >= this.nextBlinkAt && this.blinkProgress >= 1) {
      this.blinkProgress = 0;
      this.blinkDuration = target.blinkDuration;
    }

    let close = 0;
    if (this.blinkProgress < 1) {
      this.blinkProgress = Math.min(1, this.blinkProgress + delta / this.blinkDuration);

      // Triangle wave: 0 -> 1 -> 0 across the blink duration.
      close = 1 - Math.abs(this.blinkProgress * 2 - 1);

      if (this.blinkProgress >= 1) {
        if (!this.lastBlinkWasDouble && Math.random() < 0.22) {
          // Cute anime double-blink: a second blink right on the heels of the first.
          this.lastBlinkWasDouble = true;
          this.nextBlinkAt = elapsed + 0.15;
        } else {
          this.lastBlinkWasDouble = false;
          this.nextBlinkAt = elapsed + (2.5 + Math.random() * 3.5) * target.blinkIntervalScale;
        }
      }
    }

    // The droop sits under the blink, so half-lidded eyes still blink fully shut.
    const droop = Math.min(0.6, Math.max(0, p.eyelidDroop));
    expressions.setValue('blink', droop + close * (1 - droop));
  }

  /** Tiny quivering pout on the 'ou' viseme while sad (lip-sync only drives 'aa'). */
  private applyLipTremble(vrm: VRM, elapsed: number, p: SprungParams): void {
    const expressions = vrm.expressionManager;
    if (!expressions) return;

    if (p.lipTremble < 0.01) {
      expressions.setValue('ou', 0);
      return;
    }

    const quiver = 0.05 + Math.sin(elapsed * 9) * 0.02 + Math.sin(elapsed * 23) * 0.015;
    expressions.setValue('ou', Math.max(0, quiver) * p.lipTremble);
  }

  /** Resets bone rotations/scales this animation drives back to identity. */
  reset(vrm: VRM): void {
    const bones: VRMHumanBoneName[] = [
      VRMHumanBoneName.Hips,
      VRMHumanBoneName.Spine,
      VRMHumanBoneName.Chest,
      VRMHumanBoneName.Neck,
      VRMHumanBoneName.Head,
      VRMHumanBoneName.LeftShoulder,
      VRMHumanBoneName.RightShoulder,
      VRMHumanBoneName.LeftUpperArm,
      VRMHumanBoneName.RightUpperArm,
      VRMHumanBoneName.LeftLowerArm,
      VRMHumanBoneName.RightLowerArm,
      VRMHumanBoneName.LeftHand,
      VRMHumanBoneName.RightHand,
      VRMHumanBoneName.LeftEye,
      VRMHumanBoneName.RightEye,
      VRMHumanBoneName.LeftFoot,
      VRMHumanBoneName.RightFoot,
    ];

    for (const boneName of bones) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(boneName);
      if (!bone) continue;
      bone.rotation.set(0, 0, 0);
      bone.scale.set(1, 1, 1);
    }

    const hips = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips);
    if (hips && this.hipsRestY !== null) {
      hips.position.y = this.hipsRestY;
    }

    vrm.expressionManager?.setValue('blink', 0);
    vrm.expressionManager?.setValue('ou', 0);

    this.blinkProgress = 1;
    this.nextBlinkAt = 0;
    this.lastBlinkWasDouble = false;
    this.hipsRestY = null;
    this.restPose = null;
    this.lastMood = null;
    this.moodChangedAt = -Infinity;
    for (const key of SPRUNG_KEYS) {
      this.springs[key].snap(MOOD_PARAMS.neutral[key]);
    }
  }
}
