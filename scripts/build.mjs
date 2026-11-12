// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = resolve(root, "dist");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const path of [
  "index.html",
  "style.css",
  "favicon.svg",
  "src",
  "examples",
  "LICENSE",
]) {
  await cp(resolve(root, path), resolve(target, path), { recursive: true });
}
console.log(
  `Built static site in dist/ (${(await readdir(target)).length} entries).`,
);
