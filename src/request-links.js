// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { AXIS_WIDTH, REQUEST_GUTTER } from "./timeline-layout.js";

const REQUEST_TYPES = new Set([
  "SUBSCRIBE",
  "PUBLISH",
  "FETCH",
  "TRACK_STATUS",
  "PUBLISH_NAMESPACE",
  "SUBSCRIBE_NAMESPACE",
  "SUBSCRIBE_TRACKS",
]);
const RESPONSE_TYPES = new Set([
  "REQUEST_OK",
  "REQUEST_ERROR",
  "SUBSCRIBE_OK",
  "FETCH_OK",
]);
const present = (value) => value !== null && value !== undefined;
const observations = (event) => event.observations || [event];

function matches(request, response) {
  // A trace identifies the connection. Shared stream/Request IDs in unrelated
  // traces must not connect unrelated requests.
  if (
    request.traceIndex !== response.traceIndex ||
    !present(request.traceIndex)
  )
    return false;
  const opposite =
    request.sender !== "unknown" && response.sender !== "unknown"
      ? request.sender !== response.sender
      : request.endpoint === response.endpoint &&
        request.direction !== response.direction;
  if (!opposite || request.timeMs > response.timeMs) return false;

  // Current replies use the request's bidirectional stream. Older records may
  // carry an explicit Request ID on the shared control stream.
  if (present(request.requestId) && present(response.requestId))
    return request.requestId === response.requestId;
  return present(request.streamId) && request.streamId === response.streamId;
}

export function findOriginalRequest(response, events) {
  if (
    response?.category !== "control" ||
    !RESPONSE_TYPES.has(response.messageType)
  )
    return null;
  const candidates = events.filter(
    (event) =>
      event.category === "control" &&
      REQUEST_TYPES.has(event.messageType) &&
      observations(event).some((request) =>
        observations(response).some((reply) => matches(request, reply)),
      ),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

function connector(from, to) {
  const left = Math.max(
    AXIS_WIDTH + 4,
    Math.min(from.x, to.x) - REQUEST_GUTTER,
  );
  const fromY = from.y + from.height / 2;
  const toY = to.y + to.height / 2;
  return {
    from: from.event.id,
    to: to.event.id,
    points: [
      { x: from.x, y: fromY },
      { x: left, y: fromY },
      { x: left, y: toY },
      { x: to.x, y: toY },
    ],
    dash: [1, 4],
  };
}

export function requestConnectors(layout, selectedId) {
  if (!selectedId) return [];
  const selected = layout.boxes.find((box) => box.event.id === selectedId);
  if (selected?.event.category !== "control") return [];
  const events = layout.boxes.map((box) => box.event);
  if (RESPONSE_TYPES.has(selected.event.messageType)) {
    const request = findOriginalRequest(selected.event, events);
    const original =
      request && layout.boxes.find((box) => box.event.id === request.id);
    return original ? [connector(selected, original)] : [];
  }
  if (!REQUEST_TYPES.has(selected.event.messageType)) return [];
  return layout.boxes
    .filter(
      (box) =>
        RESPONSE_TYPES.has(box.event.messageType) &&
        observations(selected.event).some((request) =>
          observations(box.event).some((response) =>
            matches(request, response),
          ),
        ) &&
        findOriginalRequest(box.event, events)?.id === selectedId,
    )
    .map((box) => connector(selected, box));
}

export function requestConnector(layout, selectedId) {
  return requestConnectors(layout, selectedId)[0] || null;
}
