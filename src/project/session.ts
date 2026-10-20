import { useAnnotationStore } from '../annotations/annotationStore';
import { useInteractionStore } from '../annotations/interactionStore';
import { createId } from '../lib/id';
import { inspectVideo, looksLikeVideo, sampleVideo, type VideoInfo } from '../video/inspectVideo';
import { setFrameRate, usePlaybackStore } from '../video/playbackStore';
import { player } from '../video/player';
import * as db from './db';
import { CLOSED_PROJECT, useProjectStore } from './projectStore';
import { SCHEMA_VERSION, type ProjectPatch, type ProjectRecord, type VideoMeta } from './types';

/**
 * Project lifecycle: opening, autosaving and closing analyses.
 *
 * What persists across reloads: the project, its annotations, the playhead
 * position and — when the browser has room for it — a copy of the video file.
 * What does not: undo history, the current selection, and playback speed.
 */

const AUTOSAVE_DELAY_MS = 600;
const VIEW_STATE_INTERVAL_MS = 1000;
const ROUTE = /^#\/a\/([\w-]+)$/;

const store = useProjectStore;

/** Changes whenever a different project (or none) becomes current. Stale async work checks it. */
let session = 0;
/** Counts local changes; a save is complete when `savedVersion` catches up. */
let localVersion = 0;
let savedVersion = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savePromise: Promise<void> | null = null;
let sampleAbort: AbortController | null = null;
let stopWatching: (() => void) | null = null;
/** The open project's video, kept so it can be stored again if needed. */
let currentVideo: Blob | null = null;

function errorMessage(error: unknown, fallback: string): string {
  if (db.isQuotaError(error)) return 'Browser storage is full.';
  return error instanceof Error && error.message ? error.message : fallback;
}

// ---------------------------------------------------------------------------
// Routing — the open project lives in the URL hash so a reload returns to it.
// ---------------------------------------------------------------------------

function routeProjectId(): string | null {
  return ROUTE.exec(window.location.hash)?.[1] ?? null;
}

export function goToProject(id: string) {
  window.location.hash = `#/a/${id}`;
}

export function goToLibrary() {
  window.location.hash = '#/';
}

async function applyRoute() {
  const id = routeProjectId();
  const current = store.getState().project;
  if (id === (current?.id ?? null)) return;

  if (current && !(await leaveProject())) {
    // Unsaved work could not be written. Stay on the project rather than lose it;
    // the workspace shows why and offers to retry or discard.
    window.history.replaceState(null, '', `#/a/${current.id}`);
    return;
  }
  if (id) await openProject(id);
}

let routeQueue: Promise<void> = Promise.resolve();

/** Applies the URL to the app. Calls are serialised so quick back/forward presses cannot interleave. */
function syncRoute(): Promise<void> {
  routeQueue = routeQueue.then(applyRoute, applyRoute);
  return routeQueue;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

let booted = false;

export async function boot() {
  if (booted) return;
  booted = true;

  window.addEventListener('hashchange', () => void syncRoute());
  window.addEventListener('pagehide', flushForUnload);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushForUnload();
  });
  window.addEventListener('beforeunload', (event) => {
    const { saveStatus, videoStorage, project } = store.getState();
    if (!project) return;
    if (saveStatus !== 'saved' || videoStorage === 'storing') {
      // Ask the browser to confirm: leaving now would lose work or a video copy.
      event.preventDefault();
      event.returnValue = '';
    }
  });
  // Remember where the playhead is: at most once a second while it moves,
  // so a reload or a crash returns the coach to (almost exactly) the same moment.
  let viewStateTimer: ReturnType<typeof setTimeout> | undefined;
  player.subscribeTime(() => {
    viewStateTimer ??= setTimeout(() => {
      viewStateTimer = undefined;
      saveViewState();
    }, VIEW_STATE_INTERVAL_MS);
  });

  try {
    await refreshProjects();
    store.setState({ booting: false });
    await syncRoute();
  } catch (error) {
    store.setState({
      booting: false,
      bootError: errorMessage(error, 'Browser storage could not be opened, so analyses cannot be saved.'),
    });
  }
}

export async function refreshProjects() {
  const projects = await db.listProjects();
  store.setState({ projects });
  void db.getStorageUsage().then((storage) => store.setState({ storage }));
}

function flushForUnload() {
  saveViewState();
  if (store.getState().saveStatus === 'dirty') void runSave();
}

function saveViewState() {
  const { project, videoStatus } = store.getState();
  if (!project || videoStatus !== 'ready' || usePlaybackStore.getState().status !== 'ready') return;
  db.putViewState(project.id, { time: player.time }).catch(() => {
    // The playhead position is a convenience; losing it is harmless.
  });
}

// ---------------------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------------------

