// Copyright (c) 2026 Aman Sharma. MIT licensed.
export const COLORS = {
  control: "#5275d6",
  object: "#209b82",
  subgroup: "#cf913e",
  fetch: "#9669cf",
  transport: "#8993a8",
  other: "#b16e8b",
};
export const CATEGORY_NAMES = {
  control: "Control messages",
  object: "Datagrams",
  subgroup: "Subgroups",
  fetch: "Fetch operations",
  transport: "Streams & transport",
  other: "Other MoQ events",
};
export const TRACK_COLORS = [
  "#a48bd3",
  "#6cae9b",
  "#cdab70",
  "#7b9bcc",
  "#bd849d",
  "#94aa6d",
  "#c8916d",
  "#829cb6",
];
export function formatMs(value) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value)} ms`;
}
export function formatDuration(value) {
  if (value >= 60000) return `${(value / 60000).toFixed(2)} min`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return formatMs(value);
}
export function formatBytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const power = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: power ? 1 : 0 }).format(value / 1024 ** power)} ${units[power]}`;
}
export function objectLabel(event) {
  const group =
    event.groupId !== null
      ? event.groupId
      : event.groupDelta !== null
        ? `Δ${event.groupDelta}`
        : "—";
  const object =
    event.objectId !== null
      ? event.objectId
      : event.objectDelta !== null
        ? `Δ${event.objectDelta}`
        : "—";
  if (group === "—" && object === "—") return "—";
  const subgroup = event.name?.includes("subgroup_object")
    ? `subgp = ${event.subgroupId ?? "—"}, `
    : "";
  const prefix = event.category === "object" ? "[DATAGRAM] " : "";
  return `${prefix}gp = ${group}, ${subgroup}obj = ${object}`;
}

const TIME_PARAMETERS = new Set([
  "subgroup_delivery_timeout",
  "object_delivery_timeout",
  "fill_timeout",
  "rendezvous_timeout",
  "expires",
]);

export function parameterDisplayValue(name, value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "value")
  ) {
    return { ...value, value: parameterDisplayValue(name, value.value) };
  }
  if (name === "fill_parameters" && Array.isArray(value)) {
    return value.map((parameter) =>
      parameter &&
      typeof parameter === "object" &&
      Object.hasOwn(parameter, "value")
        ? {
            ...parameter,
            value: parameterDisplayValue(parameter.name, parameter.value),
          }
        : parameter,
    );
  }
  const code =
    typeof value === "number" || typeof value === "string"
      ? String(value)
      : null;
  if (name === "group_order") {
    if (code === "1") return "ASCENDING";
    if (code === "2") return "DESCENDING";
  }
  if (name === "forward" || name === "include_properties") {
    if (value === false || code === "0") return "FALSE";
    if (value === true || code === "1") return "TRUE";
  }
  const numeric =
    (typeof value === "number" && Number.isFinite(value) && value >= 0) ||
    (typeof value === "string" && /^\d+$/.test(value));
  if (TIME_PARAMETERS.has(name) && numeric) {
    if (
      String(value) === "0" &&
      (name === "subgroup_delivery_timeout" ||
        name === "object_delivery_timeout")
    )
      return "DISABLED";
    if (String(value) === "0" && name === "expires")
      return "NO EXPIRY / UNKNOWN";
    return `${value} ms`;
  }
  return value;
}
export function directionArrow(event) {
  if (event.endpoint === "unknown") return "·";
  return (event.endpoint === "client") === (event.direction === "sent")
    ? "→"
    : "←";
}
