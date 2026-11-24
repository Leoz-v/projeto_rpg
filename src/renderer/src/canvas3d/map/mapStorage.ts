/**
 * Map persistence client:
 *  - Primary: disk-backed `/local-maps` API (saves `.vttmap.json` files inside `maps/`)
 *  - Automatic fallback: browser `localStorage` when opened without the Vite middleware
 *  - Direct local disk open/save via File System Access API (`showOpenFilePicker` / `showSaveFilePicker`)
 *    so opened `.vttmap.json` files can be saved back in-place without prompting "Save As"
 *  - Fallback file download / `<input type="file">` upload for browsers without File System Access API
 */

import {
  parseMapDocument,
  sanitizeMapId,
  type SavedMapSummary,
  type VttMapDocument,
} from './mapDocument';

const BROWSER_STORAGE_PREFIX = 'vtt3d_map:';

export interface MapFileWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface MapFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<MapFileWritable>;
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

export type MapSaveTarget =
  | {
      kind: 'storage';
      id: string;
      storage: 'disk' | 'browser';
    }
  | {
      kind: 'file_handle';
      handle: MapFileHandle;
      fileName: string;
    };

interface FilePickerWindow {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<MapFileHandle[]>;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    excludeAcceptAllOption?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<MapFileHandle>;
}

const VTT_MAP_PICKER_TYPES = [
  {
    description: 'VTT 3D Map (.vttmap.json)',
    accept: { 'application/json': ['.vttmap.json', '.json'] },
  },
];

export function supportsOpenFilePicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as FilePickerWindow).showOpenFilePicker === 'function';
}

export function supportsSaveFilePicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as FilePickerWindow).showSaveFilePicker === 'function';
}

export function describeSaveTarget(target: MapSaveTarget | null): string {
  if (!target) return 'Unsaved';
  if (target.kind === 'file_handle') return target.fileName;
  return target.storage === 'disk' ? `maps/${target.id}.vttmap.json` : `browser:${target.id}`;
}

function listBrowserFallbackMaps(): SavedMapSummary[] {
  const results: SavedMapSummary[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(BROWSER_STORAGE_PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const doc = parseMapDocument(JSON.parse(raw));
        results.push({
          id: doc.id,
          name: doc.name,
          width: doc.terrain.width,
          length: doc.terrain.length,
          propCount: doc.props.length,
          updatedAt: doc.updatedAt,
          storage: 'browser',
        });
      } catch {
        // Ignore corrupted entry
      }
    }
  } catch {
    // localStorage unavailable
  }
  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return results;
}

export async function listSavedMaps(): Promise<SavedMapSummary[]> {
  try {
    const res = await fetch('/local-maps');
    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as { maps?: SavedMapSummary[] };
        if (Array.isArray(data.maps)) {
          return data.maps.map((m) => ({ ...m, storage: 'disk' as const }));
        }
      }
    }
  } catch {
    // Fall back to browser storage
  }
  return listBrowserFallbackMaps();
}

