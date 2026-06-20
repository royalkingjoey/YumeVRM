import { createAssetLibrary, type SavedAssetEntry } from './assetLibrary';

export type SavedBackgroundEntry = SavedAssetEntry;

/**
 * Local library of previously uploaded background images, so users can
 * re-apply a background from a dropdown instead of re-selecting the file.
 */
const library = createAssetLibrary('backgrounds', 'vrm-viewer:last-used-background');

export const saveBackgroundFile = library.saveFile;
export const listSavedBackgrounds = library.listSaved;
export const loadSavedBackground = library.loadSaved;
export const deleteSavedBackground = library.deleteSaved;
export const setLastUsedBackgroundId = library.setLastUsedId;
export const getLastUsedBackgroundId = library.getLastUsedId;
export const clearLastUsedBackgroundId = library.clearLastUsedId;
