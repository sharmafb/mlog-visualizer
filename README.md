# mLog Visualizer

A public browser tool for exploring Media over QUIC (MoQ) logs.

**[Open the live viewer](https://fb.mvfst.net/mlog/)**

Upload an `.mlog`, `.qlog`, `.sqlog`, `.json`, or JSON sequence file. Inspect
transfers on a timeline, filter tracks and event types, zoom into delivery bursts,
and open the full data for an event. Files are processed on your device and
are never uploaded to the server. There are no accounts, analytics, or internal
data services.

## Log formats

- Current contained JSON qlog files, including moxygen's `FileMLogger` output.
- qlog JSON Text Sequences with a header and record separators.
- Older qlog tuple events and explicit timestamp units.
- Legacy mLog event arrays, JSONL, and concatenated pretty JSON records.

Current qlog event times are milliseconds, with fractional values preserved.
For older moxygen files containing native clock counts, choose the original
unit in **Legacy timestamp units** (nanoseconds on Linux, microseconds on
macOS). Units are never guessed from the size of a timestamp.

The viewer resolves track aliases and subgroup/fetch stream context. It retains
64-bit identifiers without rounding. Unresolved values stay visible as deltas.
If a qlog also contains QUIC `RESET_STREAM` or `STOP_SENDING` frames, these
appear as transport events. Independent trace clocks require alignment before
making claims about latency between endpoints.

## Run locally

Requires Node.js 20 or newer. No package dependencies are needed.

```sh
npm install
npm test
npm run dev
```

Open <http://127.0.0.1:4173>. Choose **Try a sample** for a synthetic session.

`npm test` includes transfer matching and layout geometry regressions. To check
the actual font bounds and drawn boxes, load a log and paste
`tests/browser-layout-check.js` into the browser's developer console. It checks
for intersecting boxes, labels extending beyond their box, duplicated track
columns, and oversized canvas allocations. Repeat after zooming and resizing.

## Deploy

```sh
npm run build
```

Serve the `dist/` directory with any static web server. All asset references
are relative, so deployment under `/mlog/` works without rebuilding.
See [deployment instructions](docs/deployment.md).

## Contribute

Issues and pull requests are welcome. Add parser tests when adding a log format
or changing identifier reconstruction. Use synthetic fixtures; do not commit
logs containing credentials or personal data.

The vertical timeline has one column per track. Matching send and receive
observations share one box; both original records remain available in the
details panel. Repeated observations from the same endpoint stay separate.

Upload and filter controls sit above the timeline. Event details use a separate
right column on desktop, and stack above the timeline on narrow screens.
Control message details show the recorded setup options, parameters, and track
properties alongside the original logged observations.
Datagram details show Time, Track, Group, Object, and Payload.
Box labels use `gp`, `subgp`, and `obj` for their IDs; object datagrams are marked `[DATAGRAM]`.
All event types and group/object IDs are displayed; track and trace controls filter the timeline.
Left/right arrow keys select events, and up/down arrow keys pan the timeline.
All event boxes have the same height. Selecting REQUEST_OK draws a dotted line
along the left edges to its original request when that request can be identified
in the current view.

Labels are measured and clipped inside their boxes. Every track is a single
vertical stack with fixed box positions. A tall timeline follows the earlier
viewer's time-scaled layout; crowded timestamps receive extra vertical spacing
so boxes do not overlap. The time labels and event details retain the recorded
timestamps. Scroll vertically to explore the session; Ctrl/Cmd+scroll zooms.

This implementation follows the interaction model of Moxygen's MoQ timeline
viewer: track columns, track filters, direction arrows, and event details.

## Specifications

- [MoQ Transport](https://datatracker.ietf.org/doc/draft-ietf-moq-transport/)
- [mLog](https://datatracker.ietf.org/doc/draft-pardue-moq-qlog-moq-events/)
- [qlog](https://datatracker.ietf.org/doc/draft-ietf-quic-qlog-main-schema/)

MIT licensed.
