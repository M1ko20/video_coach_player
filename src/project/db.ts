import type { ProjectPatch, ProjectRecord } from './types';

/**
 * IndexedDB persistence.
 *
 *   projects   project metadata and annotations (small, saved often)
 *   videos     the video file for each project (large, written once)
 *   viewState  where the playhead was left (no conflict checking needed)
 *
 * Videos live in their own store so that saving annotations never rewrites
 * gigabytes of footage. localStorage is not used for any of this: it is
 * synchronous and capped at a few megabytes.
 */

const DB_NAME = 'coach-video-analysis';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const VIDEOS = 'videos';
const VIEW_STATE = 'viewState';

/** Thrown when storage holds something other than what a save was based on. */
export class ConflictError extends Error {
  /** The record now in storage, or `null` if the project was deleted. */
  readonly stored: ProjectRecord | null;

  constructor(stored: ProjectRecord | null) {
    super(stored ? 'The project was changed elsewhere.' : 'The project was deleted elsewhere.');
    this.name = 'ConflictError';
    this.stored = stored;
  }
}

export interface ViewState {
  time: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not provide storage for saving analyses.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(VIDEOS)) db.createObjectStore(VIDEOS);
      if (!db.objectStoreNames.contains(VIEW_STATE)) db.createObjectStore(VIEW_STATE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab wants to upgrade the schema: step aside rather than block it.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
    request.onblocked = () => reject(new Error('Browser storage is busy in another tab. Close other tabs and retry.'));
  });

  dbPromise = opening;
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

/** Closes the connection. Used by tests to start from a clean database. */
export async function closeDb() {
  const pending = dbPromise;
  dbPromise = null;
  if (pending) (await pending.catch(() => null))?.close();
}

/**
 * Runs `work` in a transaction and resolves with its result only once the
 * transaction has durably completed — never on the mere success of a request.
 */
async function transact<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction, fail: (error: Error) => void) => () => T,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let failure: Error | null = null;
    const tx = db.transaction(stores, mode);
    const fail = (error: Error) => {
      failure = error;
      try {
        tx.abort();
      } catch {
        // Already finished or aborted.
      }
    };
    let read: () => T;
    try {
      read = work(tx, fail);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      reject(failure);
      return;
    }
    tx.oncomplete = () => resolve(read());
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Saving to browser storage failed.'));
    tx.onerror = () => {
      failure ??= tx.error;
    };
  });
}

export function listProjects(): Promise<ProjectRecord[]> {
  return transact(PROJECTS, 'readonly', (tx) => {
    const request = tx.objectStore(PROJECTS).getAll() as IDBRequest<ProjectRecord[]>;
    return () => request.result.sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

export function getProject(id: string): Promise<ProjectRecord | undefined> {
  return transact(PROJECTS, 'readonly', (tx) => {
    const request = tx.objectStore(PROJECTS).get(id) as IDBRequest<ProjectRecord | undefined>;
    return () => request.result;
  });
}

export function createProject(record: ProjectRecord): Promise<ProjectRecord> {
  return transact(PROJECTS, 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).add(record);
    return () => record;
  });
}

/**
 * Applies `patch` on top of what is in storage, provided storage still holds
 * the revision `base` was read at. Otherwise rejects with `ConflictError` and
 * writes nothing. `force` overwrites regardless (and recreates a deleted
 * project from `base`) — only for use after the user has chosen to do so.
 */
export function saveProject(
  base: ProjectRecord,
  patch: ProjectPatch,
  { force = false }: { force?: boolean } = {},
): Promise<ProjectRecord> {
  return transact(PROJECTS, 'readwrite', (tx, fail) => {
    const store = tx.objectStore(PROJECTS);
    const request = store.get(base.id) as IDBRequest<ProjectRecord | undefined>;
    let saved: ProjectRecord | null = null;

    request.onsuccess = () => {
      const stored = request.result;
      if (!force && (!stored || stored.revision !== base.revision)) {
        fail(new ConflictError(stored ?? null));
        return;
      }
      saved = {
        ...(stored ?? base),
        ...patch,
        id: base.id,
        revision: Math.max(stored?.revision ?? 0, base.revision) + 1,
        updatedAt: Date.now(),
      };
      store.put(saved);
    };

    return () => saved!;
  });
}

export function deleteProject(id: string): Promise<void> {
  return transact([PROJECTS, VIDEOS, VIEW_STATE], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).delete(id);
    tx.objectStore(VIDEOS).delete(id);
    tx.objectStore(VIEW_STATE).delete(id);
    return () => undefined;
  });
}

/**
 * Safari refuses to store Blobs in IndexedDB in private windows (and other
 * ephemeral sessions), but accepts their bytes. Videos up to this size are
 * then stored as an ArrayBuffer instead; larger ones would need too much
 * memory for the copy, on an iPad especially.
 */
const BUFFER_FALLBACK_LIMIT = 250 * 1024 ** 2;

/** How a video is stored when its Blob could not be. */
interface StoredBytes {
  buffer: ArrayBuffer;
  type: string;
}

function putVideoValue(projectId: string, value: Blob | StoredBytes): Promise<void> {
  return transact(VIDEOS, 'readwrite', (tx) => {
    tx.objectStore(VIDEOS).put(value, projectId);
    return () => undefined;
  });
}

export async function putVideo(projectId: string, file: Blob): Promise<void> {
  try {
    await putVideoValue(projectId, file);
  } catch (error) {
    if (isQuotaError(error) || file.size > BUFFER_FALLBACK_LIMIT) throw error;
    await putVideoValue(projectId, { buffer: await file.arrayBuffer(), type: file.type });
  }
}

export function getVideo(projectId: string): Promise<Blob | undefined> {
  return transact(VIDEOS, 'readonly', (tx) => {
    const request = tx.objectStore(VIDEOS).get(projectId) as IDBRequest<Blob | StoredBytes | undefined>;
    return () => {
      const value = request.result;
      if (value === undefined || value instanceof Blob) return value;
      return new Blob([value.buffer], { type: value.type });
    };
  });
}

export function deleteVideo(projectId: string): Promise<void> {
  return transact(VIDEOS, 'readwrite', (tx) => {
    tx.objectStore(VIDEOS).delete(projectId);
    return () => undefined;
  });
}

export function putViewState(projectId: string, state: ViewState): Promise<void> {
  return transact(VIEW_STATE, 'readwrite', (tx) => {
    tx.objectStore(VIEW_STATE).put(state, projectId);
    return () => undefined;
  });
}

export function getViewState(projectId: string): Promise<ViewState | undefined> {
  return transact(VIEW_STATE, 'readonly', (tx) => {
    const request = tx.objectStore(VIEW_STATE).get(projectId) as IDBRequest<ViewState | undefined>;
    return () => request.result;
  });
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
}

export interface StorageUsage {
  usage: number;
  quota: number;
}

export async function getStorageUsage(): Promise<StorageUsage | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate || estimate.quota === undefined || estimate.usage === undefined) return null;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}

/** Asks the browser not to evict our data under storage pressure. Best effort. */
export async function requestPersistentStorage() {
  try {
    if (await navigator.storage?.persisted?.()) return;
    await navigator.storage?.persist?.();
  } catch {
    // Not supported or denied: data is still stored, just evictable.
  }
}
