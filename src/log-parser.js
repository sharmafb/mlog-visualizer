// Copyright (c) 2026 Aman Sharma. MIT licensed.

const UNITS = { ns: 1e-6, us: 1e-3, ms: 1, s: 1000 };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const UINT64_MAX = (1n << 64n) - 1n;

function integerToken(token) {
  if (/^-?(0|[1-9][0-9]*)$/.test(token)) return BigInt(token);
  const parts =
    /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(token);
  if (!parts) return null;
  const fraction = parts[3] || "";
  const scale = Number(parts[4] || 0) - fraction.length;
  let digits = parts[2] + fraction;
  if (scale >= 0) {
    if (scale > 20 || digits.length + scale > 21) return null;
    digits += "0".repeat(scale);
  } else {
    if (-scale > digits.length || /[1-9]/.test(digits.slice(scale)))
      return null;
    digits = digits.slice(0, scale) || "0";
  }
  const integer = BigInt(parts[1] + digits);
  return integer <= UINT64_MAX && integer >= -UINT64_MAX ? integer : null;
}

// qlog permits uint64 values as strings. Preserve numeric uint64s too, before
// JSON.parse can round them; timestamps are subsequently converted to float64.
export function parseJson(text) {
  let output = "";
  let last = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char !== "-" && (char < "0" || char > "9")) continue;
    let end = i + 1;
    while (end < text.length && /[0-9eE+.-]/.test(text[end])) end++;
    const token = text.slice(i, end);
    const integer = integerToken(token);
    if (integer !== null) {
      if (integer > MAX_SAFE || integer < -MAX_SAFE) {
        output += text.slice(last, i) + JSON.stringify(integer.toString());
        last = end;
      }
    }
    i = end - 1;
  }
  return JSON.parse(output + text.slice(last));
}

export function readRecords(text) {
  text = text.replace(/^\uFEFF/, "");
  const records = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (start < 0) {
      if (/\s/.test(char) || char === "\u001e") continue;
      if (char !== "{" && char !== "[")
        throw new Error(`Unexpected text at character ${i + 1}.`);
      start = i;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      if (--depth === 0) {
        try {
          records.push(parseJson(text.slice(start, i + 1)));
        } catch (error) {
          throw new Error(
            `Invalid JSON record ${records.length + 1}: ${error.message}`,
          );
        }
        start = -1;
      }
    }
  }
  if (start >= 0)
    throw new Error("The file ends in an incomplete JSON record.");
  if (!records.length) throw new Error("The file is empty.");
  return records;
}

function sources(records) {
  const first = records[0];
  if (first?.traces) {
    if (records.length !== 1)
      throw new Error("A contained qlog file must be one JSON document.");
    return {
      traces: first.traces,
      format: "Contained qlog",
      title: first.title,
      standard: !!first.file_schema,
    };
  }
  if (first?.trace || first?.trace_seq) {
    return {
      traces: [
        { ...(first.trace || first.trace_seq), events: records.slice(1) },
      ],
      format: "Sequential qlog",
      title: first.title,
      standard: !!first.file_schema,
    };
  }
  if (first?.events)
    return { traces: [first], format: "Trace JSON", standard: false };
  if (Array.isArray(first)) {
    if (records.length !== 1)
      throw new Error("An event array must be one JSON document.");
    return {
      traces: [{ events: first }],
      format: "Event array",
      standard: false,
    };
  }
  if (first?.name)
    return {
      traces: [{ events: records }],
      format: "Legacy mLog records",
      standard: false,
    };
  throw new Error("No qlog traces or mLog event records were found.");
}

