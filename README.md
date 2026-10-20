# Coach Video Analysis

A video analysis workspace for coaches: open a match video, pause on the exact
moment, draw over it, step through frame by frame, and come back to the
analysis later. Everything runs in the browser; no video is uploaded anywhere.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

| Command            | What it does                                            |
| ------------------ | ------------------------------------------------------- |
| `npm run dev`      | Development server with hot reload                      |
| `npm run build`    | Type-check and build to `dist/`                         |
| `npm run preview`  | Serve the production build                              |
| `npm run check`    | Type-check, lint and unit tests                         |
| `npm test`         | Unit tests (Vitest)                                     |
| `npm run test:e2e` | Browser tests (Playwright). Needs `ffmpeg` on the PATH to generate the test videos, and `npx playwright install chromium` once. |

## How it is built

React + TypeScript on Vite. State is in small [zustand](https://github.com/pmndrs/zustand)
stores, icons are from `lucide-react`; there is no UI kit, CSS framework or canvas library.

```
src/
  annotations/   drawing model, tools, SVG overlay, selection, undo history
  video/         player controller, stage, timeline, transport, frame-rate measurement
  project/       IndexedDB storage, open/save/close lifecycle, library screen
  workspace/     workspace layout, top bar, keyboard shortcuts, banners
  ui/            shared controls (buttons, dialogs, drop handling)
  lib/           time/frame maths, text metrics
```

Design decisions worth knowing before changing things:

- **The drawing layer is an SVG stretched exactly over the video**, with a
  `viewBox` in video-relative units. Annotations store normalized coordinates
  (0–1 of the frame) and sizes in thousandths of the video height. Resizing only
  scales the SVG, so drawings cannot drift and no annotation data is touched.
- **Annotations change only through `annotationStore`**: add, replace, remove,
  clear, undo, redo. Nothing else writes to it, so playback, seeking, tool
  changes and layout changes cannot remove a drawing.
- **A gesture in progress lives outside that store** (`interactionStore` plus a
  ref). Only the shape being drawn re-renders, at most once per animation frame,
  and history and autosave see one change when the gesture ends.
- **The current time never goes through React.** `player.subscribeTime` feeds
  the time readout and playhead, which write to the DOM directly. Playback and
  scrubbing cause zero React renders (there is a test for this).
- **Seeks are coalesced.** While the decoder is busy only the latest requested
  position is kept, so dragging the playhead stays responsive on heavy files.
- **Every annotation has `anchorTime` and `range`.** `range` is `null` today
  (visible for the whole video); `isVisibleAt` already implements time-limited
  visibility for when the UI offers it.

## What is saved, and where

Saved automatically in this browser (IndexedDB), per analysis:

- name, drawings and all their properties
- the playhead position
- a copy of the video file, when the browser has room for it
- the measured or manually chosen frame rate

Not saved: undo history, the current selection, playback speed.

If the video copy cannot be kept (storage full, or evicted by the browser) the
drawings are still saved, the workspace says so, and the next visit asks for the
video file again. A save is accepted only if it is based on the version in
storage, so a second tab cannot silently overwrite newer work; the stale tab is
asked which version to keep. "Saved" is shown only after the storage transaction
has completed.

## Known limits

- **Frame stepping is as exact as the browser allows.** The frame rate is
  measured from the timestamps of frames the browser presents and steps aim at
  the middle of the target frame. Browsers have no frame-exact seek API, so
  variable-frame-rate footage can occasionally repeat or skip a frame. If the
  rate cannot be measured, 30 fps is assumed and shown as `~30 fps`; it can be
  set by hand from the same control.
- **Playable formats are whatever the browser decodes** — MP4 (H.264) and WebM
  everywhere; HEVC/MOV depending on browser and hardware.
- **Storage is local to one browser on one device.** There is no sync, export or
  backup yet, and clearing site data deletes the analyses.
- Drawings are visible for the whole video; freehand strokes and text can be
  moved and restyled but not scaled with handles.
