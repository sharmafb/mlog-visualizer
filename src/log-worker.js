// Copyright (c) 2026 Aman Sharma. MIT licensed.
import { parseLog } from "./log-parser.js";

self.addEventListener("message", ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      result: parseLog(data.text, data.options),
    });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
});
