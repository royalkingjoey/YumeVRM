export interface SavedAssetEntry {
  /** Stable identifier — currently the file name. */
  id: string;
  name: string;
  size: number;
  savedAt: number;
}

interface AssetFileInfo {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface AssetLibrary {
  /** Saves (or overwrites) a file in the project's `assets/<subfolder>` folder. */
  saveFile(file: File): Promise<void>;
  /** Lists saved entries, most recently modified first. */
  listSaved(): Promise<SavedAssetEntry[]>;
  /** Loads a saved entry's data as a `File`. */
  loadSaved(id: string): Promise<File>;
  /** Removes a saved entry from the assets folder. */
  deleteSaved(id: string): Promise<void>;
  /** Remembers which entry was most recently used. */
  setLastUsedId(id: string): void;
  /** Returns the id of the last-used entry, if any was recorded. */
  getLastUsedId(): string | null;
  /** Clears the remembered last-used entry id. */
  clearLastUsedId(): void;
}

/**
 * Creates a library of files backed by a subfolder of the project's
 * `assets/` directory (`assets/<subfolder>/`), served via the dev/preview
 * server's `/api/assets/<subfolder>` endpoints (see `vite.config.ts`), plus
 * a `localStorage`-backed "last used" pointer so the app can re-select the
 * same entry on the next launch.
 *
 * Files are stored under their original name, so they remain visible and
 * usable directly from the OS file explorer inside the project folder.
 */
export function createAssetLibrary(subfolder: string, lastUsedKey: string): AssetLibrary {
  const baseUrl = `/api/assets/${subfolder}`;

  return {
    async saveFile(file) {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Failed to save "${file.name}" (${response.status}).`);
      }
    },

    async listSaved() {
      const response = await fetch(baseUrl);
      if (!response.ok) {
        throw new Error(`Failed to list saved files (${response.status}).`);
      }
      const files: AssetFileInfo[] = await response.json();
      return files
        .map((file) => ({ id: file.name, name: file.name, size: file.size, savedAt: file.mtimeMs }))
        .sort((a, b) => b.savedAt - a.savedAt);
    },

    async loadSaved(id) {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(id)}`);
      if (!response.ok) {
        throw new Error(`No saved entry found for "${id}".`);
      }
      const blob = await response.blob();
      return new File([blob], id, { type: blob.type });
    },

    async deleteSaved(id) {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(`Failed to delete "${id}" (${response.status}).`);
      }
    },

    setLastUsedId(id) {
      localStorage.setItem(lastUsedKey, id);
    },

    getLastUsedId() {
      return localStorage.getItem(lastUsedKey);
    },

    clearLastUsedId() {
      localStorage.removeItem(lastUsedKey);
    },
  };
}
