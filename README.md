# Coach Video Analysis

A video analysis workspace for coaches: open a match video, pause on the exact
moment, draw over it, step through frame by frame, record a voiced-over
analysis to send to players, and come back to it later. Everything runs in the
browser; no video is uploaded anywhere.

- **Frame strip** under the video shows the neighbouring frames like a piece of
  film. Drag it sideways to move frame by frame, click a frame to jump to it, or
  scroll over it (one notch = one frame). `S` shows or hides it.
- **Drawing**: freehand, line, arrow, circle, rectangle and text, in eight
  colours and four thicknesses. Lines, arrows, circles, rectangles and freehand
  strokes can be solid, dashed or dotted. Circles are always round and are drawn
  from the centre outwards.
- **Record** (top bar) records the video with the drawings burnt in, the video's
  sound (unless muted) and your voice from the microphone. Pause, step and draw
  while recording; all of it is in the result. Stop gives a preview and a
  download (MP4 where the browser can encode it, otherwise WebM).

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
  video/         player controller, stage, timeline, frame strip, transport, frame-rate measurement
  recording/     recording the analysis: canvas compositing, audio mixing, download
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
- **The frame strip follows the playhead the same way.** Each slot is a canvas
  repainted from a thumbnail cache when the frame changes. Thumbnails come from
  a second, hidden `<video>` on the same file (so making them never moves the
  main picture), decoded only once the playhead is still, nearest frames first;
  frames the main video is already showing are copied from it for free.
- **Recording composes the picture on a canvas** every display frame: the video
  frame, then the drawings through `recording/drawAnnotations.ts`, a canvas
  port of `ShapeView`. Keep the two in step when changing how shapes look.
  Sound is mixed in Web Audio; the video element's output is routed through it
  permanently once the first recording starts, as browsers allow only one such
  routing per element. The microphone goes only into the recording, never to
  the speakers.
- **Circles are stored as `type: 'ellipse'`** with a bounding box that is square
  on screen, so analyses saved before circles were enforced still load.
  Drawings saved before line styles existed have no `dash` and are solid.
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
- **Recording needs the tab to stay visible.** Browsers stop painting hidden
  tabs, so switching away freezes the picture in the recording (the sound keeps
  going). Recordings are kept in memory until downloaded or discarded; they are
  not saved with the analysis. WebM files from Chrome's recorder may not be
  seekable in every player; Chrome normally records MP4.
