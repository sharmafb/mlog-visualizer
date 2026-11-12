// Copyright (c) 2026 Aman Sharma. MIT licensed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseLog } from "../src/log-parser.js";
import {
  mergeTransfers,
  rawObservations,
  transferDirection,
} from "../src/transfer-events.js";
import {
  HEADER_HEIGHT,
  TEXT_PADDING,
  fitLabel,
  labelPosition,
  layoutTimeline,
  timeToY,
  yToTime,
} from "../src/timeline-layout.js";

const source = parseLog(
  await readFile(new URL("../examples/demo.mlog", import.meta.url), "utf8"),
);
const transfers = mergeTransfers(source.events);

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function assertSeparate(boxes) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++)
      assert.equal(
        overlaps(boxes[i], boxes[j]),
        false,
        `Overlapping boxes ${boxes[i].event.id}, ${boxes[j].event.id}`,
      );
  }
}

test("send and receive observations occupy one transfer box", () => {
  assert.equal(source.events.length, 94);
  assert.equal(transfers.length, 47);
  assert.ok(transfers.every((transfer) => transfer.observations.length === 2));
  const identities = transfers.flatMap((transfer) =>
    transfer.observations.map((event) => event.id),
  );
  assert.equal(new Set(identities).size, 94);
  assert.equal(identities.length, 94);
});

test("matching keeps original records and does not mutate them", () => {
  const before = structuredClone(source.events);
  mergeTransfers(source.events);
  assert.deepEqual(source.events, before);
  assert.deepEqual(
    rawObservations(transfers[0]).map((value) => value.direction),
    ["sent", "received"],
  );
  assert.equal(transferDirection(transfers[0]), "Client → Server");
});

test("repeated sends and repeated receives are retained", () => {
  const original = transfers[0].observations;
  const records = [
    original[0],
    { ...original[0], id: "repeat-send" },
    original[1],
    { ...original[1], id: "repeat-receive" },
  ];
  const result = mergeTransfers(records);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((value) => value.observations.length),
    [2, 2],
  );
  assert.equal(mergeTransfers(records.slice(0, 2)).length, 2);
});

test("unrelated messages, objects and publishers are never collapsed", () => {
  const pair = transfers.find(
    (value) => value.category === "object",
  ).observations;
  for (const change of [
    { streamId: "different" },
    { objectId: "different" },
    { sender: "different" },
    { bytes: 999 },
  ]) {
    assert.equal(
      mergeTransfers([pair[0], { ...pair[1], ...change }]).length,
      2,
    );
  }
  const controls = transfers.find(
    (value) => value.category === "control",
  ).observations;
  assert.equal(
    mergeTransfers([controls[0], { ...controls[1], requestId: "different" }])
      .length,
    2,
  );
});

test("unknown endpoints stay independent", () => {
  const events = transfers[0].observations.map((event) => ({
    ...event,
    endpoint: "unknown",
    sender: "unknown",
  }));
  assert.equal(mergeTransfers(events).length, 2);
});

test("a receive-only capture retains its direction and time", () => {
  const event = source.events.find(
    (value) => value.direction === "received" && value.endpoint === "client",
  );
  const result = mergeTransfers([event])[0];
  assert.equal(result.relativeMs, event.relativeMs);
  assert.equal(result.sentTimeMs, null);
  assert.equal(result.receivedTimeMs, event.timeMs);
  assert.equal(transferDirection(result), "Server → Client");
});

for (const width of [390, 768, 1200, 2038]) {
  for (const zoom of [0.25, 1, 8]) {
    test(`boxes never overlap at width ${width} and zoom ${zoom}`, () => {
      for (const sizes of [true, false]) {
        const layout = layoutTimeline({
          events: transfers,
          tracks: source.tracks,
          width,
          height: 560,
          min: -10,
          span: source.durationMs / zoom,
          sizes,
        });
        assert.equal(layout.columns.length, 3);
        assert.deepEqual(
          layout.columns.map((column) => column.id),
          source.tracks.map((track) => track.id),
        );
        assertSeparate(layout.boxes);
        assert.equal(layout.boxes.length, transfers.length);
        assert.ok(layout.columns.every((column) => column.slots === 1));
        for (const box of layout.boxes) {
          assert.ok(box.height >= 20);
          assert.ok(box.width >= 64);
          assert.ok(
            layout.anchors.some(
              (anchor) =>
                anchor.time === box.event.relativeMs &&
                Math.abs(anchor.y - box.y - box.height / 2) < 1e-8,
            ),
          );
          const column = layout.columns.find(
            (column) => column.id === box.event.trackKey,
          );
          assert.ok(
            column.boxes.every(
              (other) => other.x === box.x && other.width === box.width,
            ),
          );
        }
      }
    });
  }
}

