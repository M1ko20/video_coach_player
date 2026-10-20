import { create } from 'zustand';
import type { VideoInfo } from '../video/inspectVideo';
import type { StorageUsage } from './db';
import type { ProjectRecord } from './types';

/**
 * saved     everything is in storage
 * dirty     there are changes waiting for the autosave delay
 * saving    a write is in progress
 * error     the last write failed; changes are still only in memory
 * conflict  storage holds a newer version from another tab; waiting for the user
 */
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

/** Whether the open project has a playable video source. */
export type VideoStatus = 'ready' | 'missing';

/**
 * idle         nothing to report
 * storing      the file is being copied into browser storage
 * stored       a copy is in browser storage
 * unavailable  the copy could not be kept; the file must be re-selected next time
 */
export type VideoStorageStatus = 'idle' | 'storing' | 'stored' | 'unavailable';

export interface RelinkMismatch {
  file: File;
  info: VideoInfo;
}

interface ProjectState {
  booting: boolean;
  bootError: string | null;
  projects: ProjectRecord[];
  storage: StorageUsage | null;

  /** Name of the file being opened as a new analysis, while that is in progress. */
  opening: string | null;
  /** Why the last attempt to open a file or an analysis failed. */
  openError: string | null;
  /** A saved analysis is being read from storage. */
  loadingProject: boolean;

  /**
   * Working copy of the open project. `revision` is the one last seen in
   * storage. Annotations are owned by the annotation store while a project is
   * open; `annotations` here is only what was last read or written.
   */
  project: ProjectRecord | null;
  videoUrl: string | null;
  videoStatus: VideoStatus;
  videoStorage: VideoStorageStatus;
  videoStorageMessage: string | null;
  /** Where to put the playhead once the video has loaded. */
  startTime: number;

  saveStatus: SaveStatus;
  saveError: string | null;
  conflict: 'changed' | 'deleted' | null;

  relinking: boolean;
  relinkError: string | null;
  relinkMismatch: RelinkMismatch | null;
}

export const CLOSED_PROJECT = {
  project: null,
  videoUrl: null,
  videoStatus: 'missing',
  videoStorage: 'idle',
  videoStorageMessage: null,
  startTime: 0,
  saveStatus: 'saved',
  saveError: null,
  conflict: null,
  relinking: false,
  relinkError: null,
  relinkMismatch: null,
} satisfies Partial<ProjectState>;

export const useProjectStore = create<ProjectState>(() => ({
  booting: true,
  bootError: null,
  projects: [],
  storage: null,
  opening: null,
  openError: null,
  loadingProject: false,
  ...CLOSED_PROJECT,
}));
