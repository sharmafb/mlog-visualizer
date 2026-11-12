// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { COLORS, TRACK_COLORS, directionArrow, formatMs } from "./format.js";

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
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(canvas.parentElement);
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.events.length) return;
        event.preventDefault();
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
      x: event.clientX - rectangle.left,
      y: event.clientY - rectangle.top,
    };
  }

  hit(position) {
    if (position.y < 64) return null;
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
    const width = Math.max(600, this.canvas.parentElement.clientWidth);
    const height = this.canvas.clientHeight || 560;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${width}px`;
    if (
      this.canvas.width !== Math.round(width * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const axis = 85;
    const top = 64;
    const plotHeight = height - top - 14;
    const endpoints = ["client", "server"];
    if (this.events.some((event) => event.endpoint === "unknown"))
      endpoints.push("unknown");
    const endpointWidth = (width - axis - 12) / endpoints.length;
    const tracks = this.tracks.length
      ? this.tracks
      : [{ id: "connection", name: "Connection" }];
    const laneWidth = endpointWidth / tracks.length;
    ctx.fillStyle = "#fcfcfe";
    ctx.fillRect(0, 0, width, top);
    ctx.strokeStyle = "#e9eaf1";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(width, top);
    ctx.stroke();
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#9297a6";
    ctx.fillText("TIME (ms)", 12, 29);
    endpoints.forEach((endpoint, side) => {
      const start = axis + endpointWidth * side;
      ctx.font = "600 11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#55576d";
      ctx.textAlign = "center";
      ctx.fillText(
        endpoint === "unknown"
          ? "Unspecified endpoint"
          : `${endpoint === "client" ? "Client" : "Server"} endpoint`,
        start + endpointWidth / 2,
        26,
      );
      tracks.forEach((track, index) => {
        const middle = start + laneWidth * (index + 0.5);
        ctx.strokeStyle = "#f0f0f6";
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(middle, top);
        ctx.lineTo(middle, height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = TRACK_COLORS[index % TRACK_COLORS.length];
        ctx.fillRect(middle - 2, 39, 4, 4);
        if (laneWidth > 42) {
          ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
          ctx.fillStyle = "#9590a3";
          const label = track.name.split("/").at(-1);
          const limit = Math.max(4, Math.floor(laneWidth / 5.5));
          ctx.fillText(
            label.length > limit ? `${label.slice(0, limit - 1)}…` : label,
            middle,
            56,
          );
        }
      });
      ctx.strokeStyle = "#e2e3ec";
      ctx.beginPath();
      ctx.moveTo(start, 0);
      ctx.lineTo(start, height);
      ctx.stroke();
    });
    ctx.textAlign = "left";
    const targetStep = this.span / (plotHeight / 65);
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
      const y = top + ((tick - this.min) * plotHeight) / this.span;
      ctx.fillStyle = "#9297a4";
      const label =
        Math.abs(tick) < step * 1e-5
          ? "0"
          : Number(tick.toPrecision(7)).toLocaleString("en-US", {
              maximumFractionDigits: 6,
            });
      ctx.fillText(label, 12, y + 3);
      ctx.strokeStyle = "#f0f1f6";
      ctx.beginPath();
      ctx.moveTo(axis, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    this.hits = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(axis, top, width - axis, plotHeight + 14);
    ctx.clip();
    const captions = new Map();
    for (const event of this.events) {
      const y = top + ((event.relativeMs - this.min) * plotHeight) / this.span;
      if (y < top - 30 || y > height + 30) continue;
      const side = endpoints.indexOf(event.endpoint);
      const track = tracks.findIndex((value) => value.id === event.trackKey);
      if (side < 0 || track < 0) continue;
      const middle = axis + side * endpointWidth + (track + 0.5) * laneWidth;
      const barWidth = Math.max(5, Math.min(laneWidth - 10, 105));
      const barHeight =
        this.options.sizes && event.bytes
          ? Math.min(23, 5 + Math.log2(event.bytes + 1))
          : 7;
      const x = middle - barWidth / 2;
      const color = COLORS[event.category];
      ctx.fillStyle = `${color}24`;
      ctx.fillRect(x, y - barHeight / 2, barWidth, barHeight);
      ctx.fillStyle = color;
      ctx.fillRect(x, y - barHeight / 2, 3, barHeight);
      if (event.id === this.selected) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
          x - 2,
          y - barHeight / 2 - 2,
          barWidth + 4,
          barHeight + 4,
        );
        ctx.lineWidth = 1;
      }
      const captionY = y - barHeight / 2 - 3;
      const captionKey = `${side}:${track}`;
      if (
        laneWidth > 85 &&
        (captionY - (captions.get(captionKey) ?? -Infinity) >= 12 ||
          event.id === this.selected)
      ) {
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
        ctx.font = "9px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillStyle = "#68637a";
        const limit = Math.floor((laneWidth - 18) / 5.2);
        ctx.fillText(
          `${directionArrow(event)} ${label.length > limit ? `${label.slice(0, limit - 1)}…` : label}`,
          x + 5,
          captionY,
        );
        captions.set(captionKey, captionY);
      }
      this.hits.push({
        x,
        y: y - barHeight / 2,
        width: barWidth,
        height: barHeight,
        event,
      });
    }
    ctx.restore();
    this.canvas.dataset.renderedEvents = String(this.hits.length);
    this.canvas.dataset.viewMin = String(this.min);
    this.canvas.dataset.viewSpan = String(this.span);
    this.canvas.dataset.lastRender = formatMs(this.min);
  }
}
