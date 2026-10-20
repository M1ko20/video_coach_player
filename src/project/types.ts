import type { Annotation } from '../annotations/types';

export const SCHEMA_VERSION = 1;

/** Enough about the original file to recognise it again if it has to be re-selected. */
export interface VideoMeta {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  duration: number;
  width: number;
  height: number;
}

export interface ProjectRecord {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Incremented on every save. A save is only accepted when it is based on the
   * revision currently in storage, which stops a stale tab from overwriting
   * newer work.
   */
  revision: number;
  video: VideoMeta;
  /** Whether a copy of the video file is kept in browser storage. */
  videoStored: boolean;
  /** Frame rate measured from the footage, if it could be measured. */
  measuredFps: number | null;
  /** Frame rate chosen by the user. Takes precedence over the measured one. */
  manualFps: number | null;
  thumbnail: string | null;
  annotations: Annotation[];
}

/** The fields of a project that a save may change. */
export type ProjectPatch = Partial<
  Pick<
    ProjectRecord,
    'name' | 'video' | 'videoStored' | 'measuredFps' | 'manualFps' | 'thumbnail' | 'annotations'
  >
>;
