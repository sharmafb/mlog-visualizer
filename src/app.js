// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { Timeline } from "./timeline.js";
import {
  mergeTransfers,
  rawObservations,
  transferDirection,
} from "./transfer-events.js";
import {
  CATEGORY_NAMES,
  COLORS,
  TRACK_COLORS,
  formatBytes,
  formatMs,
  objectLabel,
} from "./format.js";

const byId = (id) => document.getElementById(id);
const number = (value) => new Intl.NumberFormat("en-US").format(value);
const worker = new Worker(new URL("./log-worker.js", import.meta.url), {
  type: "module",
});
const enabledCategories = new Set(Object.keys(CATEGORY_NAMES));
let enabledTracks = new Set();
let parsed = null;
let allTransfers = [];
let filtered = [];
let selected = null;
let page = 0;
let requestId = 0;
let currentFile = null;
let currentText = "";
const PAGE_SIZE = 50;

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function status(text, busy = false) {
  byId("status").textContent = text;
  byId("status").classList.toggle("busy", busy);
}

function error(message) {
  byId("error").textContent = message;
  byId("error").hidden = !message;
}

function hover(event, position) {
  const tooltip = byId("tooltip");
  tooltip.hidden = !event;
  if (!event) return;
  tooltip.textContent = `${event.label}\n${formatMs(event.relativeMs)} · ${transferDirection(event)}\n${event.trackName || "Connection"}\n${event.observations.length} logged ${event.observations.length === 1 ? "observation" : "observations"}\nGroup / object: ${objectLabel(event)}${event.bytes ? `\n${formatBytes(event.bytes)}` : ""}`;
  const viewport = byId("timeline-viewport");
  const width = viewport.clientWidth;
  tooltip.style.left = `${viewport.scrollLeft + Math.max(10, Math.min(position.x - viewport.scrollLeft + 14, width - Math.min(300, tooltip.offsetWidth) - 12))}px`;
  tooltip.style.top = `${viewport.scrollTop + Math.max(8, Math.min(position.y - viewport.scrollTop + 12, viewport.clientHeight - tooltip.offsetHeight - 10))}px`;
}

function select(event) {
  selected = event;
  const inspector = byId("inspector");
  inspector.hidden = !event;
  timeline.focus(event);
  renderRows();
  if (!event) return;
  byId("detail-title").textContent = event.label;
  const isControl = event.category === "control";
  const fields = isControl
    ? [["Time", formatMs(event.relativeMs)]]
    : [
        ["Event", event.name],
        ["Time", formatMs(event.relativeMs)],
        ["Recorded time", formatMs(event.timeMs)],
        ["Direction", transferDirection(event)],
        [
          "Sent at",
          event.sentTimeMs === null ? null : formatMs(event.sentTimeMs),
        ],
        [
          "Received at",
          event.receivedTimeMs === null ? null : formatMs(event.receivedTimeMs),
        ],
        ["Observations", String(event.observations.length)],
        [
          "Traces",
          [
            ...new Set(
              event.observations.map(
                (observation) => observation.traceIndex + 1,
              ),
            ),
          ].join(", "),
        ],
        ["Track", event.trackName || "Connection"],
        ["Stream", event.streamId],
        ["Request", event.requestId],
        ["Track alias", event.alias],
        ["Group", event.groupId],
        ["Subgroup", event.subgroupId],
        ["Object", event.objectId],
        ["Group delta", event.groupDelta],
        ["Object delta", event.objectDelta],
        ["Payload", formatBytes(event.bytes)],
      ];
  byId("detail-fields").replaceChildren();
  for (const [name, value] of fields) {
    if (value === null) continue;
    byId("detail-fields").append(
      textElement("dt", name),
      textElement("dd", value),
    );
  }
  byId("detail-observations").hidden = isControl;
  byId("detail-json").textContent = isControl
    ? ""
    : JSON.stringify(rawObservations(event), null, 2);
  byId("copy-event").textContent = "Copy JSON";
}

const timeline = new Timeline(byId("timeline"), { select, hover });

function categoryControls() {
  byId("category-filters").replaceChildren();
  for (const [category, label] of Object.entries(CATEGORY_NAMES)) {
    const row = textElement("label", "", "check-row");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = enabledCategories.has(category);
    input.dataset.category = category;
    input.addEventListener("change", () => {
      if (input.checked) enabledCategories.add(category);
      else enabledCategories.delete(category);
      updateView();
    });
    const dot = textElement("span", "", "dot");
    dot.style.background = COLORS[category];
    const count = parsed
      ? allTransfers.filter((event) => event.category === category).length
      : 0;
    row.append(
      input,
      dot,
      textElement("span", label),
      textElement("span", parsed ? number(count) : "", "count"),
    );
    byId("category-filters").append(row);
  }
}

