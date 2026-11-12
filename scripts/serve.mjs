// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.MLOG_VIEWER_PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".mlog": "application/json",
  ".qlog": "application/json",
  ".sqlog": "application/qlog+json-seq",
};
const server = createServer(async (request, response) => {
  try {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    let path = decodeURIComponent(
      new URL(request.url, "http://127.0.0.1").pathname,
    );
    if (path.startsWith("/mlog/")) path = path.slice(5);
    if (path === "/") path = "/index.html";
    if (
      !["/index.html", "/style.css", "/favicon.svg"].includes(path) &&
      !path.startsWith("/src/") &&
      !path.startsWith("/examples/")
    ) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const file = resolve(root, `.${path}`);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`mLog Visualizer: http://127.0.0.1:${port}/mlog/`),
);
