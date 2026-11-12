// Copyright (c) 2026 Aman Sharma. MIT licensed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseLog, parseJson, readRecords } from "../src/log-parser.js";
import { formatBytes, formatMs, objectLabel } from "../src/format.js";

const event = (time, name = "object_datagram_created", data = {}) => ({
  time,
  name: `moqt:${name}`,
  data,
});
const trace = (events, type = "client", extra = {}) => ({
  vantage_point: { type },
  events,
  ...extra,
});
const contained = (traces) =>
  JSON.stringify({
    file_schema: "urn:ietf:params:qlog:file:contained",
    serialization_format: "application/qlog+json",
    traces,
  });

test("current FileMLogger times are fractional milliseconds", () => {
  const result = parseLog(contained([trace([event(12.345), event(13.125)])]));
  assert.deepEqual(
    result.events.map((value) => value.timeMs),
    [12.345, 13.125],
  );
  assert.equal(result.metadata.usesLegacyUnits, false);
  assert.equal(result.events[0].endpoint, "client");
});

test("current file schema takes precedence over a legacy unit hint", () => {
  const result = parseLog(
    contained([
      trace([event(12.345)], "client", { configuration: { time_units: "ns" } }),
    ]),
  );
  assert.equal(result.events[0].timeMs, 12.345);
});

test("legacy native records honor Linux and macOS units", () => {
  const records = [
    { ...event("12345000"), vantagePoint: "client" },
    { ...event("12346000"), vantagePoint: "client" },
  ];
  const text = records
    .map((value) => JSON.stringify(value, null, 2))
    .join("\n");
  assert.equal(parseLog(text).events[0].timeMs, 12.345);
  assert.equal(
    parseLog(text, { legacyTimeUnit: "us" }).events[0].timeMs,
    12345,
  );
  assert.equal(parseLog(text).metadata.usesLegacyUnits, true);
});

test("record reader respects braces, quotes, unicode, and record separators", () => {
  const a = { ...event(1), data: { text: 'quoted " { } \\ café' } };
  const b = event(2);
  assert.deepEqual(
    readRecords(
      `\uFEFF\u001e${JSON.stringify(a, null, 2)}\n\u001e${JSON.stringify(b)}\n`,
    ),
    [a, b],
  );
});

test("incomplete and malformed JSON have readable errors", () => {
  assert.throws(() => parseLog('{"time":1'), /incomplete/);
  assert.throws(() => parseLog('{"time":}'), /Invalid JSON record/);
  assert.throws(() => parseLog(""), /empty/);
  assert.throws(() => parseLog("not a log"), /Unexpected text/);
});

test("numeric 64-bit IDs survive JSON parsing without rounding", () => {
  const json =
    '{"time":12.345,"group_id":18446744073709551615,"label":"18446744073709551615","object_id":9007199254740993}';
  assert.deepEqual(parseJson(json), {
    time: 12.345,
    group_id: "18446744073709551615",
    label: "18446744073709551615",
    object_id: "9007199254740993",
  });
  const text =
    '{"file_schema":"urn:ietf:params:qlog:file:contained","traces":[{"vantage_point":{"type":"client"},"events":[{"time":0,"name":"moqt:object_datagram_created","data":{"group_id":18446744073709551615,"object_id":9007199254740993}}]}]}';
  const parsed = parseLog(text).events[0];
  assert.equal(parsed.groupId, "18446744073709551615");
  assert.equal(parsed.objectId, "9007199254740993");
});

test("integer IDs written with exponents or decimal zeros stay exact", () => {
  const result = parseJson(
    '{"id":9.007199254740993e15,"max":18446744073709551615.0,"fraction":12.5,"float":1e100}',
  );
  assert.deepEqual(result, {
    id: "9007199254740993",
    max: "18446744073709551615",
    fraction: 12.5,
    float: 1e100,
  });
  assert.throws(() => parseJson('{"id":01e17}'));
  assert.throws(() => parseJson('{"id":9007199254740993.}'));
});

test("JSON-SEQ header provides endpoint and time context", () => {
  const header = {
    file_schema: "urn:ietf:params:qlog:file:sequential",
    trace: { vantage_point: { type: "server" } },
  };
  const text = [header, event(1.5), event(2.5)]
    .map((value) => `\u001e${JSON.stringify(value)}\n`)
    .join("");
  const result = parseLog(text);
  assert.equal(result.metadata.format, "Sequential qlog");
  assert.deepEqual(
    result.events.map((value) => [value.timeMs, value.endpoint]),
    [
      [1.5, "server"],
      [2.5, "server"],
    ],
  );
});

