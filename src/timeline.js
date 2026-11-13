// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { COLORS, TRACK_COLORS, formatMs, objectLabel } from "./format.js";
import { transferDirection } from "./transfer-events.js";
import { requestConnectors } from "./request-links.js";
import {
  AXIS_WIDTH,
  HEADER_HEIGHT,
  TEXT_PADDING,
  fitLabel,
  labelPosition,
  layoutTimeline,
  timeToY,
  yToTime,
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
    this.min = 0;
    this.span = 1;
    this.frame = 0;
    this.drag = null;
    this.viewport = canvas.parentElement;
    this.spacer = document.getElementById("timeline-spacer");
    this.pendingFocus = null;
    this.pendingZoom = null;
    this.renderScrollTop = 0;
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(canvas.parentElement);
    this.viewport.addEventListener("scroll", () => this.schedule());
    window.addEventListener("scroll", () => this.schedule(), { passive: true });
    window.addEventListener("resize", () => this.schedule());
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.events.length) return;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          this.zoom(
            Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.004),
            event.clientY,
          );
        } else if (
          event.shiftKey ||
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ) {
          event.preventDefault();
          this.viewport.scrollLeft += event.shiftKey
            ? event.deltaY
            : event.deltaX;
        }
      },
      { passive: false },
    );
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        originX: event.clientX,
        originY: event.clientY,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.drag) {
        const dx = this.drag.x - event.clientX;
        const dy = this.drag.y - event.clientY;
        const totalX = event.clientX - this.drag.originX;
        const totalY = event.clientY - this.drag.originY;
        this.drag.moved ||= Math.hypot(totalX, totalY) > 3;
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        if (this.drag.moved) {
          if (Math.abs(totalX) > Math.abs(totalY))
            this.viewport.scrollLeft += dx;
          else if (event.pointerType !== "touch") window.scrollBy(0, dy);
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
      else if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        this.events.length
      ) {
        const index = this.events.findIndex(
          (event) => event.id === this.selected,
        );
        const next =
          index < 0
            ? event.key === "ArrowRight"
              ? 0
              : this.events.length - 1
            : Math.max(
                0,
                Math.min(
                  this.events.length - 1,
                  index + (event.key === "ArrowRight" ? 1 : -1),
                ),
              );
        this.select(this.events[next]);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        window.scrollBy(
          0,
          window.innerHeight * (event.key === "ArrowDown" ? 0.15 : -0.15),
        );
        this.schedule();
      } else return;
      event.preventDefault();
    });
  }

  setData(events, tracks, fit = false) {
    this.events = events;
    this.tracks = tracks;
    this.canvas.setAttribute(
      "aria-label",
      `${events.length} events in the timeline. Left and right select events; up and down pan; plus and minus zoom; Home resets the view.`,
    );
    if (fit) this.fit();
    else this.schedule();
  }

  fit() {
    const first = this.events[0]?.relativeMs || 0;
    const last = this.events.at(-1)?.relativeMs || first;
    this.min = first;
    this.span = Math.max(last - first, 0.5) * 1.1;
    this.pendingZoom = null;
    const plotTop = this.viewport.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > plotTop) window.scrollTo(0, plotTop);
    this.viewport.scrollLeft = 0;
    this.schedule();
  }

  zoom(factor, y) {
    const rect = this.viewport.getBoundingClientRect();
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    const screenY = y ?? (visibleTop + HEADER_HEIGHT + visibleBottom) / 2;
    if (this.layout) {
      const worldY = screenY - rect.top;
      const time = yToTime(this.layout, worldY);
      this.pendingZoom = {
        time,
        screenY,
        offset: worldY - timeToY(this.layout, time),
      };
    }
    this.span = Math.max(1e-6, Math.min(1e15, this.span / factor));
    this.schedule();
  }

  focus(event) {
    this.selected = event?.id || null;
    this.pendingFocus = event?.id || null;
    this.schedule();
  }

  position(event) {
    const rectangle = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rectangle.left + this.viewport.scrollLeft,
      y: event.clientY - rectangle.top + this.renderScrollTop,
    };
  }

  hit(position) {
    if (
      position.y - this.renderScrollTop < HEADER_HEIGHT ||
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

  schedule() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.draw();
      });
  }

  draw() {
    const viewportWidth = Math.max(300, this.viewport.clientWidth);
    const availableHeight = Math.max(1, window.innerHeight || 560);
    const layout = layoutTimeline({
      events: this.events,
      tracks: this.tracks,
      width: viewportWidth,
      height: availableHeight,
      min: this.min,
      span: this.span,
    });
    this.layout = layout;
    this.spacer.style.width = `${layout.width}px`;
    this.spacer.style.height = `${layout.height}px`;
    this.viewport.style.height = `${layout.height}px`;
    const plotTop = this.viewport.getBoundingClientRect().top + window.scrollY;
    if (this.pendingZoom) {
      window.scrollTo(
        0,
        Math.max(
          0,
          plotTop +
            timeToY(layout, this.pendingZoom.time) +
            this.pendingZoom.offset -
            this.pendingZoom.screenY,
        ),
      );
      this.pendingZoom = null;
    }
    if (this.pendingFocus) {
      const box = layout.boxes.find(
        (box) => box.event.id === this.pendingFocus,
      );
      const links = requestConnectors(layout, this.pendingFocus);
      const focusLeft = links.length
        ? Math.min(
            ...links.flatMap((link) => link.points.map((point) => point.x)),
          )
        : box?.x;
      if (
        box &&
        (focusLeft < this.viewport.scrollLeft + AXIS_WIDTH ||
          box.x + box.width > this.viewport.scrollLeft + viewportWidth)
      ) {
        const column = layout.columns.find(
          (column) => column.id === box.event.trackKey,
        );
        this.viewport.scrollLeft = Math.max(0, column.x - AXIS_WIDTH);
      }
      if (
        box &&
        (plotTop + box.y < window.scrollY + HEADER_HEIGHT ||
          plotTop + box.y + box.height > window.scrollY + availableHeight)
      ) {
        window.scrollTo(0, Math.max(0, plotTop + box.y - HEADER_HEIGHT - 12));
      }
      const inspector = document.getElementById("inspector");
      if (box && inspector && !inspector.hidden) {
        const workspaceTop =
          inspector.parentElement.getBoundingClientRect().top + window.scrollY;
        if (window.innerWidth > 900) {
          inspector.style.marginTop = `${Math.max(0, window.scrollY + 20 - workspaceTop)}px`;
        } else {
          window.scrollTo(0, workspaceTop);
        }
      }
      this.pendingFocus = null;
    }
    const rect = this.viewport.getBoundingClientRect();
    const scrollLeft = this.viewport.scrollLeft;
    const scrollTop = Math.max(0, Math.min(layout.height - 1, -rect.top));
    const height = Math.max(
      1,
      Math.min(availableHeight, layout.height - scrollTop),
    );
    this.renderScrollTop = scrollTop;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${viewportWidth}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.style.left = `${scrollLeft}px`;
    this.canvas.style.top = `${scrollTop}px`;
    if (
      this.canvas.width !== Math.round(viewportWidth * dpr) ||
      this.canvas.height !== Math.round(height * dpr)
    ) {
      this.canvas.width = Math.round(viewportWidth * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.context;
    ctx.setTransform(dpr, 0, 0, dpr, -scrollLeft * dpr, -scrollTop * dpr);
    ctx.clearRect(scrollLeft, scrollTop, viewportWidth, height);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#fcfcfe";
    ctx.fillRect(scrollLeft, scrollTop, viewportWidth, HEADER_HEIGHT);
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#9297a6";
    layout.columns.forEach((column, index) => {
      ctx.strokeStyle = "#e2e3ec";
      ctx.beginPath();
      ctx.moveTo(column.x, scrollTop);
      ctx.lineTo(column.x, scrollTop + height);
      ctx.stroke();
      ctx.fillStyle = TRACK_COLORS[index % TRACK_COLORS.length];
      ctx.fillRect(column.x + 16, scrollTop + 23, 5, 5);
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
        scrollTop + 30,
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
        scrollTop + 49,
      );
    });
    ctx.strokeStyle = "#e9eaf1";
    ctx.beginPath();
    ctx.moveTo(scrollLeft, scrollTop + HEADER_HEIGHT);
    ctx.lineTo(scrollLeft + viewportWidth, scrollTop + HEADER_HEIGHT);
    ctx.stroke();
    const visibleAnchors = layout.anchors.filter(
      (anchor) =>
        anchor.y >= scrollTop + HEADER_HEIGHT && anchor.y <= scrollTop + height,
    );
    for (const anchor of visibleAnchors) {
      ctx.strokeStyle = "#f0f1f6";
      ctx.beginPath();
      ctx.moveTo(scrollLeft + AXIS_WIDTH, anchor.y);
      ctx.lineTo(scrollLeft + viewportWidth, anchor.y);
      ctx.stroke();
    }
    this.hits = [];
    const labels = [];
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      scrollLeft + AXIS_WIDTH,
      scrollTop + HEADER_HEIGHT,
      viewportWidth - AXIS_WIDTH,
      Math.max(0, height - HEADER_HEIGHT),
    );
    ctx.clip();
    const connectors = requestConnectors(layout, this.selected);
    for (const connector of connectors) {
      ctx.save();
      ctx.strokeStyle = COLORS.control;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.setLineDash(connector.dash);
      ctx.beginPath();
      connector.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.restore();
    }
    for (const box of layout.boxes) {
      const event = box.event;
      if (
        box.x + box.width < scrollLeft + AXIS_WIDTH ||
        box.x > scrollLeft + viewportWidth ||
        box.y + box.height < scrollTop + HEADER_HEIGHT ||
        box.y > scrollTop + height
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
      if (
        event.id === this.selected ||
        connectors.some((connector) => connector.to === event.id)
      ) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2);
        ctx.lineWidth = 1;
      }
      const hasObject = event.objectId !== null || event.objectDelta !== null;
      const rangeEnd =
        event.data.end_of_timed_out_range ||
        event.data.end_of_unknown_range ||
        event.data.end_of_nonexistent_range;
      const label = event.name.includes("subgroup_header")
        ? `${event.label}, id = ${event.subgroupId ?? "—"}`
        : event.category === "control" || rangeEnd || !hasObject
          ? event.label
          : objectLabel(event);
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
    ctx.fillRect(scrollLeft, scrollTop, AXIS_WIDTH, HEADER_HEIGHT);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      scrollLeft,
      scrollTop + HEADER_HEIGHT,
      AXIS_WIDTH,
      Math.max(0, height - HEADER_HEIGHT),
    );
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#9297a6";
    ctx.fillText("TIME (ms)", scrollLeft + 12, scrollTop + 29);
    ctx.font = "10px ui-monospace, SFMono-Regular, monospace";
    let lastTimeLabel = -Infinity;
    for (const anchor of visibleAnchors) {
      if (anchor.y - lastTimeLabel < 38) continue;
      ctx.fillText(
        Number(anchor.time.toPrecision(7)).toLocaleString("en-US", {
          maximumFractionDigits: 6,
        }),
        scrollLeft + 12,
        anchor.y + 3,
      );
      lastTimeLabel = anchor.y;
    }
    ctx.strokeStyle = "#e2e3ec";
    ctx.beginPath();
    ctx.moveTo(scrollLeft + AXIS_WIDTH, scrollTop);
    ctx.lineTo(scrollLeft + AXIS_WIDTH, scrollTop + height);
    ctx.stroke();
    this.canvas.__mlogRender = {
      width: layout.width,
      height: layout.height,
      viewportHeight: height,
      scrollLeft,
      scrollTop,
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
      connections: connectors,
    };
    this.canvas.dataset.renderedEvents = String(this.hits.length);
    this.canvas.dataset.columns = String(layout.columns.length);
    this.canvas.dataset.contentHeight = String(layout.height);
    this.canvas.dataset.viewMin = String(this.min);
    this.canvas.dataset.viewSpan = String(this.span);
    this.canvas.dataset.lastRender = formatMs(this.min);
    this.canvas.dispatchEvent(new CustomEvent("mlog-rendered"));
  }
}