function objectEvent(raw, fields) {
  if (!Array.isArray(raw)) return raw;
  if (Array.isArray(fields) && fields.length) {
    const event = Object.fromEntries(fields.map((field, i) => [field, raw[i]]));
    event.time ??= event.relative_time;
    event.name ??= event.event;
    if (typeof event.name === "string" && !event.name.includes(":")) {
      event.name = `${event.category || "moqt"}:${event.name}`;
    }
    return event;
  }
  const event =
    raw.length >= 4
      ? { time: raw[0], name: raw[2], data: raw[3], category: raw[1] }
      : { time: raw[0], name: raw[1], data: raw[2] };
  if (
    typeof event.name === "string" &&
    !event.name.includes(":") &&
    ["moqt", "moq"].includes(event.category)
  ) {
    event.name = `${event.category}:${event.name}`;
  }
  return event;
}

function point(value) {
  value = typeof value === "object" ? value?.type : value;
  return ["client", "server"].includes(String(value).toLowerCase())
    ? String(value).toLowerCase()
    : "unknown";
}

function other(endpoint) {
  return endpoint === "client"
    ? "server"
    : endpoint === "server"
      ? "client"
      : "unknown";
}

function identifier(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!/^[0-9]+$/.test(text)) return text;
  return BigInt(text).toString();
}

function addId(value, delta) {
  if (
    value === null ||
    delta === null ||
    !/^[0-9]+$/.test(value) ||
    !/^-?[0-9]+$/.test(String(delta))
  )
    return null;
  const result = BigInt(value) + BigInt(delta);
  return result >= 0n && result <= UINT64_MAX ? result.toString() : null;
}

function byteString(value) {
  if (typeof value === "string") return value;
  if (typeof value?.value === "string") return value.value;
  if (typeof value?.value_bytes === "string") return `0x${value.value_bytes}`;
  return null;
}

function trackName(message) {
  const explicit = message.track_id ?? message.trackId;
  if (explicit != null) return String(explicit);
  const name = byteString(message.track_name);
  if (name === null) return null;
  const namespace = Array.isArray(message.track_namespace)
    ? message.track_namespace
    : message.track_namespace == null
      ? []
      : [message.track_namespace];
  return [...namespace.map((part) => byteString(part) ?? "?"), name].join("/");
}

function category(name) {
  if (name.includes("control_message")) return "control";
  if (
    name.includes("padding") ||
    name.includes("stream_type") ||
    name.startsWith("quic:") ||
    name.startsWith("transport:")
  )
    return "transport";
  if (name.includes("object_datagram")) return "object";
  if (name.includes("subgroup")) return "subgroup";
  if (name.includes("fetch")) return "fetch";
  return "other";
}

function eventLabel(name, data) {
  if (name.includes("control_message"))
    return String(
      data.message?.type ?? data.message_type ?? data.type ?? "control",
    ).toUpperCase();
  if (data.end_of_timed_out_range) return "Timed-out range";
  if (data.end_of_nonexistent_range) return "Nonexistent range";
  if (data.end_of_unknown_range) return "Unknown range";
  if (data.object_status && data.object_status !== "normal")
    return String(data.object_status).replaceAll("_", " ");
  return name
    .split(":")
    .at(-1)
    .replace(/_(created|parsed|sent|received)$/, "")
    .replaceAll("_", " ");
}

