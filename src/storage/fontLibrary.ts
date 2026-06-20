import { createAssetLibrary, type SavedAssetEntry } from './assetLibrary';

export type SavedFontEntry = SavedAssetEntry;

/**
 * Local library of uploaded fonts (assets/fonts/), used to render the AI
 * companion's chat responses in a custom typeface.
 */
const library = createAssetLibrary('fonts', 'vrm-viewer:last-used-font');

export const saveFontFile = library.saveFile;
export const listSavedFonts = library.listSaved;
export const loadSavedFont = library.loadSaved;
export const deleteSavedFont = library.deleteSaved;
export const setLastUsedFontId = library.setLastUsedId;
export const getLastUsedFontId = library.getLastUsedId;
export const clearLastUsedFontId = library.clearLastUsedId;