test("events at exactly the same timestamp stack vertically in one column", () => {
  const original = transfers.find((event) => event.category === "object");
  const events = Array.from({ length: 200 }, (_, index) => ({
    ...original,
    id: String(index),
    relativeMs: 5,
    trackKey: "one-track",
  }));
  const layout = layoutTimeline({
    events,
    tracks: [{ id: "one-track", name: "One track" }],
    width: 600,
    height: 560,
    min: 0,
    span: 10,
    sizes: true,
  });
  assert.equal(layout.boxes.length, 200);
  assert.equal(layout.columns.length, 1);
  assert.equal(layout.columns[0].slots, 1);
  assertSeparate(layout.boxes);
  assert.equal(layout.width, 600);
  assert.ok(layout.height > 4000);
  assert.equal(new Set(layout.boxes.map((box) => box.x)).size, 1);
  assert.ok(layout.anchors.every((anchor) => anchor.time === 5));
});

test("time labels follow the expanded vertical positions", () => {
  const layout = layoutTimeline({
    events: transfers,
    tracks: source.tracks,
    width: 1200,
    height: 560,
    min: 0,
    span: source.durationMs,
    sizes: true,
  });
  for (const anchor of layout.anchors) {
    assert.ok(Math.abs(yToTime(layout, anchor.y) - anchor.time) < 1e-8);
  }
  for (const time of new Set(layout.anchors.map((anchor) => anchor.time))) {
    assert.ok(Math.abs(yToTime(layout, timeToY(layout, time)) - time) < 1e-8);
  }
  assert.ok(layout.height >= 2000);
});

test("same-time events in different tracks retain alignment", () => {
  const original = transfers[0];
  const events = [
    { ...original, id: "a0", trackKey: "a", relativeMs: 0, bytes: 40000 },
    { ...original, id: "a1", trackKey: "a", relativeMs: 1 },
    { ...original, id: "b1", trackKey: "b", relativeMs: 1 },
  ];
  const layout = layoutTimeline({
    events,
    tracks: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    width: 800,
    height: 560,
    min: 0,
    span: 10,
    sizes: true,
  });
  const same = layout.boxes.filter((box) => box.event.relativeMs === 1);
  assert.equal(same[0].y + same[0].height / 2, same[1].y + same[1].height / 2);
  assertSeparate(layout.boxes);
});

test("label fitting uses measured widths instead of character counts", () => {
  const measure = (text) =>
    Array.from(text).reduce(
      (sum, char) => sum + (char === "W" ? 15 : char === "i" ? 2 : 8),
      0,
    );
  assert.equal(fitLabel("iiiiiiii", 40, measure), "iiiiiiii");
  const label = fitLabel("WWWWWWWW", 40, measure);
  assert.ok(measure(label) <= 40);
  assert.ok(label.endsWith("…"));
  assert.equal(fitLabel("anything", 0, measure), "");
  const unicode = fitLabel("😀😀😀😀", 24, measure);
  assert.ok(!/[\uD800-\uDBFF]$/.test(unicode));
});

test("label ink is centered within the padded box", () => {
  const box = { x: 12, y: 40, width: 118, height: 24 };
  const metrics = {
    width: 80,
    actualBoundingBoxAscent: 9,
    actualBoundingBoxDescent: 3,
  };
  const position = labelPosition(box, metrics);
  assert.equal(position.x, box.x + TEXT_PADDING);
  assert.ok(position.x + position.width <= box.x + box.width - TEXT_PADDING);
  assert.equal(position.y - metrics.actualBoundingBoxAscent, position.top);
  assert.ok(position.top >= box.y + 3);
  assert.ok(position.top + position.height <= box.y + box.height - 3);
  assert.equal(
    position.top - box.y,
    box.y + box.height - position.top - position.height,
  );
});
