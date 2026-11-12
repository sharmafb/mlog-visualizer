// Copyright (c) 2026 Aman Sharma. MIT licensed.
export const AXIS_WIDTH = 85;
export const HEADER_HEIGHT = 64;
export const TEXT_PADDING = 6;
export const REQUEST_GUTTER = 28;
export const BOX_HEIGHT = 20;
const COLUMN_PADDING = 12;
const BOX_GAP = 6;
const BASE_PLOT_HEIGHT = 2000;

// Track positions are fixed. A shared time mapping expands crowded intervals
// vertically, keeping equal timestamps aligned across tracks and labels honest.
export function layoutTimeline({ events, tracks, width, height, min, span }) {
  const scale = BASE_PLOT_HEIGHT / span;
  const columns = tracks.map((track) => ({
    ...track,
    boxes: [],
    slots: 1,
    bottom: HEADER_HEIGHT,
  }));
  const laneById = new Map(columns.map((column) => [column.id, column]));
  const contentWidth = Math.max(width, AXIS_WIDTH + columns.length * 200 + 12);
  const columnWidth = columns.length
    ? (contentWidth - AXIS_WIDTH - 12) / columns.length
    : 0;
  columns.forEach((column, index) => {
    column.x = AXIS_WIDTH + index * columnWidth;
    column.width = columnWidth;
  });
  const byTime = new Map();
  for (const event of events) {
    if (!laneById.has(event.trackKey)) continue;
    const entries = byTime.get(event.relativeMs) || [];
    entries.push(event);
    byTime.set(event.relativeMs, entries);
  }
  const anchors = [],
    boxes = [];
  let previousTime = min,
    previousY = HEADER_HEIGHT + 24;
  for (const [time, entries] of [...byTime].sort((a, b) => a[0] - b[0])) {
    const lanes = new Map();
    for (const event of entries) {
      const list = lanes.get(event.trackKey) || [];
      list.push(event);
      lanes.set(event.trackKey, list);
    }
    const rows = Math.max(...[...lanes.values()].map((list) => list.length));
    let desired = previousY + (time - previousTime) * scale;
    for (let row = 0; row < rows; row++) {
      const items = [...lanes].flatMap(([id, list]) =>
        list[row] ? [{ column: laneById.get(id), event: list[row] }] : [],
      );
      const center = Math.max(
        desired,
        ...items.map(({ column }) => column.bottom + BOX_GAP + BOX_HEIGHT / 2),
      );
      for (const { column, event } of items) {
        const gutter = column.id === "connection" ? REQUEST_GUTTER : 0;
        const box = {
          event,
          slot: 0,
          x: column.x + COLUMN_PADDING + gutter,
          y: center - BOX_HEIGHT / 2,
          width: column.width - 2 * COLUMN_PADDING - gutter,
          height: BOX_HEIGHT,
        };
        column.boxes.push(box);
        column.bottom = box.y + box.height;
        boxes.push(box);
      }
      anchors.push({ time, y: center });
      previousY = center;
      desired = center;
    }
    previousTime = time;
  }
  const contentHeight = Math.max(
    height,
    ...columns.map((column) => column.bottom + 24),
  );
  return {
    width: contentWidth,
    height: contentHeight,
    viewportHeight: height,
    plotHeight: BASE_PLOT_HEIGHT,
    scale,
    columns,
    boxes,
    anchors,
  };
}

export function timeToY(layout, time) {
  const anchors = layout.anchors;
  if (!anchors.length) return HEADER_HEIGHT + 24;
  let low = 0,
    high = anchors.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (anchors[middle].time < time) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return anchors[0].y + (time - anchors[0].time) * layout.scale;
  if (low === anchors.length) {
    const last = anchors.at(-1);
    return last.y + (time - last.time) * layout.scale;
  }
  if (anchors[low].time === time) return anchors[low].y;
  const a = anchors[low - 1],
    b = anchors[low];
  return a.y + ((time - a.time) * (b.y - a.y)) / (b.time - a.time);
}

export function yToTime(layout, y) {
  const anchors = layout.anchors;
  if (!anchors.length) return 0;
  let low = 0,
    high = anchors.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (anchors[middle].y < y) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return anchors[0].time + (y - anchors[0].y) / layout.scale;
  if (low === anchors.length) {
    const last = anchors.at(-1);
    return last.time + (y - last.y) / layout.scale;
  }
  const a = anchors[low - 1],
    b = anchors[low];
  return a.time + ((y - a.y) * (b.time - a.time)) / (b.y - a.y);
}

export function fitLabel(text, width, measure) {
  if (measure(text) <= width) return text;
  if (measure("…") > width) return "";
  const characters = Array.from(text);
  let lower = 0;
  let upper = characters.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (measure(characters.slice(0, middle).join("") + "…") <= width)
      lower = middle;
    else upper = middle - 1;
  }
  return characters.slice(0, lower).join("") + "…";
}

export function labelPosition(box, metrics) {
  const ascent = metrics.actualBoundingBoxAscent ?? 9;
  const descent = metrics.actualBoundingBoxDescent ?? 3;
  return {
    x: box.x + TEXT_PADDING,
    y: box.y + (box.height - ascent - descent) / 2 + ascent,
    width: metrics.width,
    top: box.y + (box.height - ascent - descent) / 2,
    height: ascent + descent,
  };
}