test("delta timestamps accumulate before unrelated events are filtered out", () => {
  const raw = [
    event(1),
    { time: 2, name: "quic:packet_received", data: { frames: [] } },
    event(3),
  ];
  const result = parseLog(
    contained([
      trace(raw, "client", {
        common_fields: { time_format: "relative_to_previous_event" },
      }),
    ]),
  );
  assert.deepEqual(
    result.events.map((value) => value.timeMs),
    [1, 6],
  );
});

test("older qlog tuple events and explicit units work", () => {
  const data = {
    traces: [
      trace(
        [[1000, "moqt", "object_datagram_created", { object_id: 0 }]],
        "server",
        { configuration: { time_units: "us" } },
      ),
    ],
  };
  const result = parseLog(JSON.stringify(data));
  assert.equal(result.events[0].timeMs, 1);
  assert.equal(result.events[0].objectId, "0");
});

test("event_fields describes reordered tuple fields", () => {
  const data = {
    traces: [
      trace(
        [["moqt", "subgroup_header_created", 3, { group_id: 0, stream_id: 3 }]],
        "server",
        { event_fields: ["category", "event", "time", "data"] },
      ),
    ],
  };
  const result = parseLog(JSON.stringify(data));
  assert.equal(result.events[0].name, "moqt:subgroup_header_created");
  assert.equal(result.events[0].timeMs, 3);
});

test("known epochs align traces using small offsets", () => {
  const a = trace([event(5)], "client", {
    common_fields: { reference_time: { epoch: "2026-01-01T00:00:00Z" } },
  });
  const b = trace([event(6)], "server", {
    common_fields: { reference_time: { epoch: "2026-01-01T00:00:01Z" } },
  });
  const result = parseLog(contained([a, b]));
  assert.deepEqual(
    result.events.map((value) => value.relativeMs),
    [0, 1001],
  );
  assert.equal(result.metadata.clockAligned, true);
});

test("independent trace clocks are identified", () => {
  const result = parseLog(
    contained([trace([event(1)]), trace([event(2)], "server")]),
  );
  assert.ok(result.warnings.some((value) => value.includes("clock alignment")));
});

test("missing endpoint is not inferred from the event name", () => {
  const result = parseLog(contained([{ events: [event(1)] }]));
  assert.equal(result.events[0].endpoint, "unknown");
  assert.equal(
    parseLog(contained([{ events: [event(1)] }]), { vantagePoint: "server" })
      .events[0].endpoint,
    "server",
  );
});

test("aliases are scoped to each publishing endpoint", () => {
  const publish = (time, point, name) => ({
    ...event(time, "control_message_created", {
      message: {
        type: "publish",
        request_id: 0,
        track_alias: 0,
        track_namespace: [{ value: "live" }],
        track_name: { value: name },
      },
    }),
    vantagePoint: point,
  });
  const records = [
    publish(0, "client", "audio"),
    publish(1, "server", "video"),
    {
      ...event(2, "object_datagram_created", { track_alias: 0 }),
      vantagePoint: "client",
    },
    {
      ...event(3, "object_datagram_parsed", { track_alias: 0 }),
      vantagePoint: "client",
    },
  ];
  const result = parseLog(JSON.stringify(records), { legacyTimeUnit: "ms" });
  assert.deepEqual(
    result.events.slice(2).map((value) => value.trackName),
    ["live/audio", "live/video"],
  );
});

test("subgroup deltas preserve large IDs and isolate sending and receiving", () => {
  const events = [
    event(0, "subgroup_header_created", {
      stream_id: 3,
      group_id: "9007199254740993",
      subgroup_id_mode: 1,
    }),
    event(1, "subgroup_object_created", {
      stream_id: 3,
      object_id_delta: "9007199254740993",
    }),
    event(2, "subgroup_header_parsed", {
      stream_id: 3,
      group_id: 0,
      subgroup_id_mode: 2,
    }),
    event(3, "subgroup_object_parsed", { stream_id: 3, object_id_delta: 0 }),
    event(4, "subgroup_object_created", { stream_id: 3, object_id_delta: 0 }),
  ];
  const result = parseLog(contained([trace(events)]));
  assert.deepEqual(
    result.events
      .filter((value) => value.name.includes("subgroup_object"))
      .map((value) => [value.groupId, value.subgroupId, value.objectId]),
    [
      ["9007199254740993", "0", "9007199254740993"],
      ["0", "0", "0"],
      ["9007199254740993", "0", "9007199254740994"],
    ],
  );
});

