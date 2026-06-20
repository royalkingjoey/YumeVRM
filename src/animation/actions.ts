import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import type { ArmRestPose } from './idleAnimation';
import type { ActionName, EmotionName } from './expressionTypes';

/** How long each one-shot gesture plays for, in seconds. */
export const ACTION_DURATIONS: Record<ActionName, number> = {
  laugh: 1.8,
  wink: 0.7,
};

/** The emotion expression (and weight) each gesture blends in while it plays. */
export const ACTION_EXPRESSIONS: Record<ActionName, { name: EmotionName; weight: number }> = {
  laugh: { name: 'happy', weight: 1 },
  wink: { name: 'happy', weight: 0.5 },
};

/** Smooth in-out envelope: 0 at the start/end of the gesture, 1 at its midpoint. */
export function envelope(progress: number): number {
  return Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI);
}

/**
 * Applies a one-shot gesture pose for `name` at `progress` (0-1 across the
 * gesture's duration), additively on top of whatever the idle animation has
 * already set this frame.
 */
export function applyAction(vrm: VRM, name: ActionName, progress: number, rest: ArmRestPose): void {
  switch (name) {
    case 'laugh':
      applyLaugh(vrm, progress, rest);
      break;
    case 'wink':
      applyWink(vrm, progress);
      break;
  }
}

function bone(vrm: VRM, name: VRMHumanBoneName) {
  return vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
}

/** Hunches forward in a bubbly chuckle, shoulders bouncing, both arms left at rest. */
function applyLaugh(vrm: VRM, progress: number, _rest: ArmRestPose): void {
  const e = envelope(progress);
  const spine = bone(vrm, VRMHumanBoneName.Spine);
  const chest = bone(vrm, VRMHumanBoneName.Chest);
  const head = bone(vrm, VRMHumanBoneName.Head);

  const giggle = Math.sin(progress * Math.PI * 9);

  if (spine) spine.rotation.x += e * 0.16 + giggle * e * 0.02;
  if (chest) chest.rotation.x += e * 0.1;
  if (head) {
    head.rotation.x += e * 0.12 + giggle * e * 0.03;
    head.rotation.z += giggle * e * 0.02;
  }

  vrm.expressionManager?.setValue('blink', e * 0.7);
}

/** A quick, playful one-eyed wink with a small head tilt. */
function applyWink(vrm: VRM, progress: number): void {
  const e = envelope(progress);
  const head = bone(vrm, VRMHumanBoneName.Head);

  if (head) {
    head.rotation.z += e * 0.1;
    head.rotation.y -= e * 0.06;
  }

  vrm.expressionManager?.setValue('blinkRight', e);
}