function trackControls() {
  byId("track-filters").replaceChildren();
  if (!parsed?.tracks.length) {
    byId("track-filters").append(
      textElement("p", "No tracks in this log.", "muted"),
    );
    return;
  }
  for (const [index, track] of parsed.tracks.entries()) {
    const row = textElement("label", "", "check-row");
    row.title = track.name;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = enabledTracks.has(track.id);
    input.dataset.track = track.id;
    input.addEventListener("change", () => {
      if (input.checked) enabledTracks.add(track.id);
      else enabledTracks.delete(track.id);
      updateView();
    });
    const dot = textElement("span", "", "dot");
    dot.style.background = TRACK_COLORS[index % TRACK_COLORS.length];
    row.append(input, dot, textElement("span", track.name, "track-label"));
    byId("track-filters").append(row);
  }
}

function renderRows() {
  const rows = byId("event-rows");
  rows.replaceChildren();
  const start = page * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  for (const event of visible) {
    const row = document.createElement("tr");
    row.dataset.eventId = event.id;
    row.tabIndex = 0;
    row.setAttribute(
      "aria-label",
      `${event.label} at ${formatMs(event.relativeMs)}. Open event details.`,
    );
    row.classList.toggle("selected", selected?.id === event.id);
    row.addEventListener("click", () => select(event));
    row.addEventListener("keydown", (keyboard) => {
      if (keyboard.key === "Enter" || keyboard.key === " ") {
        keyboard.preventDefault();
        select(event);
      }
    });
    const time = textElement("td", formatMs(event.relativeMs), "time");
    const endpoint = textElement(
      "td",
      transferDirection(event),
      "endpoint-tag",
    );
    const name = document.createElement("td");
    const inner = textElement("span", "", "event-cell");
    const dot = textElement("span", "", "dot");
    dot.style.background = COLORS[event.category];
    inner.append(dot, textElement("span", event.label));
    name.append(inner);
    const track = textElement("td", event.trackName || "Connection");
    track.title = event.trackName || "Connection";
    const ids = textElement("td", objectLabel(event));
    ids.title = objectLabel(event);
    row.append(
      time,
      endpoint,
      name,
      track,
      ids,
      textElement("td", event.bytes ? formatBytes(event.bytes) : "—"),
    );
    rows.append(row);
  }
  if (!visible.length) {
    const row = document.createElement("tr");
    const cell = textElement(
      "td",
      parsed
        ? "No transfers match these filters."
        : "Your events will appear here.",
      "table-empty",
    );
    cell.colSpan = 6;
    row.append(cell);
    rows.append(row);
  }
  byId("page-label").textContent = filtered.length
    ? `${number(start + 1)}–${number(Math.min(start + PAGE_SIZE, filtered.length))} of ${number(filtered.length)} transfers`
    : "0 transfers";
  byId("previous-page").disabled = page === 0;
  byId("next-page").disabled = (page + 1) * PAGE_SIZE >= filtered.length;
}

function updateView(fit = false) {
  const search = byId("search").value.trim().toLowerCase();
  const trace = byId("trace-filter").value;
  const observations = (parsed?.events || []).filter(
    (event) =>
      enabledCategories.has(event.category) &&
      enabledTracks.has(event.trackKey) &&
      (trace === "all" || event.traceIndex === Number(trace)) &&
      (!search || event.search.includes(search)),
  );
  filtered = mergeTransfers(observations);
  page = 0;
  const tracks = (parsed?.tracks || []).filter(
    (track) =>
      enabledTracks.has(track.id) &&
      filtered.some((event) => event.trackKey === track.id),
  );
  timeline.setData(
    filtered,
    tracks,
    { ids: byId("show-ids").checked, sizes: byId("show-sizes").checked },
    fit,
  );
  byId("visible-count").textContent = parsed
    ? `${number(filtered.length)} transfers · ${number(observations.length)} log records`
    : "No events loaded";
  byId("empty-state").hidden = !!parsed;
  if (selected && !filtered.some((event) => event.id === selected.id))
    select(null);
  renderRows();
}

