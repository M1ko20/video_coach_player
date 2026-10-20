import { useCallback, useEffect, useState } from 'react';
import { ToolRail } from '../annotations/ToolRail';
import { useProjectStore } from '../project/projectStore';
import { FrameScrubber } from '../video/FrameScrubber';
import { usePlaybackStore } from '../video/playbackStore';
import { Timeline } from '../video/Timeline';
import { Transport } from '../video/Transport';
import { VideoStage } from '../video/VideoStage';
import { Banners } from './Banners';
import { ShortcutsDialog } from './ShortcutsDialog';
import { TopBar } from './TopBar';
import { useShortcuts } from './useShortcuts';

const NARROW_QUERY = '(max-width: 760px)';

function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return narrow;
}

/**
 * The analysis workspace: the video takes all the space the surrounding
 * controls do not need. Tools sit in a rail beside it, tool options above it,
 * and navigation below it — the layout of a typical creative application.
 */
export function Workspace() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const narrow = useNarrowLayout();
  // Drawing needs a frame to draw on.
  const videoReady = useProjectStore((state) => state.videoStatus === 'ready');
  const playable = usePlaybackStore((state) => state.status === 'ready');
  const toolsDisabled = !videoReady || !playable;

  useShortcuts(showShortcuts);

  return (
    <div className="workspace">
      <TopBar onShowShortcuts={showShortcuts} toolsDisabled={toolsDisabled} />
      <Banners />
      <ToolRail tooltipSide={narrow ? 'top' : 'right'} disabled={toolsDisabled} />
      <main className="workspace__stage">
        <VideoStage />
      </main>
      <footer className="workspace__controls">
        <FrameScrubber />
        <Timeline />
        <Transport />
      </footer>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