export async function saveMapToStorage(doc: VttMapDocument): Promise<SavedMapSummary> {
  const id = sanitizeMapId(doc.id || doc.name);
  const payload: VttMapDocument = { ...doc, id };

  try {
    const res = await fetch(`/local-maps/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload, null, 2),
    });
    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as { meta?: SavedMapSummary };
        if (data.meta) {
          return { ...data.meta, storage: 'disk' };
        }
      }
    }
  } catch {
    // Fall back to browser storage
  }

  localStorage.setItem(`${BROWSER_STORAGE_PREFIX}${id}`, JSON.stringify(payload));
  return {
    id,
    name: payload.name,
    width: payload.terrain.width,
    length: payload.terrain.length,
    propCount: payload.props.length,
    updatedAt: payload.updatedAt,
    storage: 'browser',
  };
}

export async function loadMapFromStorageWithMeta(
  id: string
): Promise<{ doc: VttMapDocument; storage: 'disk' | 'browser'; id: string }> {
  const safeId = sanitizeMapId(id);
  try {
    const res = await fetch(`/local-maps/${encodeURIComponent(safeId)}`);
    if (res.ok) {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const parsed: unknown = await res.json();
        return { doc: parseMapDocument(parsed, safeId), storage: 'disk', id: safeId };
      }
    }
  } catch {
    // Try browser fallback
  }

  const raw = localStorage.getItem(`${BROWSER_STORAGE_PREFIX}${safeId}`);
  if (!raw) {
    throw new Error(`Saved map '${safeId}' not found.`);
  }
  return { doc: parseMapDocument(JSON.parse(raw), safeId), storage: 'browser', id: safeId };
}

export async function loadMapFromStorage(id: string): Promise<VttMapDocument> {
  const { doc } = await loadMapFromStorageWithMeta(id);
  return doc;
}

export async function deleteMapFromStorage(id: string): Promise<void> {
  const safeId = sanitizeMapId(id);
  try {
    await fetch(`/local-maps/${encodeURIComponent(safeId)}`, { method: 'DELETE' });
  } catch {
    // Ignore network error if using browser storage
  }
  try {
    localStorage.removeItem(`${BROWSER_STORAGE_PREFIX}${safeId}`);
  } catch {
    // Ignore
  }
}

export function exportMapToDownload(doc: VttMapDocument): void {
  const filename = `${sanitizeMapId(doc.name)}.vttmap.json`;
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importMapFromFile(file: File): Promise<VttMapDocument> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`'${file.name}' is not valid JSON.`);
  }
  const stem = file.name.replace(/\.vttmap\.json$/i, '').replace(/\.json$/i, '') || 'Imported Map';
  return parseMapDocument(parsed, stem);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Opens a `.vttmap.json` file via the browser's File System Access API, returning
 * both the parsed document and the live file handle so subsequent Save (`Ctrl+S`)
 * writes directly back to the same file. Returns `null` if the user cancels.
 */
export async function openMapFromFilePicker(): Promise<{
  doc: VttMapDocument;
  handle: MapFileHandle;
  fileName: string;
} | null> {
  const picker = (window as unknown as FilePickerWindow).showOpenFilePicker;
  if (typeof picker !== 'function') {
    throw new Error('Native file picker is not supported in this browser.');
  }
  let handles: MapFileHandle[];
  try {
    handles = await picker({
      multiple: false,
      types: VTT_MAP_PICKER_TYPES,
    });
  } catch (err) {
    if (isAbortError(err)) return null;
    throw err;
  }
  const handle = handles[0];
  if (!handle) return null;
  const file = await handle.getFile();
  const doc = await importMapFromFile(file);
  return { doc, handle, fileName: handle.name || file.name };
}

/**
 * Writes a VttMapDocument directly to an existing File System Access API file handle.
 */
export async function saveMapToFileHandle(handle: MapFileHandle, doc: VttMapDocument): Promise<void> {
  if (typeof handle.queryPermission === 'function') {
    const state = await handle.queryPermission({ mode: 'readwrite' });
    if (state !== 'granted') {
      if (typeof handle.requestPermission === 'function') {
        const next = await handle.requestPermission({ mode: 'readwrite' });
        if (next !== 'granted') {
          throw new Error(`Write permission denied for '${handle.name}'.`);
        }
      } else {
        throw new Error(`Write permission denied for '${handle.name}'.`);
      }
    }
  }
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(doc, null, 2));
  await writable.close();
}

/**
 * Prompts the user for a destination `.vttmap.json` file via `showSaveFilePicker`,
 * writes the document, and returns the handle so subsequent Saves write in-place.
 * Returns `null` if the user cancels.
 */
export async function saveMapWithFilePicker(
  doc: VttMapDocument
): Promise<{ handle: MapFileHandle; fileName: string } | null> {
  const picker = (window as unknown as FilePickerWindow).showSaveFilePicker;
  if (typeof picker !== 'function') {
    throw new Error('Native save picker is not supported in this browser.');
  }
  const suggestedName = `${sanitizeMapId(doc.id || doc.name)}.vttmap.json`;
  let handle: MapFileHandle;
  try {
    handle = await picker({
      suggestedName,
      types: VTT_MAP_PICKER_TYPES,
    });
  } catch (err) {
    if (isAbortError(err)) return null;
    throw err;
  }
  await saveMapToFileHandle(handle, doc);
  return { handle, fileName: handle.name || suggestedName };
}

/**
 * Saves a map directly to its currently linked target (either workspace storage or
 * an opened local file handle) without prompting for a new name/location.
 */
export async function saveMapToTarget(
  target: MapSaveTarget,
  doc: VttMapDocument
): Promise<{ saveTarget: MapSaveTarget; id: string; name: string; locationLabel: string }> {
  if (target.kind === 'file_handle') {
    await saveMapToFileHandle(target.handle, doc);
    return {
      saveTarget: target,
      id: doc.id,
      name: doc.name,
      locationLabel: target.fileName,
    };
  }

  const saved = await saveMapToStorage({ ...doc, id: target.id });
  const nextTarget: MapSaveTarget = {
    kind: 'storage',
    id: saved.id,
    storage: saved.storage,
  };
  return {
    saveTarget: nextTarget,
    id: saved.id,
    name: saved.name,
    locationLabel: saved.storage === 'disk' ? `maps/${saved.id}.vttmap.json` : 'browser storage',
  };
}