function receive({ data }) {
  if (data.id !== requestId) return;
  if (data.error) {
    error(`Could not read this log: ${data.error}`);
    status("Could not read file");
    return;
  }
  const oldParsed = parsed;
  parsed = data.result;
  allTransfers = mergeTransfers(parsed.events);
  window.dispatchEvent(
    new CustomEvent("mlog-loaded", {
      detail: { events: parsed.events.length },
    }),
  );
  enabledTracks = new Set(parsed.tracks.map((track) => track.id));
  byId("file-summary").hidden = false;
  byId("file-name").textContent = currentFile.name;
  byId("file-format").textContent =
    `${parsed.metadata.format} · ${parsed.metadata.traceCount} ${parsed.metadata.traceCount === 1 ? "trace" : "traces"}`;
  byId("legacy-controls").hidden = !parsed.metadata.usesLegacyUnits;
  byId("endpoint-controls").hidden =
    !parsed.events.some((event) => event.endpoint === "unknown") &&
    !byId("endpoint").value;
  byId("session-title").textContent = parsed.metadata.title;
  document.title = `${currentFile.name} · mLog Visualizer`;
  byId("timeline-subtitle").textContent =
    "One vertical stack per track · crowded timestamps are spaced for readability";
  byId("trace-filter").replaceChildren(new Option("All traces", "all"));
  for (let i = 0; i < parsed.metadata.traceCount; i++) {
    const endpoints = [
      ...new Set(
        parsed.events
          .filter((event) => event.traceIndex === i)
          .map((event) => event.endpoint),
      ),
    ];
    byId("trace-filter").append(
      new Option(
        `Trace ${i + 1}${endpoints.length ? ` · ${endpoints.join(" + ")}` : ""}`,
        String(i),
      ),
    );
  }
  byId("warnings").replaceChildren(
    ...parsed.warnings.map((message) => textElement("p", message)),
  );
  byId("warnings").hidden = !parsed.warnings.length;
  categoryControls();
  trackControls();
  select(null);
  updateView(!oldParsed || oldParsed !== parsed);
  status(
    `${number(parsed.events.length)} log records · ${number(allTransfers.length)} transfers`,
  );
  document.body.dataset.loadedEvents = String(parsed.events.length);
  document.body.dataset.loadedFile = currentFile.name;
  document.body.dataset.loadedTransfers = String(allTransfers.length);
}

worker.addEventListener("message", receive);
worker.addEventListener("error", () => {
  error(
    "The log reader could not start. Please reload the page and try again.",
  );
  status("Reader unavailable");
});

function parseCurrent() {
  if (!currentFile) return;
  error("");
  status("Reading your log…", true);
  worker.postMessage({
    id: ++requestId,
    text: currentText,
    options: {
      legacyTimeUnit: byId("time-unit").value,
      vantagePoint: byId("endpoint").value || null,
    },
  });
}

async function loadFile(file) {
  if (!file) return;
  if (file.size > 150 * 1024 * 1024) {
    error(
      "This file is larger than 150 MiB. Split it into smaller traces before loading it.",
    );
    return;
  }
  const id = ++requestId;
  error("");
  status("Opening your file…", true);
  try {
    const text = await file.text();
    if (id !== requestId) return;
    currentFile = file;
    currentText = text;
    byId("endpoint").value = "";
    byId("search").value = "";
    parseCurrent();
  } catch (failure) {
    error(`Could not open this file: ${failure.message}`);
    status("Could not open file");
  }
}

byId("file-input").addEventListener("change", (event) =>
  loadFile(event.target.files[0]),
);
const dropzone = byId("dropzone");
for (const name of ["dragenter", "dragover"])
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
dropzone.addEventListener("drop", (event) =>
  loadFile(event.dataTransfer.files[0]),
);
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());
byId("sample-button").addEventListener("click", async () => {
  error("");
  status("Opening sample…", true);
  try {
    const response = await fetch(
      new URL("../examples/demo.mlog", import.meta.url),
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await loadFile(
      new File([await response.text()], "demo.mlog", {
        type: "application/json",
      }),
    );
  } catch (failure) {
    error(`Could not open the sample: ${failure.message}`);
    status("Sample unavailable");
  }
});
byId("time-unit").addEventListener("change", parseCurrent);
byId("endpoint").addEventListener("change", parseCurrent);
byId("trace-filter").addEventListener("change", () => updateView(true));
byId("show-ids").addEventListener("change", () => updateView());
byId("show-sizes").addEventListener("change", () => updateView());
let searchTimer;
byId("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => updateView(), 100);
});
byId("all-types").addEventListener("click", () => {
  for (const category of Object.keys(CATEGORY_NAMES))
    enabledCategories.add(category);
  categoryControls();
  updateView();
});
byId("all-tracks").addEventListener("click", () => {
  enabledTracks = new Set((parsed?.tracks || []).map((track) => track.id));
  trackControls();
  updateView();
});
byId("fit").addEventListener("click", () => timeline.fit());
byId("zoom-in").addEventListener("click", () => timeline.zoom(1.5));
byId("zoom-out").addEventListener("click", () => timeline.zoom(1 / 1.5));
byId("close-inspector").addEventListener("click", () => select(null));
byId("previous-page").addEventListener("click", () => {
  page = Math.max(0, page - 1);
  renderRows();
});
byId("next-page").addEventListener("click", () => {
  if ((page + 1) * PAGE_SIZE < filtered.length) page++;
  renderRows();
});
byId("copy-event").addEventListener("click", async () => {
  if (!selected) return;
  try {
    await navigator.clipboard.writeText(
      JSON.stringify(rawObservations(selected), null, 2),
    );
    byId("copy-event").textContent = "Copied";
  } catch {
    byId("copy-event").textContent = "Select JSON to copy";
  }
});
categoryControls();
timeline.schedule();