function enterProject(record: ProjectRecord, video: Blob | null, startTime: number) {
  session += 1;
  localVersion = 0;
  savedVersion = 0;
  currentVideo = video;

  useInteractionStore.getState().reset();
  useAnnotationStore.getState().load(record.annotations);
  setFrameRate(record.measuredFps, record.manualFps);

  store.setState({
    ...CLOSED_PROJECT,
    project: record,
    videoUrl: video ? URL.createObjectURL(video) : null,
    videoStatus: video ? 'ready' : 'missing',
    videoStorage: record.videoStored && video ? 'stored' : 'idle',
    startTime,
    openError: null,
    loadingProject: false,
  });

  stopWatching = useAnnotationStore.subscribe((state, previous) => {
    if (state.editCount !== previous.editCount) markDirty();
  });
}

/** Unloads the open project. Returns `false`, leaving it open, if its changes could not be saved. */
async function leaveProject(): Promise<boolean> {
  const { project, videoUrl, saveStatus } = store.getState();
  if (!project) return true;

  saveViewState();
  // Pending changes must reach storage before the project is unloaded.
  if (saveStatus === 'dirty' || saveStatus === 'error') await runSave();
  else if (savePromise) await savePromise;
  if (store.getState().project?.id !== project.id) return true;
  if (store.getState().saveStatus !== 'saved') return false;

  session += 1;
  clearTimeout(saveTimer);
  stopWatching?.();
  stopWatching = null;
  sampleAbort?.abort();
  sampleAbort = null;
  currentVideo = null;

  store.setState({ ...CLOSED_PROJECT });
  useInteractionStore.getState().reset();
  useAnnotationStore.getState().load([]);
  if (videoUrl) URL.revokeObjectURL(videoUrl);

  await refreshProjects().catch(() => {});
  return true;
}

/** Loads a project from storage. The caller has already closed any open project. */
async function openProject(id: string) {
  const token = ++session;
  store.setState({ loadingProject: true });

  try {
    const record = await db.getProject(id);
    if (token !== session) return;
    if (!record) {
      store.setState({ openError: 'That analysis could not be found. It may have been deleted.' });
      goToLibrary();
      return;
    }

    const [video, viewState] = await Promise.all([
      db.getVideo(id).catch(() => undefined),
      db.getViewState(id).catch(() => undefined),
    ]);
    if (token !== session) return;

    enterProject(record, video ?? null, viewState?.time ?? 0);

    // The flag is a hint for the library; what is actually in storage wins.
    if (record.videoStored !== !!video) updateProject({ videoStored: !!video });
    if (video && (record.measuredFps === null || record.thumbnail === null)) {
      void runSample(store.getState().videoUrl!);
    }
  } catch (error) {
    if (token !== session) return;
    store.setState({ openError: errorMessage(error, 'The analysis could not be opened.') });
    goToLibrary();
  } finally {
    // On success `enterProject` has already cleared the flag (and moved the session on).
    if (token === session) store.setState({ loadingProject: false });
  }
}

function videoMeta(file: File, info: VideoInfo): VideoMeta {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    duration: info.duration,
    width: info.width,
    height: info.height,
  };
}

/** Starts a new analysis from a video file chosen or dropped by the user. */
export async function createProjectFromFile(file: File) {
  if (store.getState().opening) return;
  store.setState({ opening: file.name, openError: null });

  const fail = (message: string) => store.setState({ opening: null, openError: message });

  if (!looksLikeVideo(file)) {
    fail(`“${file.name}” is not a video file. Choose an MP4, MOV or WebM video.`);
    return;
  }

  const probeUrl = URL.createObjectURL(file);
  let info: VideoInfo;
  try {
    info = await inspectVideo(probeUrl);
  } catch (error) {
    fail(errorMessage(error, 'This video could not be opened.'));
    return;
  } finally {
    URL.revokeObjectURL(probeUrl);
  }

  const now = Date.now();
  const record: ProjectRecord = {
    id: createId(),
    schemaVersion: SCHEMA_VERSION,
    name: file.name.replace(/\.[^.]+$/, '') || 'Untitled analysis',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    video: videoMeta(file, info),
    videoStored: false,
    measuredFps: null,
    manualFps: null,
    thumbnail: null,
    annotations: [],
  };

  try {
    await db.createProject(record);
  } catch (error) {
    fail(`The analysis could not be created. ${errorMessage(error, 'Browser storage is unavailable.')}`);
    return;
  }

  if (!(await leaveProject())) {
    fail('Save or discard the changes in the open analysis first.');
    return;
  }
  enterProject(record, file, 0);
  store.setState({ opening: null });
  goToProject(record.id);

  void db.requestPersistentStorage();
  void storeVideo(record.id, file);
  void runSample(store.getState().videoUrl!);
}

export async function deleteProject(id: string) {
  await db.deleteProject(id);
  await refreshProjects();
}

