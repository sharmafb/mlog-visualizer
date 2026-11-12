// Copyright (c) 2026 Aman Sharma. MIT licensed.
(() => {
  const canvas = document.getElementById("timeline");
  const render = canvas.__mlogRender;
  if (!render) throw new Error("No rendered layout");
  const failures = [];
  if (new Set(render.boxes.map((box) => box.height)).size > 1)
    failures.push("Event boxes have different heights");
  for (let i = 0; i < render.boxes.length; i++) {
    const a = render.boxes[i];
    for (let j = i + 1; j < render.boxes.length; j++) {
      const b = render.boxes[j];
      if (a.track === b.track && (a.x !== b.x || a.width !== b.width))
        failures.push("Track is not a single vertical stack: " + a.track);
      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      )
        failures.push("Overlap: " + a.id + ", " + b.id);
    }
  }
  for (const label of render.labels) {
    const b = label.box,
      t = label.bounds;
    if (!label.text) failures.push("Empty label: " + label.id);
    if (
      t.x < b.x + 2 - 0.1 ||
      t.y < b.y + 2 - 0.1 ||
      t.x + t.width > b.x + b.width - 2 + 0.1 ||
      t.y + t.height > b.y + b.height - 2 + 0.1
    )
      failures.push("Label outside box: " + label.id);
  }
  if (new Set(render.columns.map((c) => c.id)).size !== render.columns.length)
    failures.push("Duplicate track column");
  if (canvas.width > (canvas.parentElement.clientWidth + 1) * devicePixelRatio)
    failures.push("Canvas is not virtualized");
  if (
    canvas.height >
    (canvas.parentElement.clientHeight + 1) * devicePixelRatio
  )
    failures.push("Canvas height is not virtualized");
  if (failures.length) throw new Error(failures.join("\n"));
  return {
    viewport: innerWidth + "x" + innerHeight,
    columns: render.columns.map((c) => c.name),
    boxes: render.boxes.length,
    labels: render.labels.length,
    canvasWidth: canvas.width,
    contentWidth: render.width,
    scrollLeft: render.scrollLeft,
    transfers: document.body.dataset.loadedTransfers,
    records: document.body.dataset.loadedEvents,
    failures: [],
  };
})();
