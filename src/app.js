// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { Timeline } from "./timeline.js";
import {
  mergeTransfers,
  rawObservations,
  transferDirection,
} from "./transfer-events.js";
import { TRACK_COLORS, formatBytes, formatMs, objectLabel } from "./format.js";

const byId = (id) => document.getElementById(id);
const number = (value) => new Intl.NumberFormat("en-US").format(value);
const worker = new Worker(new URL("./log-worker.js", import.meta.url), {
  type: "module",
});
let enabledTracks = new Set();
let parsed = null;
let allTransfers = [];
let selected = null;
let requestId = 0;
let currentFile = null;
let currentText = "";

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
  tooltip.textContent = `${event.label}\n${formatMs(event.relativeMs)} · ${transferDirection(event)}\n${event.trackName || "Connection"}\n${event.observations.length} logged ${event.observations.length === 1 ? "observation" : "observations"}\n${objectLabel(event)}${event.bytes ? `\n${formatBytes(event.bytes)}` : ""}`;
  const viewport = byId("timeline-viewport");
  const width = viewport.clientWidth;
  tooltip.style.left = `${viewport.scrollLeft + Math.max(10, Math.min(position.x - viewport.scrollLeft + 14, width - Math.min(300, tooltip.offsetWidth) - 12))}px`;
  tooltip.style.top = `${viewport.scrollTop + Math.max(8, Math.min(position.y - viewport.scrollTop + 12, viewport.clientHeight - tooltip.offsetHeight - 10))}px`;
}

const PARAMETER_MESSAGES = new Set([
  "PUBLISH",
  "REQUEST_OK",
  "SUBSCRIBE",
  "SUBSCRIBE_OK",
  "REQUEST_UPDATE",
  "PUBLISH_STATE_NOTIFY",
  "FETCH",
  "FETCH_OK",
  "TRACK_STATUS",
  "PUBLISH_NAMESPACE",
  "SUBSCRIBE_NAMESPACE",
  "SUBSCRIBE_TRACKS",
]);
const TRACK_PROPERTY_MESSAGES = new Set([
  "PUBLISH",
  "REQUEST_OK",
  "SUBSCRIBE_OK",
  "FETCH_OK",
]);

function renderMessageList(
  sectionId,
  items,
  { visible, emptyText, labelKey = "name", fallbackLabel },
) {
  const section = byId(sectionId);
  const fields = section.querySelector("dl");
  section.hidden = !visible;
  fields.replaceChildren();
  if (section.hidden) return;
  fields.hidden = !Array.isArray(items) || items.length === 0;
  const empty = section.querySelector(".muted");
  empty.hidden = !fields.hidden;
  empty.textContent = emptyText;
  if (fields.hidden) return;

  for (const item of items) {
    const map =
      item && typeof item === "object" && !Array.isArray(item)
        ? item
        : { value: item };
    const entries = Object.entries(map).filter(([key]) => key !== labelKey);
    const value =
      entries.length === 0
        ? "Present"
        : entries.length === 1 && entries[0][0] === "value"
          ? entries[0][1]
          : Object.fromEntries(entries);
    fields.append(
      textElement(
        "dt",
        labelKey === "type" && map.type != null
          ? `type = ${map.type}`
          : String(map[labelKey] ?? fallbackLabel),
      ),
      textElement(
        "dd",
        typeof value === "string" ? value : JSON.stringify(value, null, 2),
      ),
    );
  }
}

function renderMessageLists(event) {
  const messages = [event, ...event.observations].map(
    (observation) => observation.data.message || observation.data,
  );
  const list = (field) =>
    messages.map((message) => message[field]).find(Array.isArray);
  const control = event.category === "control";
  const setup = list("setup_options");
  renderMessageList("detail-setup", setup, {
    visible: control && event.messageType === "SETUP",
    emptyText: Array.isArray(setup)
      ? "No setup options."
      : "Setup options were not logged.",
    fallbackLabel: "Unknown option",
  });

  const parameters = list("parameters");
  const count = messages
    .map((message) => message.number_of_parameters)
    .find((value) => value != null);
  const noParameters = Array.isArray(parameters)
    ? parameters.length === 0
    : count === 0 || count === "0";
  renderMessageList("detail-parameters", parameters, {
    visible:
      control &&
      (PARAMETER_MESSAGES.has(event.messageType) ||
        Array.isArray(parameters) ||
        count !== undefined),
    emptyText: noParameters ? "No parameters." : "Parameters were not logged.",
    fallbackLabel: "Unknown parameter",
  });

  const properties = list("track_properties");
  renderMessageList("detail-track-properties", properties, {
    visible:
      control &&
      (TRACK_PROPERTY_MESSAGES.has(event.messageType) ||
        Array.isArray(properties)),
    emptyText: "No track properties",
    labelKey: "type",
    fallbackLabel: "Unknown property",
  });
}

function select(event) {
  selected = event;
  const inspector = byId("inspector");
  inspector.hidden = !event;
  byId("workspace-layout").classList.toggle("inspecting", !!event);
  timeline.focus(event);
  if (!event) return;
  byId("detail-title").textContent = event.label;
  const isControl = event.category === "control";
  const fields = isControl
    ? [["Time", formatMs(event.relativeMs)]]
    : event.category === "object"
      ? [
          ["Time", formatMs(event.relativeMs)],
          ["Track", event.trackName || "Connection"],
          ["Group", event.groupId ?? "—"],
          ["Object", event.objectId ?? "—"],
          ["Payload", formatBytes(event.bytes)],
        ]
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
            event.receivedTimeMs === null
              ? null
              : formatMs(event.receivedTimeMs),
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
  renderMessageLists(event);
  byId("detail-json").textContent = JSON.stringify(
    rawObservations(event),
    null,
    2,
  );
  byId("copy-event").textContent = "Copy JSON";
}

const timeline = new Timeline(byId("timeline"), { select, hover });

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

function updateView(fit = false) {
  const trace = byId("trace-filter").value;
  const observations = (parsed?.events || []).filter(
    (event) =>
      enabledTracks.has(event.trackKey) &&
      (trace === "all" || event.traceIndex === Number(trace)),
  );
  const filtered = mergeTransfers(observations);
  const tracks = (parsed?.tracks || []).filter(
    (track) =>
      enabledTracks.has(track.id) &&
      filtered.some((event) => event.trackKey === track.id),
  );
  timeline.setData(filtered, tracks, fit);
  byId("visible-count").textContent = parsed
    ? `${number(filtered.length)} transfers · ${number(observations.length)} log records`
    : "No events loaded";
  byId("empty-state").hidden = !!parsed;
  if (selected && !filtered.some((event) => event.id === selected.id))
    select(null);
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
byId("all-tracks").addEventListener("click", () => {
  enabledTracks = new Set((parsed?.tracks || []).map((track) => track.id));
  trackControls();
  updateView();
});
byId("fit").addEventListener("click", () => timeline.fit());
byId("zoom-in").addEventListener("click", () => timeline.zoom(1.5));
byId("zoom-out").addEventListener("click", () => timeline.zoom(1 / 1.5));
byId("close-inspector").addEventListener("click", () => select(null));
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
timeline.schedule();