// ---------------------------------------------------------------------------
// Video storage
// ---------------------------------------------------------------------------

/** Copies the video into browser storage in the background. */
async function storeVideo(projectId: string, file: Blob) {
  const isCurrent = () => store.getState().project?.id === projectId;
  if (isCurrent()) store.setState({ videoStorage: 'storing', videoStorageMessage: null });

  try {
    const usage = await db.getStorageUsage();
    if (usage && file.size > usage.quota - usage.usage) {
      throw new DOMException('Not enough space', 'QuotaExceededError');
    }
    await db.putVideo(projectId, file);
  } catch (error) {
    if (isCurrent()) {
      store.setState({
        videoStorage: 'unavailable',
        videoStorageMessage: db.isQuotaError(error)
          ? 'This video is too large to keep in this browser’s storage.'
          : 'This browser could not keep a copy of the video.',
      });
      if (store.getState().project?.videoStored) updateProject({ videoStored: false });
    }
    return;
  }

  if (isCurrent()) {
    store.setState({ videoStorage: 'stored', videoStorageMessage: null });
    if (!store.getState().project?.videoStored) updateProject({ videoStored: true });
    void db.getStorageUsage().then((storage) => store.setState({ storage }));
    return;
  }

  // The project was closed while the copy was in flight: record the result directly.
  try {
    const record = await db.getProject(projectId);
    if (!record) {
      await db.deleteVideo(projectId);
    } else if (!record.videoStored) {
      await db.saveProject(record, { videoStored: true });
    }
    if (!store.getState().project) await refreshProjects();
  } catch {
    // Opening the project re-checks whether the video is present.
  }
}

/** Measures frame rate and captures a thumbnail, if the project lacks them. */
async function runSample(url: string) {
  sampleAbort?.abort();
  const controller = new AbortController();
  sampleAbort = controller;
  const token = session;

  const sample = await sampleVideo(url, controller.signal);
  if (token !== session || controller.signal.aborted) return;

  const project = store.getState().project;
  if (!project) return;
  const patch: ProjectPatch = {};
  if (sample.fps !== null && project.measuredFps === null) patch.measuredFps = sample.fps;
  if (sample.thumbnail !== null && project.thumbnail === null) patch.thumbnail = sample.thumbnail;
  if (Object.keys(patch).length > 0) updateProject(patch);
}

/**
 * Attaches a video file to a project whose stored copy is missing. A file that
 * does not look like the original is held back until the user confirms.
 */
export async function relinkVideo(file: File, confirmed = false) {
  const project = store.getState().project;
  if (!project || store.getState().relinking) return;
  const token = session;

  store.setState({ relinking: true, relinkError: null, relinkMismatch: null });
  const fail = (message: string) => store.setState({ relinking: false, relinkError: message });

  if (!looksLikeVideo(file)) {
    fail(`“${file.name}” is not a video file.`);
    return;
  }

  const probeUrl = URL.createObjectURL(file);
  let info: VideoInfo;
  try {
    info = await inspectVideo(probeUrl);
  } catch (error) {
    if (token === session) fail(errorMessage(error, 'This video could not be opened.'));
    return;
  } finally {
    URL.revokeObjectURL(probeUrl);
  }
  if (token !== session) return;

  const original = project.video;
  const sameFile = file.name === original.name && file.size === original.size;
  const sameFootage =
    Math.abs(info.duration - original.duration) < 0.5 &&
    info.width === original.width &&
    info.height === original.height;

  if (!sameFile && !sameFootage && !confirmed) {
    store.setState({ relinking: false, relinkMismatch: { file, info } });
    return;
  }

  const previousUrl = store.getState().videoUrl;
  currentVideo = file;
  store.setState({
    relinking: false,
    videoUrl: URL.createObjectURL(file),
    videoStatus: 'ready',
    startTime: sameFootage ? store.getState().startTime : 0,
  });
  if (previousUrl) URL.revokeObjectURL(previousUrl);

  // Different footage: what was measured from the old file no longer applies.
  updateProject(
    sameFootage ? { video: videoMeta(file, info) } : { video: videoMeta(file, info), measuredFps: null, thumbnail: null },
  );

  void storeVideo(project.id, file);
  const updated = store.getState().project;
  if (updated && (updated.measuredFps === null || updated.thumbnail === null)) {
    void runSample(store.getState().videoUrl!);
  }
}

export function confirmRelink() {
  const mismatch = store.getState().relinkMismatch;
  if (mismatch) void relinkVideo(mismatch.file, true);
}

export function cancelRelink() {
  store.setState({ relinkMismatch: null, relinkError: null });
}

// ---------------------------------------------------------------------------
// Editing project properties
// ---------------------------------------------------------------------------

