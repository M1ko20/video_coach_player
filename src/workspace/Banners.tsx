import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useProjectStore } from '../project/projectStore';
import { discardAndClose, loadLatestVersion, overwriteStoredVersion, saveNow } from '../project/session';

interface BannerProps {
  tone: 'info' | 'warning' | 'danger';
  children: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

function Banner({ tone, children, actions, onDismiss, className }: BannerProps) {
  const Icon = tone === 'info' ? Info : tone === 'warning' ? TriangleAlert : CircleAlert;
  return (
    <div className={`banner banner--${tone} ${className ?? ''}`} role={tone === 'info' ? 'status' : 'alert'}>
      <Icon size={16} className="banner__icon" />
      <p className="banner__text">{children}</p>
      {actions && <div className="banner__actions">{actions}</div>}
      {onDismiss && (
        <button type="button" className="banner__dismiss" aria-label="Dismiss" onClick={onDismiss}>
          <X size={15} />
        </button>
      )}
    </div>
  );
}

/** Problems with saving or storage that need the coach's attention or decision. */
export function Banners() {
  const conflict = useProjectStore((state) => state.conflict);
  const saveStatus = useProjectStore((state) => state.saveStatus);
  const saveError = useProjectStore((state) => state.saveError);
  const videoStorage = useProjectStore((state) => state.videoStorage);
  const videoStorageMessage = useProjectStore((state) => state.videoStorageMessage);
  const [storageDismissed, setStorageDismissed] = useState(false);
  const [narrowDismissed, setNarrowDismissed] = useState(false);

  return (
    <div className="banners">
      {conflict === 'changed' && (
        <Banner
          tone="danger"
          actions={
            <>
              <button type="button" className="button button--small" onClick={() => void loadLatestVersion()}>
                Load the other version
              </button>
              <button type="button" className="button button--small button--danger" onClick={() => void overwriteStoredVersion()}>
                Keep this version
              </button>
            </>
          }
        >
          This analysis was changed in another tab or window, so your latest changes here have not been saved. Choose
          which version to keep.
        </Banner>
      )}

      {conflict === 'deleted' && (
        <Banner
          tone="danger"
          actions={
            <>
              <button type="button" className="button button--small" onClick={() => void overwriteStoredVersion()}>
                Restore it
              </button>
              <button type="button" className="button button--small button--danger" onClick={discardAndClose}>
                Close without saving
              </button>
            </>
          }
        >
          This analysis was deleted in another tab or window. Nothing has been saved since.
        </Banner>
      )}

      {saveStatus === 'error' && (
        <Banner
          tone="danger"
          actions={
            <>
              <button type="button" className="button button--small" onClick={saveNow}>
                Try again
              </button>
              <button type="button" className="button button--small button--danger" onClick={discardAndClose}>
                Close without saving
              </button>
            </>
          }
        >
          Your latest changes could not be saved. {saveError} Keep this tab open until saving works.
        </Banner>
      )}

      {videoStorage === 'unavailable' && videoStorageMessage && !storageDismissed && (
        <Banner tone="warning" onDismiss={() => setStorageDismissed(true)}>
          {videoStorageMessage} Your drawings are saved as usual, but you will be asked to select the video file again
          the next time you open this analysis.
        </Banner>
      )}

      {!narrowDismissed && (
        <Banner tone="info" className="banner--narrow-only" onDismiss={() => setNarrowDismissed(true)}>
          Drawing and frame-by-frame review work best on a larger screen with a mouse or pen.
        </Banner>
      )}
    </div>
  );
}
