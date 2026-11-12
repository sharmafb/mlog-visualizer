// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { COLORS, TRACK_COLORS, formatMs } from "./format.js";
import { transferDirection } from "./transfer-events.js";
import {
  AXIS_WIDTH,
  HEADER_HEIGHT,
  TEXT_PADDING,
  fitLabel,
  labelPosition,
  layoutTimeline,
} from "./timeline-layout.js";

export class Timeline {
  constructor(canvas, { select, hover }) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.select = select;
    this.hover = hover;
    this.events = [];
    this.tracks = [];
    this.hits = [];
    this.selected = null;
    this.options = { ids: true, sizes: true };
    this.min = 0;
    this.span = 1;
    this.frame = 0;
    this.drag = null;
    this.viewport = canvas.parentElement;
    this.spacer = document.getElementById("timeline-spacer");
    this.pendingFocus = null;
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(canvas.parentElement);
    this.viewport.addEventListener("scroll", () => this.schedule());
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.events.length) return;
        event.preventDefault();
        if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          this.viewport.scrollLeft += event.shiftKey
            ? event.deltaY
            : event.deltaX;
          return;
        }
        this.zoom(
          Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.004),
          this.position(event).y,
        );
      },
      { passive: false },
    );
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.drag = { y: event.clientY, origin: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.drag) {
        const delta = event.clientY - this.drag.y;
        this.drag.moved ||= Math.abs(event.clientY - this.drag.origin) > 3;
        this.drag.y = event.clientY;
        if (this.drag.moved) {
          this.min -= (delta * this.span) / this.plotHeight();
          canvas.classList.add("dragging");
          this.hover(null);
          this.schedule();
        }
        return;
      }
      const position = this.position(event);
      const hit = this.hit(position);
      canvas.style.cursor = hit ? "pointer" : "grab";
      this.hover(hit?.event || null, position);
    });
    canvas.addEventListener("pointerup", (event) => {
      if (!this.drag) return;
      const moved = this.drag.moved;
      this.drag = null;
      canvas.classList.remove("dragging");
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      if (!moved) this.select(this.hit(this.position(event))?.event || null);
    });
    canvas.addEventListener("pointercancel", () => {
      this.drag = null;
      canvas.classList.remove("dragging");
    });
    canvas.addEventListener("pointerleave", () => this.hover(null));
    canvas.addEventListener("dblclick", () => this.fit());
    canvas.addEventListener("keydown", (event) => {
      if (event.key === "+" || event.key === "=") this.zoom(1.5);
      else if (event.key === "-") this.zoom(1 / 1.5);
      else if (event.key === "Home") this.fit();
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        this.min += this.span * (event.key === "ArrowDown" ? 0.15 : -0.15);
        this.schedule();
      } else return;
      event.preventDefault();
    });
  }

  setData(events, tracks, options, fit = false) {
    this.events = events;
    this.tracks = tracks;
    this.options = options;
    this.canvas.setAttribute(
      "aria-label",
      `${events.length} events in the timeline. Plus and minus zoom; arrow keys pan; Home fits the view. Events are also listed in the table below.`,
    );
    if (fit) this.fit();
    else this.schedule();
  }

  fit() {
    const first = this.events[0]?.relativeMs || 0;
    const last = this.events.at(-1)?.relativeMs || first;
    const span = Math.max(last - first, 0.5);
    this.min = first - span * 0.04;
    this.span = span * 1.1;
    this.schedule();
  }

  zoom(factor, y) {
    const anchor =
      y === undefined
        ? 0.5
        : Math.max(0, Math.min(1, (y - 64) / this.plotHeight()));
    const nextSpan = Math.max(1e-6, Math.min(1e15, this.span / factor));
    this.min += (this.span - nextSpan) * anchor;
    this.span = nextSpan;
    this.schedule();
  }

  focus(event) {
    this.selected = event?.id || null;
    this.pendingFocus = event?.id || null;
    if (
      event &&
      (event.relativeMs < this.min || event.relativeMs > this.min + this.span)
    )
      this.min = event.relativeMs - this.span / 2;
    this.schedule();
  }

  position(event) {
    const rectangle = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rectangle.left + this.viewport.scrollLeft,
      y: event.clientY - rectangle.top,
    };
  }

  hit(position) {
    if (
      position.y < HEADER_HEIGHT ||
      position.x - this.viewport.scrollLeft < AXIS_WIDTH
    )
      return null;
    return this.hits.findLast(
      (hit) =>
        position.x >= hit.x - 3 &&
        position.x <= hit.x + hit.width + 3 &&
        position.y >= hit.y - 4 &&
        position.y <= hit.y + hit.height + 4,
    );
  }

  plotHeight() {
    return Math.max(1, this.canvas.clientHeight - 78);
  }

  schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
  }

  draw() {
    const viewportWidth = Math.max(300, this.viewport.clientWidth);
    const height = this.viewport.clientHeight || 560;
    const layout = layoutTimeline({
      events: this.events,
      tracks: this.tracks,
      width: viewportWidth,
      height,
      min: this.min,
      span: this.span,
      sizes: this.options.sizes,
    });
    this.layout = layout;
    this.spacer.style.width = `${layout.width}px`;
    this.spacer.style.height = `${height}px`;
    if (this.pendingFocus) {
      const box = layout.boxes.find(
        (box) => box.event.id === this.pendingFocus,
      );
      if (
        box &&
        (box.x < this.viewport.scrollLeft + AXIS_WIDTH ||
          box.x + box.width > this.viewport.scrollLeft + viewportWidth)
      ) {
        this.viewport.scrollLeft = Math.max(0, box.x - AXIS_WIDTH - 12);
      }
      this.pendingFocus = null;
    }
    const scrollLeft = this.viewport.scrollLeft;
    const width = layout.width;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${viewportWidth}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.style.left = `${scrollLeft}px`;
    if (
      this.canvas.width !== Math.round(viewportWidth * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(viewportWidth * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, -scrollLeft * dpr, 0);
    ctx.clearRect(scrollLeft, 0, viewportWidth, height);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#fcfcfe";
    ctx.fillRect(0, 0, width, HEADER_HEIGHT);
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#9297a6";
    layout.columns.forEach((column, index) => {
      ctx.strokeStyle = "#e2e3ec";
      ctx.beginPath();
      ctx.moveTo(column.x, 0);
      ctx.lineTo(column.x, height);
      ctx.stroke();
      ctx.fillStyle = TRACK_COLORS[index % TRACK_COLORS.length];
      ctx.fillRect(column.x + 16, 23, 5, 5);
      ctx.fillStyle = "#55576d";
      ctx.font = "600 12px -apple-system, BlinkMacSystemFont, sans-serif";
      const name =
        column.id === "connection"
          ? "Control / Transport"
          : column.name.split("/").at(-1);
      ctx.fillText(
        fitLabel(
          name,
          column.width - 48,
          (text) => ctx.measureText(text).width,
        ),
        column.x + 28,
        30,
      );
      ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#9290a1";
      const directions = [
        ...new Set(column.boxes.map((box) => transferDirection(box.event))),
      ];
      const description =
        column.id === "connection"
          ? "Control messages and stream events"
          : directions.length === 1
            ? directions[0]
            : "Both transfer directions";
      ctx.fillText(
        fitLabel(
          description,
          column.width - 32,
          (text) => ctx.measureText(text).width,
        ),
        column.x + 16,
        49,
      );
      for (let slot = 1; slot < column.slots; slot++) {
        const x = column.x + (column.width * slot) / column.slots;
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = "#f0f0f6";
        ctx.beginPath();
        ctx.moveTo(x, HEADER_HEIGHT);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    ctx.strokeStyle = "#e9eaf1";
    ctx.beginPath();
    ctx.moveTo(0, HEADER_HEIGHT);
    ctx.lineTo(width, HEADER_HEIGHT);
    ctx.stroke();
    const targetStep = this.span / (layout.plotHeight / 65);
    const power = 10 ** Math.floor(Math.log10(targetStep));
    const ratio = targetStep / power;
    const step =
      (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    for (
      let tick = Math.ceil(this.min / step) * step;
      tick < this.min + this.span;
      tick += step
    ) {
      const y =
        HEADER_HEIGHT + ((tick - this.min) * layout.plotHeight) / this.span;
      ctx.fillStyle = "#9297a4";
      ctx.strokeStyle = "#f0f1f6";
      ctx.beginPath();
      ctx.moveTo(AXIS_WIDTH, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    this.hits = [];
    const labels = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      scrollLeft + AXIS_WIDTH,
      HEADER_HEIGHT,
      viewportWidth - AXIS_WIDTH,
      height - HEADER_HEIGHT,
    );
    ctx.clip();
    for (const box of layout.boxes) {
      const event = box.event;
      if (
        box.x + box.width < scrollLeft + AXIS_WIDTH ||
        box.x > scrollLeft + viewportWidth
      )
        continue;
      const color = COLORS[event.category];
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = `${color}25`;
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = color;
      ctx.fillRect(box.x, box.y, 3, box.height);
      ctx.strokeStyle = `${color}45`;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
      if (event.id === this.selected) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.lineWidth = 1;
      }
      const id =
        event.objectId !== null
          ? `o${event.objectId}`
          : event.objectDelta !== null
            ? `Δ${event.objectDelta}`
            : null;
      const rangeEnd =
        event.data.end_of_timed_out_range ||
        event.data.end_of_unknown_range ||
        event.data.end_of_nonexistent_range;
      const label =
        event.category === "control" ||
        rangeEnd ||
        !this.options.ids ||
        id === null
          ? event.label
          : `${event.groupId === null ? "" : `g${event.groupId}/`}${id}`;
      ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
      const prefix =
        event.category === "control" || event.category === "transport"
          ? event.sender === "client"
            ? "→ "
            : event.sender === "server"
              ? "← "
              : "? "
          : "";
      const text = fitLabel(
        `${prefix}${label}`,
        box.width - 2 * TEXT_PADDING,
        (value) => {
          const metrics = ctx.measureText(value);
          return Math.max(
            metrics.width,
            (metrics.actualBoundingBoxLeft || 0) +
              (metrics.actualBoundingBoxRight || 0),
          );
        },
      );
      const metrics = ctx.measureText(text);
      const position = labelPosition(box, metrics);
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x + 4, box.y + 3, box.width - 8, box.height - 6);
      ctx.clip();
      ctx.fillStyle = "#484358";
      ctx.fillText(text, position.x, position.y);
      ctx.restore();
      labels.push({
        id: event.id,
        text,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        bounds: {
          x: position.x - (metrics.actualBoundingBoxLeft || 0),
          y: position.top,
          width:
            (metrics.actualBoundingBoxLeft || 0) +
            (metrics.actualBoundingBoxRight || metrics.width),
          height: position.height,
        },
      });
      this.hits.push({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        event,
      });
    }
    ctx.restore();
    ctx.fillStyle = "#fcfcfe";
    ctx.fillRect(scrollLeft, 0, AXIS_WIDTH, HEADER_HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(scrollLeft, HEADER_HEIGHT, AXIS_WIDTH, height - HEADER_HEIGHT);
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#9297a6";
    ctx.fillText("TIME (ms)", scrollLeft + 12, 29);
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    for (
      let tick = Math.ceil(this.min / step) * step;
      tick < this.min + this.span;
      tick += step
    ) {
      const y =
        HEADER_HEIGHT + ((tick - this.min) * layout.plotHeight) / this.span;
      ctx.fillText(
        Math.abs(tick) < step * 1e-5
          ? "0"
          : Number(tick.toPrecision(7)).toLocaleString("en-US", {
              maximumFractionDigits: 6,
            }),
        scrollLeft + 12,
        y + 3,
      );
    }
    ctx.strokeStyle = "#e2e3ec";
    ctx.beginPath();
    ctx.moveTo(scrollLeft + AXIS_WIDTH, 0);
    ctx.lineTo(scrollLeft + AXIS_WIDTH, height);
    ctx.stroke();
    this.canvas.__mlogRender = {
      width: layout.width,
      height,
      scrollLeft,
      columns: layout.columns.map(({ id, name, x, width, slots }) => ({
        id,
        name,
        x,
        width,
        slots,
      })),
      boxes: layout.boxes.map(({ x, y, width, height, event }) => ({
        id: event.id,
        track: event.trackKey,
        x,
        y,
        width,
        height,
      })),
      labels,
    };
    this.canvas.dataset.renderedEvents = String(this.hits.length);
    this.canvas.dataset.columns = String(layout.columns.length);
    this.canvas.dataset.viewMin = String(this.min);
    this.canvas.dataset.viewSpan = String(this.span);
    this.canvas.dataset.lastRender = formatMs(this.min);
    this.canvas.dispatchEvent(new CustomEvent("mlog-rendered"));
  }
}
