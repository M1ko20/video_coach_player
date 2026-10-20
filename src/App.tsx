import { LoaderCircle } from 'lucide-react';
import { useEffect } from 'react';
import { Library } from './project/Library';
import { useProjectStore } from './project/projectStore';
import { RecordingDialog } from './recording/RecordingDialog';
import { Workspace } from './workspace/Workspace';

/** Stops the browser from navigating away when a file is dropped outside a drop target. */
function useBlockStrayDrops() {
  useEffect(() => {
    const block = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);
}

export function App() {
  const projectId = useProjectStore((state) => state.project?.id ?? null);
  const loading = useProjectStore((state) => state.booting || state.loadingProject);
  useBlockStrayDrops();

  if (loading && !projectId) {
    return (
      <div className="splash" role="status">
        <LoaderCircle size={28} className="spin" />
        <span className="visually-hidden">Loading</span>
      </div>
    );
  }

  return (
    <>
      {/* Keyed by project so no component state leaks from one analysis into the next. */}
      {projectId ? <Workspace key={projectId} /> : <Library />}
      <RecordingDialog />
    </>
  );
}
