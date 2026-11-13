// Copyright (c) 2026 Aman Sharma. MIT licensed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseLog } from "../src/log-parser.js";
import { mergeTransfers } from "../src/transfer-events.js";
import { layoutTimeline } from "../src/timeline-layout.js";
import { findOriginalRequest, requestConnector } from "../src/request-links.js";

function message(id, type, fields = {}) {
  return {
    id,
    category: "control",
    messageType: type,
    trackKey: "connection",
    traceIndex: 0,
    endpoint: "client",
    sender: "server",
    direction: "received",
    streamId: "1",
    requestId: null,
    timeMs: 0,
    relativeMs: 0,
    ...fields,
  };
}
const reply = () =>
  message("reply", "REQUEST_OK", {
    sender: "client",
    direction: "sent",
    timeMs: 2,
    relativeMs: 2,
  });

test("REQUEST_OK without a Request ID connects to the original request on its stream", async () => {
  const parsed = parseLog(
    await readFile(new URL("../examples/demo.mlog", import.meta.url), "utf8"),
  );
  const events = mergeTransfers(parsed.events);
  const response = events.find((event) => event.messageType === "REQUEST_OK");
  const request = findOriginalRequest(response, events);
  assert.equal(response.requestId, null);
  assert.equal(request.messageType, "PUBLISH");
  assert.equal(request.streamId, response.streamId);
  assert.equal(request.sender, "server");
  assert.equal(request.requestId, "1");

  const layout = layoutTimeline({
    events,
    tracks: parsed.tracks,
    width: 1200,
    height: 560,
    min: 0,
    span: 240,
  });
  const connector = requestConnector(layout, response.id);
  const from = layout.boxes.find((box) => box.event.id === response.id);
  const to = layout.boxes.find((box) => box.event.id === request.id);
  assert.equal(connector.from, response.id);
  assert.equal(connector.to, request.id);
  assert.deepEqual(connector.points[0], {
    x: from.x,
    y: from.y + from.height / 2,
  });
  assert.deepEqual(connector.points.at(-1), {
    x: to.x,
    y: to.y + to.height / 2,
  });
  assert.ok(connector.points[1].x < Math.min(from.x, to.x));
  assert.equal(connector.points[1].x, connector.points[2].x);
  assert.ok(connector.dash.length > 0);
  assert.equal(requestConnector(layout, request.id), null);
  assert.equal(
    requestConnector({ ...layout, boxes: [from] }, response.id),
    null,
  );
});

test("both demo publishers have an acknowledgement linked to their own request", async () => {
  const parsed = parseLog(
    await readFile(new URL("../examples/demo.mlog", import.meta.url), "utf8"),
  );
  const events = mergeTransfers(parsed.events);
  const publishers = events.filter((event) => event.messageType === "PUBLISH");
  const replies = events.filter((event) => event.messageType === "REQUEST_OK");
  assert.equal(publishers.length, 2);
  assert.equal(replies.length, publishers.length);
  const requests = replies.map((reply) => findOriginalRequest(reply, events));
  assert.deepEqual(
    new Set(requests.map((request) => request.id)),
    new Set(publishers.map((publisher) => publisher.id)),
  );
  for (let i = 0; i < replies.length; i++) {
    assert.equal(replies[i].streamId, requests[i].streamId);
    assert.notEqual(replies[i].sender, requests[i].sender);
  }
});

test("legacy Request ID zero is scoped to the request initiator", () => {
  const correct = message("server-request", "PUBLISH", { requestId: "0" });
  const other = message("client-request", "PUBLISH", {
    requestId: "0",
    sender: "client",
    direction: "sent",
    streamId: "4",
  });
  const response = { ...reply(), requestId: "0" };
  assert.equal(findOriginalRequest(response, [other, correct]), correct);
});

test("shared IDs in other traces and conflicting explicit IDs do not create links", () => {
  const response = { ...reply(), requestId: "5" };
  assert.equal(
    findOriginalRequest(response, [
      message("other-trace", "PUBLISH", { traceIndex: 1, requestId: "5" }),
    ]),
    null,
  );
  assert.equal(
    findOriginalRequest(response, [
      message("wrong-id", "PUBLISH", { requestId: "6" }),
    ]),
    null,
  );
  assert.equal(
    findOriginalRequest(reply(), [
      message("later-request", "PUBLISH", { timeMs: 3 }),
    ]),
    null,
  );
});

test("updates and unrelated messages are excluded and ambiguous requests remain unlinked", () => {
  assert.equal(
    findOriginalRequest(reply(), [
      message("update", "REQUEST_UPDATE"),
      message("setup", "SETUP"),
    ]),
    null,
  );
  assert.equal(
    findOriginalRequest(reply(), [
      message("first", "PUBLISH"),
      message("second", "SUBSCRIBE"),
    ]),
    null,
  );
});

test("a trace with an unknown endpoint uses the recorded send and receive directions", () => {
  const request = message("request", "PUBLISH", {
    sender: "unknown",
    endpoint: "unknown",
    direction: "sent",
  });
  const response = {
    ...reply(),
    sender: "unknown",
    endpoint: "unknown",
    direction: "received",
  };
  assert.equal(findOriginalRequest(response, [request]), request);
});

test("paired observations retain request correlation across independent trace clocks", () => {
  const requestAtServer = message("request-server", "PUBLISH", {
    traceIndex: 1,
    endpoint: "server",
    direction: "sent",
    timeMs: 100,
  });
  const requestAtClient = message("request-client", "PUBLISH", { timeMs: 1 });
  const responseAtServer = message("reply-server", "REQUEST_OK", {
    traceIndex: 1,
    endpoint: "server",
    sender: "client",
    direction: "received",
    timeMs: 101,
  });
  const responseAtClient = reply();
  const request = {
    ...requestAtServer,
    observations: [requestAtServer, requestAtClient],
  };
  const response = {
    ...responseAtClient,
    observations: [responseAtClient, responseAtServer],
  };
  assert.equal(findOriginalRequest(response, [request]), request);
});
