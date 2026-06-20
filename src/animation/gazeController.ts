import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import type { EmotionName } from './expressionTypes';

/** Demeanors during which the avatar keeps her eyes to herself rather than tracking the cursor. */
const NO_GAZE_DEMEANORS: ReadonlySet<EmotionName> = new Set(['sad', 'angry', 'surprised']);

/** Maximum eye rotation, in radians — small enough to read as a glance, not a stare. */
const MAX_YAW = 0.08;
const MAX_PITCH = 0.05;

/** Maximum head rotation, in radians — a gentle, noticeable turn layered on top of the idle pose. */
const MAX_HEAD_YAW = 0.09;
const MAX_HEAD_PITCH = 0.06;

/** How quickly the gaze eases toward (or away from) its target, in 1/seconds. */
const EASE_SPEED = 6;

/** Eye-dart (saccade) tuning: small, quick glances layered on the cursor gaze. */
const DART_MAX_YAW = 0.06;
const DART_MAX_PITCH = 0.035;
/** Saccades are much faster than cursor tracking. */
const DART_EASE_SPEED = 18;

/**
 * Subtly turns the avatar's eyes toward the mouse cursor, so she feels aware
 * of the viewer without being unsettling, with occasional quick eye-dart
 * saccades (eyes only — the head doesn't follow) for a lively, thoughtful
 * look. Disabled while speaking or while showing a demeanor that should keep
 * its eyes to itself (sad/angry/surprised), in which case the eyes ease back
 * to their resting forward gaze.
 */
export class GazeController {
  private pointerX = 0;
  private pointerY = 0;
  private yaw = 0;
  private pitch = 0;
  private headYaw = 0;
  private headPitch = 0;

  /** Internal clock for scheduling darts (accumulated from `delta`). */
  private time = 0;
  private nextDartAt = 1.5;
  private dartEndAt = 0;
  private dartYaw = 0;
  private dartPitch = 0;
  private dartCurYaw = 0;
  private dartCurPitch = 0;

  constructor() {
    window.addEventListener('pointermove', this.handlePointerMove);
  }

  private handlePointerMove = (event: PointerEvent): void => {
    this.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
  };

  update(vrm: VRM, delta: number, demeanor: EmotionName, isSpeaking: boolean): void {
    const enabled = !isSpeaking && !NO_GAZE_DEMEANORS.has(demeanor);

    // Occasionally glance somewhere small and random, hold briefly, then return.
    this.time += delta;
    if (this.time >= this.nextDartAt) {
      this.dartYaw = (Math.random() * 2 - 1) * DART_MAX_YAW;
      this.dartPitch = (Math.random() * 2 - 1) * DART_MAX_PITCH;
      this.dartEndAt = this.time + 0.25 + Math.random() * 0.55;
      this.nextDartAt = this.time + 1.6 + Math.random() * 3.2;
    }
    const dartActive = enabled && this.time < this.dartEndAt;
    const dartEase = Math.min(1, delta * DART_EASE_SPEED);
    this.dartCurYaw += ((dartActive ? this.dartYaw : 0) - this.dartCurYaw) * dartEase;
    this.dartCurPitch += ((dartActive ? this.dartPitch : 0) - this.dartCurPitch) * dartEase;

    const targetYaw = enabled ? this.pointerX * MAX_YAW : 0;
    const targetPitch = enabled ? this.pointerY * MAX_PITCH : 0;

    const targetHeadYaw = enabled ? this.pointerX * MAX_HEAD_YAW : 0;
    const targetHeadPitch = enabled ? this.pointerY * MAX_HEAD_PITCH : 0;

    const ease = Math.min(1, delta * EASE_SPEED);
    this.yaw += (targetYaw - this.yaw) * ease;
    this.pitch += (targetPitch - this.pitch) * ease;
    this.headYaw += (targetHeadYaw - this.headYaw) * ease;
    this.headPitch += (targetHeadPitch - this.headPitch) * ease;

    const leftEye = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftEye);
    const rightEye = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightEye);
    const head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);

    if (leftEye) {
      leftEye.rotation.y = this.yaw + this.dartCurYaw;
      leftEye.rotation.x = this.pitch + this.dartCurPitch;
    }
    if (rightEye) {
      rightEye.rotation.y = this.yaw + this.dartCurYaw;
      rightEye.rotation.x = this.pitch + this.dartCurPitch;
    }
    if (head) {
      // Layered on top of the idle animation's head pose, set earlier this frame.
      head.rotation.y += this.headYaw;
      head.rotation.x += this.headPitch;
    }
  }

  /** Resets the tracked gaze back to center, e.g. when a new VRM is loaded. */
  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.dartCurYaw = 0;
    this.dartCurPitch = 0;
    this.dartEndAt = 0;
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.handlePointerMove);
  }
}
