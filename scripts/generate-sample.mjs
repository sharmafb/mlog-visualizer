// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { mkdir, writeFile } from "node:fs/promises";

const directory = new URL("../examples/", import.meta.url);
await mkdir(directory, { recursive: true });
const client = [];
const server = [];
function emit(endpoint, time, suffix, data) {
  (endpoint === "client" ? client : server).push({
    time,
    name: `moqt:${suffix}`,
    data,
  });
}
function transfer(sender, time, delay, kind, data) {
  emit(sender, time, `${kind}_created`, data);
  emit(
    sender === "client" ? "server" : "client",
    time + delay,
    `${kind}_parsed`,
    structuredClone(data),
  );
}
const track = (name) => ({
  track_namespace: [{ value: "live" }, { value: "demo" }],
  track_name: { value: name },
});
transfer("client", 0, 0.25, "control_message", {
  stream_id: 0,
  message: {
    type: "setup",
    setup_options: [{ name: "max_request_id", value: 128 }],
  },
});
transfer("server", 0.5, 0.65, "control_message", {
  stream_id: 0,
  message: {
    type: "setup",
    setup_options: [{ name: "max_request_id", value: 128 }],
  },
});
transfer("server", 2, 1, "control_message", {
  stream_id: 1,
  message: {
    type: "publish",
    request_id: 1,
    track_alias: 0,
    ...track("video"),
    number_of_parameters: 0,
  },
});
transfer("client", 5, 0.2, "control_message", {
  stream_id: 4,
  message: {
    type: "publish",
    request_id: 0,
    track_alias: 0,
    ...track("audio"),
    number_of_parameters: 0,
  },
});
transfer("client", 6, 0.25, "control_message", {
  stream_id: 1,
  message: { type: "request_ok", number_of_parameters: 0 },
});
transfer("server", 10, 2.345, "subgroup_header", {
  stream_id: 3,
  track_alias: 0,
  group_id: 14,
  subgroup_id_mode: 1,
  first_object: true,
  contains_end_of_group: true,
  properties_present: true,
});
for (let i = 0; i < 14; i++) {
  transfer("server", 12.5 + i * 7, 17.5 + (i % 3), "subgroup_object", {
    stream_id: 3,
    object_id_delta: 0,
    object_payload_length: i === 0 ? 40000 : 1700 + i * 50,
    properties: [{ type: 2, value: i }],
  });
}
for (let i = 0; i < 20; i++) {
  transfer("client", 14 + i * 5, 1.8 + (i % 4) * 0.2, "object_datagram", {
    track_alias: 0,
    group_id: 14,
    object_id: i,
    object_payload: { length: 256 },
    end_of_group: i === 19,
  });
}
transfer("client", 120, 1, "padding_datagram", { padding_length: 32 });
transfer("client", 150, 2, "control_message", {
  stream_id: 8,
  message: {
    type: "fetch",
    request_id: 2,
    ...track("video"),
    number_of_parameters: 1,
    parameters: [{ name: "group_order", value: 2 }],
  },
});
transfer("server", 155, 2, "fetch_header", { stream_id: 7, request_id: 2 });
transfer("server", 160, 5, "fetch_object", {
  stream_id: 7,
  group_id_delta: 14,
  object_id_delta: 0,
  subgroup_id_bits: 0,
  datagram: false,
  object_payload_length: 12000,
});
transfer("server", 170, 5, "fetch_object", {
  stream_id: 7,
  group_id_delta: 0,
  object_id_delta: 0,
  subgroup_id_bits: 0,
  datagram: false,
  object_payload_length: 6000,
});
transfer("server", 190, 5, "fetch_object", {
  stream_id: 7,
  group_id_delta: 10,
  object_id_delta: 0,
  datagram: false,
  end_of_timed_out_range: true,
});
transfer("server", 215, 1, "control_message", {
  stream_id: 0,
  message: { type: "goaway", new_session_uri: { length: 0 }, timeout: 0 },
});
for (const events of [client, server]) events.sort((a, b) => a.time - b.time);
const metadata = (type) => ({
  title: `${type === "client" ? "Client" : "Server"} trace`,
  vantage_point: { type },
  event_schemas: ["urn:ietf:params:qlog:events:moqt-08"],
  common_fields: {
    time_format: "relative_to_epoch",
    reference_time: { clock_type: "system", epoch: "2026-01-01T00:00:00.000Z" },
  },
});
const document = {
  file_schema: "urn:ietf:params:qlog:file:contained",
  serialization_format: "application/qlog+json",
  title: "Live media session (synthetic)",
  traces: [
    { ...metadata("client"), events: client },
    { ...metadata("server"), events: server },
  ],
};
await writeFile(
  new URL("demo.mlog", directory),
  JSON.stringify(document, null, 2) + "\n",
);
const sequential = {
  file_schema: "urn:ietf:params:qlog:file:sequential",
  serialization_format: "application/qlog+json-seq",
  title: "Client session (synthetic)",
  trace: metadata("client"),
};
await writeFile(
  new URL("demo.sqlog", directory),
  [sequential, ...client]
    .map((record) => `\u001e${JSON.stringify(record)}\n`)
    .join(""),
);
const legacy = client.map(({ time, name, data }) => ({
  time: String(Math.round(time * 1e6)),
  vantagePoint: "client",
  name,
  data,
}));
await writeFile(
  new URL("legacy-linux.mlog", directory),
  legacy.map((record) => JSON.stringify(record, null, 2)).join("\n") + "\n",
);
console.log(
  `Generated ${client.length + server.length} synthetic events and three file-format examples.`,
);
