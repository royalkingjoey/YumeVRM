import { createAssetLibrary, type SavedAssetEntry } from './assetLibrary';

export type SavedVrmEntry = SavedAssetEntry;

/**
 * Local library of previously uploaded VRM files, so users can re-load a
 * model from a dropdown instead of re-selecting it from disk.
 */
const library = createAssetLibrary('models', 'vrm-viewer:last-used');

export const saveVrmFile = library.saveFile;
export const listSavedVrms = library.listSaved;
export const loadSavedVrm = library.loadSaved;
export const deleteSavedVrm = library.deleteSaved;
export const setLastUsedVrmId = library.setLastUsedId;
export const getLastUsedVrmId = library.getLastUsedId;
export const clearLastUsedVrmId = library.clearLastUsedId;