function payloadSize(data) {
  const value =
    data.object_payload_length ??
    data.object_payload?.length ??
    data.object_payload?.payload_length ??
    data.object_size ??
    data.payload_length ??
    data.padding_length ??
    0;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function parameter(message, name) {
  return (
    message.parameters?.find((value) => value.name === name)?.value ?? null
  );
}

function resolveTracks(events) {
  const requests = new Map();
  const aliases = new Map();
  const streams = new Map();
  const requestKey = (endpoint, id) => `${endpoint}:${id}`;
  const aliasOwner = (event) =>
    event.messageType === "SUBSCRIBE" ? other(event.sender) : event.sender;
  for (const event of events) {
    const message = event.data.message || event.data;
    if (event.category !== "control" || !event.trackName) continue;
    if (event.requestId !== null)
      requests.set(requestKey(event.sender, event.requestId), {
        name: event.trackName,
        order: Number(
          parameter(message, "group_order") ?? message.group_order ?? 0,
        ),
      });
    if (event.alias !== null)
      aliases.set(requestKey(aliasOwner(event), event.alias), event.trackName);
  }
  for (const event of events) {
    const message = event.data.message || event.data;
    const request =
      requests.get(requestKey(other(event.sender), event.requestId)) ||
      requests.get(requestKey(event.sender, event.requestId));
    if (
      event.category === "control" &&
      event.messageType?.endsWith("_OK") &&
      event.alias !== null &&
      request
    ) {
      aliases.set(requestKey(aliasOwner(event), event.alias), request.name);
    }
    if (event.alias !== null) {
      event.trackName ||=
        aliases.get(requestKey(aliasOwner(event), event.alias)) ||
        `Track alias ${event.alias} (${aliasOwner(event)})`;
    }
    if (!event.trackName && request && event.messageType !== "MAX_REQUEST_ID")
      event.trackName = request.name;
    const streamDirection =
      event.name === "quic:stop_sending"
        ? event.direction === "sent"
          ? "received"
          : "sent"
        : event.direction;
    const streamKey = `${event.endpoint}:${streamDirection}:${event.streamId}`;
    let stream = event.streamId === null ? undefined : streams.get(streamKey);
    if (event.name.includes("subgroup_header")) {
      stream = {
        name: event.trackName,
        group: event.groupId,
        subgroup:
          event.subgroupId ?? (message.subgroup_id_mode === 1 ? "0" : null),
        mode: message.subgroup_id_mode,
        object: null,
        type: "subgroup",
      };
      streams.set(streamKey, stream);
      event.subgroupId = stream.subgroup;
    } else if (event.name.includes("fetch_header")) {
      stream = {
        name: request?.name || `Fetch request ${event.requestId ?? "?"}`,
        group: null,
        subgroup: null,
        object: null,
        type: "fetch",
        order: request?.order || 0,
        hasObjects: false,
      };
      streams.set(streamKey, stream);
    } else if (
      stream?.type === "subgroup" &&
      event.name.includes("subgroup_object")
    ) {
      if (event.objectId === null && event.objectDelta !== null) {
        event.objectId =
          stream.object === null
            ? event.objectDelta
            : addId(stream.object, BigInt(event.objectDelta) + 1n);
      }
      stream.object = event.objectId;
      if (stream.subgroup === null && stream.mode === 2)
        stream.subgroup = event.objectId;
      event.groupId ??= stream.group;
      event.subgroupId ??= stream.subgroup;
    } else if (
      stream?.type === "fetch" &&
      event.name.includes("fetch_object")
    ) {
      const rangeEnd =
        message.end_of_nonexistent_range ||
        message.end_of_unknown_range ||
        message.end_of_timed_out_range;
      if (rangeEnd) {
        event.groupId ??= event.groupDelta;
        event.objectId ??= event.objectDelta;
      } else {
        if (event.groupId === null) {
          if (event.groupDelta === null) event.groupId = stream.group;
          else if (!stream.hasObjects) event.groupId = event.groupDelta;
          else if (stream.order === 1 || stream.order === 2) {
            event.groupId = addId(
              stream.group,
              (stream.order === 2 ? -1n : 1n) * (BigInt(event.groupDelta) + 1n),
            );
          }
        }
        if (event.objectId === null) {
          if (event.objectDelta === null)
            event.objectId = addId(stream.object, 1);
          else if (event.groupDelta !== null || stream.object === null)
            event.objectId = event.objectDelta;
          else event.objectId = addId(stream.object, event.objectDelta);
        }
        if (message.datagram) stream.subgroup = "0";
        else {
          if (message.subgroup_id_bits === 0) event.subgroupId = "0";
          else if (message.subgroup_id_bits === 1)
            event.subgroupId = stream.subgroup;
          else if (message.subgroup_id_bits === 2)
            event.subgroupId = addId(stream.subgroup, 1);
          stream.subgroup = event.subgroupId;
        }
      }
      stream.group = event.groupId;
      stream.object = event.objectId;
      stream.hasObjects = true;
    }
    event.trackName ||=
      stream?.name ||
      (event.streamId === null ? null : `Stream ${event.streamId}`);
    event.trackKey =
      event.category === "control" || event.name.includes("padding")
        ? "connection"
        : event.trackName || "connection";
  }
  for (const event of events) {
    if (event.name.includes("stream_type")) {
      const stream = streams.get(
        `${event.endpoint}:${event.direction}:${event.streamId}`,
      );
      if (stream?.name) {
        event.trackName = stream.name;
        event.trackKey = stream.name;
      }
    }
  }
}

export function parseLog(
  text,
  { legacyTimeUnit = "ns", vantagePoint = null } = {},
) {
  if (UNITS[legacyTimeUnit] === undefined)
    throw new Error(`Unknown timestamp unit: ${legacyTimeUnit}`);
  const source = sources(readRecords(text));
  if (!Array.isArray(source.traces) || !source.traces.length)
    throw new Error("The file contains no traces.");
  const events = [];
  const warnings = [];
  let usesLegacyUnits = false;
  const epochs = source.traces.map((trace) =>
    Date.parse(trace.common_fields?.reference_time?.epoch),
  );
  const canAlign = epochs.every(Number.isFinite);
  const baseEpoch = canAlign ? Math.min(...epochs) : 0;
  source.traces.forEach((trace, traceIndex) => {
    if (!Array.isArray(trace.events)) {
      if (trace.error_description) {
        warnings.push(String(trace.error_description));
        return;
      }
      throw new Error(`Trace ${traceIndex + 1} has no event array.`);
    }
    const common = trace.common_fields || {};
    let previousTime = 0;
    const traceEvents = [];
    trace.events.forEach((raw, index) => {
      const event = objectEvent(raw, trace.event_fields);
      if (!event || typeof event.name !== "string") {
        warnings.push(
          `Skipped a record without an event name in trace ${traceIndex + 1}.`,
        );
        return;
      }
      const legacy =
        !source.standard &&
        !Array.isArray(raw) &&
        event.vantagePoint !== undefined;
      usesLegacyUnits ||= legacy;
      const units = source.standard
        ? "ms"
        : (trace.configuration?.time_units ??
          common.time_units ??
          (legacy ? legacyTimeUnit : "ms"));
      if (UNITS[units] === undefined)
        throw new Error(`Unknown timestamp unit: ${units}`);
      const rawTime = event.time ?? event.relative_time;
      if (typeof rawTime !== "number" && typeof rawTime !== "string") {
        throw new Error(
          `Invalid timestamp in trace ${traceIndex + 1}, event ${index + 1}.`,
        );
      }
      if (typeof rawTime === "string" && rawTime.trim() === "")
        throw new Error(
          `Empty timestamp in trace ${traceIndex + 1}, event ${index + 1}.`,
        );
      let time = Number(rawTime);
      if (!Number.isFinite(time)) {
        time = typeof rawTime === "string" ? Date.parse(rawTime) : NaN;
        if (!Number.isFinite(time))
          throw new Error(
            `Invalid timestamp in trace ${traceIndex + 1}, event ${index + 1}.`,
          );
      } else if (units === "ns") time /= 1e6;
      else if (units === "us") time /= 1e3;
      else if (units === "s") time *= 1000;
      const timeFormat =
        event.time_format ||
        common.time_format ||
        trace.configuration?.time_format;
      if (timeFormat === "relative_to_previous_event" || timeFormat === "delta")
        time += previousTime;
      if (!Number.isFinite(time))
        throw new Error(
          `Timestamp out of range in trace ${traceIndex + 1}, event ${index + 1}.`,
        );
      previousTime = time;
      const endpoint = point(
        vantagePoint ||
          event.vantage_point ||
          event.vantagePoint ||
          event.data?.vantage_point ||
          trace.vantage_point,
      );
      const name = event.name;
      const data = event.data || {};
      const direction =
        name.endsWith("_parsed") ||
        name.endsWith("_received") ||
        data.owner === "remote"
          ? "received"
          : "sent";
      const rows =
        name.startsWith("moqt:") || name.startsWith("moq:")
          ? [{ name, data, suffix: "" }]
          : (Array.isArray(data.frames) ? data.frames : []).flatMap(
              (frame, frameIndex) =>
                ["reset_stream", "stop_sending"].includes(frame.frame_type)
                  ? [
                      {
                        name: `quic:${frame.frame_type}`,
                        data: frame,
                        suffix: `:frame${frameIndex}`,
                      },
                    ]
                  : [],
            );
      for (const row of rows) {
        const message = row.data.message || row.data;
        const requestId = identifier(
          message.request_id ??
            message.subscribe_id ??
            message.subscribeId ??
            row.data.request_id,
        );
        const normalized = {
          id: `${traceIndex}:${index}${row.suffix}`,
          traceIndex,
          index,
          name: row.name,
          timeMs: time + (canAlign ? epochs[traceIndex] - baseEpoch : 0),
          endpoint,
          direction,
          sender: direction === "sent" ? endpoint : other(endpoint),
          category: category(row.name),
          label: row.name.startsWith("quic:")
            ? row.name.split(":")[1].toUpperCase()
            : eventLabel(row.name, row.data),
          data: row.data,
          raw,
          messageType: row.name.includes("control_message")
            ? eventLabel(row.name, row.data)
            : null,
          requestId,
          alias: identifier(message.track_alias ?? row.data.track_alias),
          streamId: identifier(row.data.stream_id ?? row.data.streamId),
          trackName: trackName(message),
          groupId: identifier(row.data.group_id ?? row.data.groupId),
          subgroupId: identifier(row.data.subgroup_id ?? row.data.subgroupId),
          objectId: identifier(row.data.object_id ?? row.data.objectId),
          groupDelta: identifier(row.data.group_id_delta),
          objectDelta: identifier(row.data.object_id_delta),
          bytes: payloadSize(row.data),
        };
        traceEvents.push(normalized);
      }
    });
    traceEvents.sort((a, b) => a.timeMs - b.timeMs || a.index - b.index);
    resolveTracks(traceEvents);
    events.push(...traceEvents);
  });
  events.sort(
    (a, b) =>
      a.timeMs - b.timeMs || a.traceIndex - b.traceIndex || a.index - b.index,
  );
  const startMs = events[0]?.timeMs || 0;
  for (const event of events) {
    event.relativeMs = event.timeMs - startMs;
    event.search = [
      event.name,
      event.label,
      event.trackName,
      event.streamId,
      event.requestId,
      event.groupId,
      event.subgroupId,
      event.objectId,
      event.groupDelta,
      event.objectDelta,
    ]
      .filter((value) => value !== null)
      .join(" ")
      .toLowerCase();
  }
  const tracks = [...new Set(events.map((event) => event.trackKey))].map(
    (id) => ({ id, name: id === "connection" ? "Connection" : id }),
  );
  tracks.sort((a, b) =>
    a.id === "connection"
      ? -1
      : b.id === "connection"
        ? 1
        : a.name.localeCompare(b.name),
  );
  if (source.traces.length > 1 && !canAlign)
    warnings.push(
      "These traces have no shared wall-clock reference. Recorded times are shown; cross-endpoint latency requires clock alignment.",
    );
  if (events.some((event) => event.endpoint === "unknown"))
    warnings.push(
      "Some events have no endpoint. Choose Client or Server if you know which endpoint recorded this file.",
    );
  return {
    events,
    tracks,
    warnings: [...new Set(warnings)].slice(0, 8),
    metadata: {
      title: source.title || source.traces[0]?.title || "MoQ session",
      format: source.format,
      traceCount: source.traces.length,
      usesLegacyUnits,
      clockAligned: canAlign,
    },
    durationMs: events.length ? events.at(-1).timeMs - startMs : 0,
    loggedBytes: events.reduce((sum, event) => sum + event.bytes, 0),
  };
}
