# Coach Video Analysis

A video analysis workspace for coaches: open a match video, pause on the exact
moment, draw over it, step through frame by frame, record a voiced-over
analysis to send to players, and come back to it later. Everything runs in the
browser; no video is uploaded anywhere.

- **Frame scrubber** under the video: a ruler with one tick per frame. Drag it
  sideways to move frame by frame (flick to keep it turning), tap either side
  of the centre line to step one frame, or scroll over it. `S` shows or hides it.
- **Works with a finger or Apple Pencil on an iPad**: controls grow to finger
  size on touch screens, and the layout regroups for tablets in portrait.
- **Drawing**: freehand, line, arrow, circle, rectangle and text, in eight
  colours and four thicknesses. Lines, arrows, circles, rectangles and freehand
  strokes can be solid, dashed or dotted. Circles are always round and are drawn
  from the centre outwards. Each tool remembers its own colour, thickness and
  line style (shown as a dot on its button); with the Select tool the style
  controls change only the selected drawing.
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
| `npm run test:e2e` | Browser tests (Playwright) in Chromium and WebKit. Needs `ffmpeg` on the PATH to generate the test videos, and `npx playwright install chromium webkit` once. |

## How it is built

React + TypeScript on Vite. State is in small [zustand](https://github.com/pmndrs/zustand)
stores, icons are from `lucide-react`; there is no UI kit, CSS framework or canvas library.

```
src/
  annotations/   drawing model, tools, SVG overlay, selection, undo history
  video/         player controller, stage, timeline, frame scrubber, transport, frame-rate measurement
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
- **The frame scrubber follows the playhead the same way**, with one transform
  per frame change. It deliberately has no thumbnails: decoding and copying
  frames during playback made 2× playback stutter on slower devices.
- **Touch is handled with pointer events throughout.** Sizes for fingers live
  in `@media (pointer: coarse)` rules, and `@media (hover: none)` rules stop
  tapped controls from looking hovered. The test suite runs in Chromium and in
  WebKit (Safari's engine), and `touch.spec.ts` drives the app with real touch
  events.
- **Safari's private windows cannot store a Blob in IndexedDB**, so videos up
  to 250 MB are then stored as raw bytes instead (`db.putVideo`).
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

Saved for this browser, across all analyses: the active tool, each tool's
style, whether the frame scrubber is shown, and mute.

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
