// Copyright (c) 2026 Aman Sharma. MIT licensed.
export const AXIS_WIDTH = 85;
export const HEADER_HEIGHT = 64;
export const TEXT_PADDING = 6;
const COLUMN_PADDING = 8;
const BOX_WIDTH = 64;
const BOX_GAP = 5;

export function eventHeight(event, sizes) {
  return sizes && event.bytes
    ? Math.min(30, 20 + Math.log2(event.bytes + 1) * 0.35)
    : 20;
}

// Interval partitioning keeps timestamps on a linear axis. Collisions receive
// separate horizontal slots in the same track instead of moving time positions.
export function layoutTimeline({
  events,
  tracks,
  width,
  height,
  min,
  span,
  sizes,
}) {
  const plotHeight = Math.max(1, height - HEADER_HEIGHT - 14);
  const lanes = tracks.map((track) => ({
    ...track,
    boxes: [],
    ends: [],
    slots: 1,
  }));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  for (const event of events) {
    const lane = laneById.get(event.trackKey);
    if (!lane) continue;
    const boxHeight = eventHeight(event, sizes);
    const center =
      HEADER_HEIGHT + ((event.relativeMs - min) * plotHeight) / span;
    const top = center - boxHeight / 2;
    if (top + boxHeight < HEADER_HEIGHT || top > height) continue;
    let slot = lane.ends.findIndex((end) => end + BOX_GAP <= top);
    if (slot < 0) slot = lane.ends.length;
    lane.ends[slot] = top + boxHeight;
    lane.slots = Math.max(lane.slots, slot + 1);
    lane.boxes.push({ event, slot, y: top, height: boxHeight });
  }
  for (const lane of lanes)
    lane.width = Math.max(
      190,
      lane.slots * BOX_WIDTH + (lane.slots - 1) * BOX_GAP + 2 * COLUMN_PADDING,
    );
  const minimumWidth =
    AXIS_WIDTH + lanes.reduce((sum, lane) => sum + lane.width, 0) + 12;
  const contentWidth = Math.max(width, minimumWidth);
  const extra = lanes.length ? (contentWidth - minimumWidth) / lanes.length : 0;
  let left = AXIS_WIDTH;
  const boxes = [];
  for (const lane of lanes) {
    lane.x = left;
    lane.width += extra;
    const slotWidth =
      (lane.width - 2 * COLUMN_PADDING - (lane.slots - 1) * BOX_GAP) /
      lane.slots;
    for (const box of lane.boxes) {
      box.x = left + COLUMN_PADDING + box.slot * (slotWidth + BOX_GAP);
      box.width = slotWidth;
      boxes.push(box);
    }
    left += lane.width;
  }
  return { width: contentWidth, height, plotHeight, columns: lanes, boxes };
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
