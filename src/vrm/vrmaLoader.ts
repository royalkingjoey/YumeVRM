import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation';

/**
 * Loads the first VRM Animation from a local `.vrma` Blob/File (e.g. from a
 * file input or the saved-animation library) and returns the parsed
 * {@link VRMAnimation}, ready to be turned into an AnimationClip for a given
 * VRM via `createVRMAnimationClip`.
 *
 * A `.vrma` file is a glTF carrying a `VRMC_vrm_animation` extension; the
 * GLTFLoader is created fresh per call so the plugin's internal state never
 * leaks between loads. Throws if the file contains no VRM animation.
 */
export async function loadVrmAnimationFromFile(file: Blob): Promise<VRMAnimation> {
  const url = URL.createObjectURL(file);

  try {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    const gltf = await loader.loadAsync(url);
    const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;

    if (!animations || animations.length === 0) {
      throw new Error('The selected file does not contain a VRM animation.');
    }

    return animations[0];
  } finally {
    URL.revokeObjectURL(url);
  }
}
