import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

/**
 * Loads a VRM model from a local Blob/File (e.g. from a file input or the
 * local saved-model library) and returns the parsed VRM instance, ready to
 * be added to a scene.
 *
 * The GLTFLoader is created fresh per call so the VRMLoaderPlugin's internal
 * state never leaks between loads.
 */
export async function loadVrmFromFile(file: Blob): Promise<VRM> {
  const url = URL.createObjectURL(file);

  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM | undefined;

    if (!vrm) {
      throw new Error('The selected file does not contain valid VRM data.');
    }

    // Recommended cleanup: combine skeletons and remove unused joints/meshes
    // to reduce draw calls and memory footprint.
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.combineMorphs(vrm);

    // VRM models commonly face -Z (away from the default camera). Rotate the
    // root so the model faces the camera at +Z.
    VRMUtils.rotateVRM0(vrm);

    vrm.scene.traverse((object) => {
      object.frustumCulled = false;
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });

    return vrm;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Fully disposes of a VRM's GPU resources (geometries, materials, textures)
 * and removes it from its parent. Call this before loading a replacement
 * model to avoid leaking memory across repeated uploads.
 */
export function disposeVrm(vrm: VRM): void {
  vrm.scene.removeFromParent();
  VRMUtils.deepDispose(vrm.scene);
}
