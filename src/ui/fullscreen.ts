import { useEffect, useState } from 'react';

/** iPadOS before 16.4 only has the prefixed fullscreen API. */
interface PrefixedDocument {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}
interface PrefixedElement {
  webkitRequestFullscreen?: () => void;
}

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as PrefixedDocument).webkitFullscreenElement ?? null;
}

export function toggleFullscreen() {
  const doc = document as Document & PrefixedDocument;
  const root = document.documentElement as HTMLElement & PrefixedElement;
  if (fullscreenElement()) {
    if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    else doc.webkitExitFullscreen?.();
  } else if (root.requestFullscreen) {
    void root.requestFullscreen().catch(() => {});
  } else {
    root.webkitRequestFullscreen?.();
  }
}

export function useFullscreen(): boolean {
  const [active, setActive] = useState(() => fullscreenElement() !== null);
  useEffect(() => {
    const sync = () => setActive(fullscreenElement() !== null);
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  return active;
}