test("fetch descending deltas and timed-out range ends resolve correctly", () => {
  const raw = [
    event(0, "control_message_created", {
      message: {
        type: "fetch",
        request_id: 7,
        track_name: { value: "video" },
        parameters: [{ name: "group_order", value: 2 }],
      },
    }),
    event(1, "fetch_header_parsed", { stream_id: 7, request_id: 7 }),
    event(2, "fetch_object_parsed", {
      stream_id: 7,
      group_id_delta: 14,
      object_id_delta: 0,
      subgroup_id_bits: 0,
    }),
    event(3, "fetch_object_parsed", {
      stream_id: 7,
      group_id_delta: 0,
      object_id_delta: 2,
      subgroup_id_bits: 0,
    }),
    event(4, "fetch_object_parsed", {
      stream_id: 7,
      group_id_delta: 4,
      object_id_delta: 0,
      end_of_timed_out_range: true,
    }),
  ];
  const events = parseLog(contained([trace(raw)])).events.filter(
    (value) => value.category === "fetch",
  );
  assert.deepEqual(
    events.slice(1).map((value) => [value.groupId, value.objectId]),
    [
      ["14", "0"],
      ["13", "2"],
      ["4", "0"],
    ],
  );
  assert.equal(events.at(-1).label, "Timed-out range");
  assert.equal(events.at(-1).trackName, "video");
});

test("unknown fetch ordering keeps unresolved deltas", () => {
  const events = [
    event(0, "fetch_header_parsed", { stream_id: 7, request_id: 7 }),
    event(1, "fetch_object_parsed", {
      stream_id: 7,
      group_id_delta: 14,
      object_id_delta: 0,
    }),
    event(2, "fetch_object_parsed", {
      stream_id: 7,
      group_id_delta: 0,
      object_id_delta: 1,
    }),
  ];
  const result = parseLog(contained([trace(events)]));
  assert.equal(result.events.at(-1).groupId, null);
  assert.equal(result.events.at(-1).groupDelta, "0");
});

test("zero payload lengths and zero IDs retain their meaning", () => {
  const parsed = parseLog(
    contained([
      trace([
        event(0, "object_datagram_created", {
          group_id: 0,
          object_id: 0,
          object_payload: { length: 0 },
        }),
      ]),
    ]),
  ).events[0];
  assert.equal(objectLabel(parsed), "[DATAGRAM] gp = 0, obj = 0");
  assert.equal(parsed.bytes, 0);
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatMs(12.345), "12.345 ms");
});

test("transport resets and stop_sending are shown from packet frames", () => {
  const records = [
    event(0, "subgroup_header_created", {
      stream_id: 3,
      track_alias: 9,
      group_id: 0,
    }),
    {
      time: 1,
      name: "quic:packet_received",
      data: {
        frames: [
          { frame_type: "stop_sending", stream_id: 3, error_code: 13 },
          { frame_type: "reset_stream", stream_id: 7, error_code: 13 },
        ],
      },
    },
  ];
  const result = parseLog(contained([trace(records)]));
  assert.deepEqual(
    result.events.slice(1).map((value) => value.name),
    ["quic:stop_sending", "quic:reset_stream"],
  );
  assert.equal(result.events[1].trackName, "Track alias 9 (client)");
});

test("empty traces are accepted and unknown MoQ events remain inspectable", () => {
  assert.equal(parseLog(contained([trace([])])).events.length, 0);
  assert.equal(
    parseLog(contained([trace([event(1, "future_extension")])])).events[0]
      .category,
    "other",
  );
});

test("invalid timestamps do not silently become zero", () => {
  for (const time of [null, false, "", " ", "not a timestamp", "1e999"]) {
    assert.throws(
      () => parseLog(contained([trace([event(time)])])),
      /timestamp|Timestamp/,
    );
  }
});

test("synthetic contained, sequential and legacy examples agree", async () => {
  const root = new URL("../examples/", import.meta.url);
  const containedResult = parseLog(
    await readFile(new URL("demo.mlog", root), "utf8"),
  );
  const sequence = parseLog(
    await readFile(new URL("demo.sqlog", root), "utf8"),
  );
  const legacy = parseLog(
    await readFile(new URL("legacy-linux.mlog", root), "utf8"),
  );
  assert.equal(containedResult.events.length, 94);
  assert.equal(
    containedResult.events.filter((value) => value.endpoint === "client")
      .length,
    sequence.events.length,
  );
  assert.deepEqual(
    sequence.events.map((value) => [
      value.name,
      value.timeMs,
      value.groupId,
      value.objectId,
    ]),
    legacy.events.map((value) => [
      value.name,
      value.timeMs,
      value.groupId,
      value.objectId,
    ]),
  );
});
