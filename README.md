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

Labels are measured and clipped inside their boxes. Events whose time positions
would overlap use side-by-side slots within the same track, preserving the
linear time axis. Scroll horizontally or Shift+scroll to see wide columns.

This implementation follows the interaction model of Moxygen's MoQ timeline
viewer: track columns, track filters, direction arrows, and event details.

## Specifications

- [MoQ Transport](https://datatracker.ietf.org/doc/draft-ietf-moq-transport/)
- [mLog](https://datatracker.ietf.org/doc/draft-pardue-moq-qlog-moq-events/)
- [qlog](https://datatracker.ietf.org/doc/draft-ietf-quic-qlog-main-schema/)

MIT licensed.
