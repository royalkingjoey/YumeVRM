import { createAssetLibrary, type SavedAssetEntry } from './assetLibrary';

export type SavedAnimationEntry = SavedAssetEntry;

/**
 * Local library of uploaded VRM Animation (`.vrma`) files (assets/animations/),
 * used as custom one-shot actions and looping demeanors alongside the
 * built-in procedural ones.
 */
const library = createAssetLibrary('animations', 'vrm-viewer:last-used-animation');

export const saveAnimationFile = library.saveFile;
export const listSavedAnimations = library.listSaved;
export const loadSavedAnimation = library.loadSaved;
export const deleteSavedAnimation = library.deleteSaved;
