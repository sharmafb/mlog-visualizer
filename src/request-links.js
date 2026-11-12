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
  if (response?.category !== "control" || response.messageType !== "REQUEST_OK")
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

export function requestConnector(layout, selectedId) {
  if (!selectedId) return null;
  const response = layout.boxes.find((box) => box.event.id === selectedId);
  if (
    response?.event.category !== "control" ||
    response.event.messageType !== "REQUEST_OK"
  )
    return null;
  const request = findOriginalRequest(
    response.event,
    layout.boxes.map((box) => box.event),
  );
  if (!request) return null;
  const original = layout.boxes.find((box) => box.event.id === request.id);
  const left = Math.max(
    AXIS_WIDTH + 4,
    Math.min(response.x, original.x) - REQUEST_GUTTER,
  );
  const responseY = response.y + response.height / 2;
  const requestY = original.y + original.height / 2;
  return {
    from: response.event.id,
    to: original.event.id,
    points: [
      { x: response.x, y: responseY },
      { x: left, y: responseY },
      { x: left, y: requestY },
      { x: original.x, y: requestY },
    ],
    dash: [1, 4],
  };
}
