import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';

/**
 * Many VRM models load in a T-pose (arms held straight out horizontally).
 * This relaxes the upper/lower arms down to the sides for a natural
 * standing stance, which the idle animation then layers subtle motion on
 * top of.
 *
 * The rotation amounts are tuned for typical VRM humanoid bone axes (arms
 * extend along +/-X in the bind pose) and work well across most models.
 * Adjust `UPPER_ARM_DROP` / `LOWER_ARM_BEND` if a particular model still
 * looks stiff or over-rotated.
 */
const UPPER_ARM_DROP = 1.3; // ~74 degrees: brings arms from horizontal down to near the sides
const LOWER_ARM_BEND = 0.15; // ~8.6 degrees: slight elbow bend so arms don't look ramrod straight
const HAND_RELAX = 0.1; // ~5.7 degrees: slight wrist relaxation

export function applyNaturalRestPose(vrm: VRM): void {
  const humanoid = vrm.humanoid;
  if (!humanoid) return;

  const leftUpperArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
  const rightUpperArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
  const leftLowerArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm);
  const rightLowerArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);

  if (leftUpperArm) leftUpperArm.rotation.z = -UPPER_ARM_DROP;
  if (rightUpperArm) rightUpperArm.rotation.z = UPPER_ARM_DROP;
  if (leftLowerArm) leftLowerArm.rotation.z = -LOWER_ARM_BEND;
  if (rightLowerArm) rightLowerArm.rotation.z = LOWER_ARM_BEND;

  const leftHand = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftHand);
  const rightHand = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightHand);
  if (leftHand) leftHand.rotation.z = -HAND_RELAX;
  if (rightHand) rightHand.rotation.z = HAND_RELAX;
}