function updateProject(patch: ProjectPatch) {
  const project = store.getState().project;
  if (!project) return;
  const next = { ...project, ...patch };
  store.setState({ project: next });
  if ('measuredFps' in patch || 'manualFps' in patch) setFrameRate(next.measuredFps, next.manualFps);
  markDirty();
}

export function renameProject(name: string) {
  const trimmed = name.trim();
  const project = store.getState().project;
  if (!project || !trimmed || trimmed === project.name) return;
  updateProject({ name: trimmed });
}

/** Sets the frame rate used for stepping. `null` returns to the measured rate. */
export function setManualFrameRate(fps: number | null) {
  if (store.getState().project?.manualFps === fps) return;
  updateProject({ manualFps: fps });
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function markDirty() {
  localVersion += 1;
  const { saveStatus } = store.getState();
  // A conflict needs a decision from the user before anything else is written.
  if (saveStatus === 'conflict') return;
  if (saveStatus !== 'saving') store.setState({ saveStatus: 'dirty' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void runSave(), AUTOSAVE_DELAY_MS);
}

function currentPatch(project: ProjectRecord): ProjectPatch {
  return {
    name: project.name,
    video: project.video,
    videoStored: project.videoStored,
    measuredFps: project.measuredFps,
    manualFps: project.manualFps,
    thumbnail: project.thumbnail,
    annotations: useAnnotationStore.getState().items,
  };
}

async function writeUntilCurrent(force: boolean) {
  const token = session;
  let forceNext = force;

  while (token === session) {
    const project = store.getState().project;
    if (!project) return;
    const version = localVersion;
    store.setState({ saveStatus: 'saving', saveError: null });

    try {
      const saved = await db.saveProject(project, currentPatch(project), { force: forceNext });
      if (token !== session) return;
      forceNext = false;
      savedVersion = version;
      const latest = store.getState().project;
      if (latest) {
        store.setState({
          project: { ...latest, revision: saved.revision, updatedAt: saved.updatedAt, annotations: saved.annotations },
          conflict: null,
        });
      }
    } catch (error) {
      if (token !== session) return;
      if (error instanceof db.ConflictError) {
        store.setState({ saveStatus: 'conflict', conflict: error.stored ? 'changed' : 'deleted' });
      } else {
        store.setState({
          saveStatus: 'error',
          saveError: errorMessage(error, 'Saving to browser storage failed.'),
        });
      }
      return;
    }

    // "Saved" is only shown once storage has confirmed everything made so far.
    if (savedVersion === localVersion) {
      store.setState({ saveStatus: 'saved' });
      return;
    }
  }
}

async function runSave({ force = false }: { force?: boolean } = {}) {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  while (savePromise) await savePromise;

  const { project, saveStatus } = store.getState();
  if (!project) return;
  if (!force && (saveStatus === 'conflict' || savedVersion === localVersion)) return;

  savePromise = writeUntilCurrent(force).finally(() => {
    savePromise = null;
  });
  await savePromise;
}

/** Saves immediately instead of waiting for the autosave delay. Also retries a failed save. */
export function saveNow() {
  const { saveStatus } = store.getState();
  if (saveStatus === 'dirty' || saveStatus === 'error') void runSave();
}

/** Resolves a conflict by replacing this tab's state with what is in storage. */
export async function loadLatestVersion() {
  const project = store.getState().project;
  if (!project) return;
  const token = session;

  try {
    const stored = await db.getProject(project.id);
    if (token !== session) return;
    if (!stored) {
      store.setState({ saveStatus: 'conflict', conflict: 'deleted' });
      return;
    }
    clearTimeout(saveTimer);
    savedVersion = localVersion;
    useInteractionStore.getState().reset();
    useAnnotationStore.getState().load(stored.annotations);
    setFrameRate(stored.measuredFps, stored.manualFps);
    store.setState({ project: stored, saveStatus: 'saved', saveError: null, conflict: null });
  } catch (error) {
    if (token !== session) return;
    store.setState({ saveError: errorMessage(error, 'The latest version could not be loaded.') });
  }
}

/** Resolves a conflict by keeping this tab's state and overwriting storage. */
export async function overwriteStoredVersion() {
  const { conflict, project } = store.getState();
  if (!project || !conflict) return;
  const wasDeleted = conflict === 'deleted';

  await runSave({ force: true });

  // Deleting the project elsewhere also removed its video copy; put it back.
  if (wasDeleted && currentVideo && store.getState().saveStatus === 'saved') {
    void storeVideo(project.id, currentVideo);
  }
}

/** Closes the project without writing this tab's unsaved changes. Only on the user's explicit request. */
export function discardAndClose() {
  clearTimeout(saveTimer);
  savedVersion = localVersion;
  store.setState({ saveStatus: 'saved', conflict: null });
  goToLibrary();
}
