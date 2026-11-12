// Copyright (c) 2026 Aman Sharma. MIT licensed.

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function identity(event) {
  const data = event.data;
  const name = event.name.replace(/_(created|parsed|sent|received)$/, "");
  const attributes =
    event.category === "control"
      ? event.streamId !== null || event.requestId !== null
        ? event.messageType
        : stable(data.message || data)
      : {
          object_status: data.object_status ?? null,
          end_of_group: !!data.end_of_group,
          end_of_nonexistent_range: !!data.end_of_nonexistent_range,
          end_of_unknown_range: !!data.end_of_unknown_range,
          end_of_timed_out_range: !!data.end_of_timed_out_range,
          subgroup_id_mode: data.subgroup_id_mode ?? null,
          first_object: data.first_object ?? null,
          stream_type: data.stream_type ?? null,
          error_code: data.error_code ?? null,
        };
  return JSON.stringify([
    name,
    event.sender,
    event.trackKey,
    event.streamId,
    event.requestId,
    event.alias,
    event.groupId,
    event.subgroupId,
    event.objectId,
    event.bytes,
    attributes,
  ]);
}

function transfer(observations) {
  const sent = observations.find((event) => event.direction === "sent");
  const received = observations.find((event) => event.direction === "received");
  const primary = sent || received || observations[0];
  return {
    ...primary,
    observations: [...observations],
    sentTimeMs: sent?.timeMs ?? null,
    receivedTimeMs: received?.timeMs ?? null,
    search: observations.map((event) => event.search).join(" "),
  };
}

// Match only opposite observations of the same wire event. Repeated sends or
// receives remain separate records, including captures from the same endpoint.
export function mergeTransfers(events) {
  const waiting = new Map();
  const groups = [];
  for (const event of events) {
    const key =
      event.sender === "unknown" || event.endpoint === "unknown"
        ? null
        : identity(event);
    let group;
    if (key !== null) {
      const oppositeDirection =
        event.direction === "sent" ? "received" : "sent";
      const oppositeEndpoint =
        event.endpoint === "client" ? "server" : "client";
      const oppositeKey = `${key}:${oppositeDirection}:${oppositeEndpoint}`;
      const candidates = waiting.get(oppositeKey);
      if (candidates && candidates.offset < candidates.groups.length) {
        group = candidates.groups[candidates.offset++];
        if (candidates.offset === candidates.groups.length)
          waiting.delete(oppositeKey);
      } else {
        group = [];
        const ownKey = `${key}:${event.direction}:${event.endpoint}`;
        const queue = waiting.get(ownKey) || { groups: [], offset: 0 };
        queue.groups.push(group);
        waiting.set(ownKey, queue);
      }
    } else group = [];
    if (!group.length) groups.push(group);
    group.push(event);
  }
  return groups
    .map(transfer)
    .sort(
      (a, b) =>
        a.relativeMs - b.relativeMs ||
        a.traceIndex - b.traceIndex ||
        a.index - b.index,
    );
}

export function transferDirection(event) {
  return event.sender === "client"
    ? "Client → Server"
    : event.sender === "server"
      ? "Server → Client"
      : "Unknown direction";
}

export function directionCode(event) {
  return event.sender === "client"
    ? "C→S"
    : event.sender === "server"
      ? "S→C"
      : "?";
}

export function rawObservations(event) {
  if (event.observations.length === 1) return event.observations[0].raw;
  return event.observations.map((observation) => ({
    endpoint: observation.endpoint,
    direction: observation.direction,
    event: observation.raw,
  }));
}
