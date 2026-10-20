import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Annotation } from '../../src/annotations/types';
import * as db from '../../src/project/db';
import { SCHEMA_VERSION, type ProjectRecord } from '../../src/project/types';

const annotation = (id: string): Annotation => ({
  id,
  type: 'arrow',
  x1: 0.1,
  y1: 0.2,
  x2: 0.6,
  y2: 0.7,
  strokeWidth: 5,
  color: '#ff453a',
  anchorTime: 12.5,
  range: null,
});

const project = (id: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id,
  schemaVersion: SCHEMA_VERSION,
  name: `Project ${id}`,
  createdAt: 1000,
  updatedAt: 1000,
  revision: 0,
  video: { name: 'match.mp4', size: 1234, type: 'video/mp4', lastModified: 1, duration: 60, width: 1920, height: 1080 },
  videoStored: false,
  measuredFps: null,
  manualFps: null,
  thumbnail: null,
  annotations: [],
  ...overrides,
});

beforeEach(async () => {
  await db.closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe('project storage', () => {
  it('round-trips a project with all annotation properties', async () => {
    await db.createProject(project('p1'));
    const saved = await db.saveProject(project('p1'), { annotations: [annotation('a'), annotation('b')], name: 'Final' });
    expect(saved.revision).toBe(1);

    const loaded = await db.getProject('p1');
    expect(loaded?.name).toBe('Final');
    expect(loaded?.annotations).toEqual([annotation('a'), annotation('b')]);
    expect(loaded?.video.duration).toBe(60);
  });

  it('refuses to create a project twice', async () => {
    await db.createProject(project('p1'));
    await expect(db.createProject(project('p1'))).rejects.toBeTruthy();
  });

  it('rejects a save based on a stale revision and leaves storage untouched', async () => {
    const created = await db.createProject(project('p1'));
    // Two tabs open the same project at revision 0.
    const tabA = await db.saveProject(created, { annotations: [annotation('from-a')] });
    expect(tabA.revision).toBe(1);

    const stale = db.saveProject(created, { annotations: [annotation('from-b')] });
    await expect(stale).rejects.toBeInstanceOf(db.ConflictError);
    await stale.catch((error: db.ConflictError) => {
      expect(error.stored?.revision).toBe(1);
      expect(error.stored?.annotations[0]?.id).toBe('from-a');
    });

    const loaded = await db.getProject('p1');
    expect(loaded?.annotations.map((item) => item.id)).toEqual(['from-a']);
    expect(loaded?.revision).toBe(1);
  });

  it('overwrites on request and moves past the stored revision', async () => {
    const created = await db.createProject(project('p1'));
    await db.saveProject(created, { name: 'A1' });
    await db.saveProject({ ...created, revision: 1 }, { name: 'A2' });

    const forced = await db.saveProject(created, { name: 'B' }, { force: true });
    expect(forced.revision).toBe(3);
    expect((await db.getProject('p1'))?.name).toBe('B');
  });

  it('reports a project deleted elsewhere instead of silently recreating it', async () => {
    const created = await db.createProject(project('p1'));
    await db.deleteProject('p1');

    const save = db.saveProject(created, { name: 'Ghost' });
    await expect(save).rejects.toBeInstanceOf(db.ConflictError);
    await save.catch((error: db.ConflictError) => expect(error.stored).toBeNull());
    expect(await db.getProject('p1')).toBeUndefined();

    const restored = await db.saveProject(created, { name: 'Restored' }, { force: true });
    expect(restored.name).toBe('Restored');
    expect((await db.getProject('p1'))?.name).toBe('Restored');
  });

  it('lists projects with the most recently edited first', async () => {
    await db.createProject(project('old'));
    await db.createProject(project('new'));
    await db.saveProject(project('old'), { name: 'Old, edited last' });
    const list = await db.listProjects();
    expect(list.map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('deletes a project together with its video and view state', async () => {
    await db.createProject(project('p1'));
    await db.putVideo('p1', new Blob(['video-bytes'], { type: 'video/mp4' }));
    await db.putViewState('p1', { time: 42 });
    expect(await db.getVideo('p1')).toBeDefined();
    expect(await db.getViewState('p1')).toEqual({ time: 42 });

    await db.deleteProject('p1');
    expect(await db.getProject('p1')).toBeUndefined();
    expect(await db.getVideo('p1')).toBeUndefined();
    expect(await db.getViewState('p1')).toBeUndefined();
  });

  it('keeps projects independent', async () => {
    await db.createProject(project('p1'));
    await db.createProject(project('p2'));
    await db.saveProject(project('p1'), { annotations: [annotation('a')] });
    expect((await db.getProject('p2'))?.annotations).toEqual([]);
  });
});
