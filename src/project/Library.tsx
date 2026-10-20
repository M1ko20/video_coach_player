import { Film, LoaderCircle, Trash2, TriangleAlert, Upload, VideoOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatBytes, formatDurationShort, formatRelativeDate } from '../lib/time';
import { ConfirmDialog } from '../ui/Dialog';
import { useFileDrop } from '../ui/useFileDrop';
import { useProjectStore } from './projectStore';
import { createProjectFromFile, deleteProject, goToProject } from './session';
import type { ProjectRecord } from './types';

function ProjectCard({ project, onDelete }: { project: ProjectRecord; onDelete: (project: ProjectRecord) => void }) {
  const count = project.annotations.length;
  return (
    <li className="card">
      <button type="button" className="card__open" onClick={() => goToProject(project.id)} data-testid="project-card">
        <span className="card__thumb" style={{ aspectRatio: '16 / 9' }}>
          {project.thumbnail ? <img src={project.thumbnail} alt="" draggable={false} /> : <Film size={28} />}
          <span className="card__duration">{formatDurationShort(project.video.duration)}</span>
          {!project.videoStored && (
            <span className="card__badge">
              <VideoOff size={12} /> Video not stored
            </span>
          )}
        </span>
        <span className="card__name">{project.name}</span>
        <span className="card__meta">
          {count === 0 ? 'No drawings' : `${count} ${count === 1 ? 'drawing' : 'drawings'}`} · edited{' '}
          {formatRelativeDate(project.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        className="card__delete"
        aria-label={`Delete ${project.name}`}
        data-tooltip="Delete analysis…"
        data-tooltip-side="left"
        onClick={() => onDelete(project)}
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

/** Home screen: start a new analysis from a video, or reopen a saved one. */
export function Library() {
  const booting = useProjectStore((state) => state.booting);
  const bootError = useProjectStore((state) => state.bootError);
  const projects = useProjectStore((state) => state.projects);
  const storage = useProjectStore((state) => state.storage);
  const opening = useProjectStore((state) => state.opening);
  const openError = useProjectStore((state) => state.openError);

  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const busy = opening !== null;
  const canOpen = !busy && !booting && !bootError;
  const { dragging, dropHandlers } = useFileDrop((file) => void createProjectFromFile(file), canOpen);
  const empty = projects.length === 0;

  const confirmDelete = async () => {
    const project = pendingDelete;
    setPendingDelete(null);
    if (!project) return;
    try {
      await deleteProject(project.id);
      setDeleteError(null);
    } catch {
      setDeleteError(`“${project.name}” could not be deleted. Try again.`);
    }
  };

  return (
    <div className={`library ${dragging ? 'is-dragging' : ''}`} {...dropHandlers}>
      <header className="library__header">
        <span className="wordmark">
          <span className="wordmark__mark" aria-hidden="true" />
          Coach Video Analysis
        </span>
      </header>

      <main className="library__main">
        <section
          className={`dropzone ${empty ? 'dropzone--hero' : ''} ${dragging ? 'is-dragging' : ''}`}
          aria-busy={busy}
        >
          {busy ? (
            <>
              <LoaderCircle size={28} className="spin dropzone__icon" />
              <h1 className="dropzone__title">Opening video…</h1>
              <p className="dropzone__text">{opening}</p>
            </>
          ) : (
            <>
              <Upload size={28} className="dropzone__icon" />
              <h1 className="dropzone__title">{dragging ? 'Drop the video to start' : 'Analyze a video'}</h1>
              <p className="dropzone__text">
                Drop a video file here, or choose one from your computer. Pause on any moment, draw over it, and step
                through frame by frame.
              </p>
              <button type="button" className="button button--primary button--large" disabled={!canOpen} onClick={() => inputRef.current?.click()}>
                Choose video
              </button>
              <p className="dropzone__hint">MP4, MOV or WebM. The video stays on this device — nothing is uploaded.</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mkv,.mov"
            hidden
            data-testid="video-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so choosing the same file again still fires a change event.
              event.target.value = '';
              if (file) void createProjectFromFile(file);
            }}
          />
        </section>

        {(openError || bootError || deleteError) && (
          <p className="inline-error inline-error--block" role="alert" data-testid="open-error">
            <TriangleAlert size={16} />
            {openError ?? bootError ?? deleteError}
          </p>
        )}

        {!empty && (
          <section className="library__list" aria-labelledby="library-heading">
            <h2 id="library-heading" className="library__heading">
              Your analyses
            </h2>
            <ul className="cards">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} onDelete={setPendingDelete} />
              ))}
            </ul>
          </section>
        )}

        {booting && (
          <p className="library__status" role="status">
            <LoaderCircle size={16} className="spin" /> Loading your analyses…
          </p>
        )}
      </main>

      <footer className="library__footer">
        Analyses and drawings are saved automatically in this browser on this device.
        {storage && storage.quota > 0 && (
          <>
            {' '}
            Using {formatBytes(storage.usage)} of about {formatBytes(storage.quota)} available.
          </>
        )}
      </footer>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this analysis?"
        message={
          <>
            “{pendingDelete?.name}”, its drawings and the stored copy of its video will be removed from this browser.
            This cannot be undone. The original video file on your computer is not affected.
          </>
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
