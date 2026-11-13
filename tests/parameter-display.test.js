// Copyright (c) 2026 Aman Sharma. MIT licensed.
import test from "node:test";
import assert from "node:assert/strict";
import { parameterDisplayValue } from "../src/format.js";

test("group order uses the Transport-22 enum values", () => {
  assert.equal(parameterDisplayValue("group_order", 1), "ASCENDING");
  assert.equal(parameterDisplayValue("group_order", "2"), "DESCENDING");
  assert.equal(parameterDisplayValue("group_order", 0), 0);
  assert.equal(parameterDisplayValue("group_order", 3), 3);
  assert.deepEqual(parameterDisplayValue("group_order", [1]), [1]);
});

test("boolean parameters are decoded without changing unrelated numeric values", () => {
  assert.equal(parameterDisplayValue("forward", 0), "FALSE");
  assert.equal(parameterDisplayValue("forward", "1"), "TRUE");
  assert.equal(parameterDisplayValue("include_properties", 1), "TRUE");
  assert.equal(parameterDisplayValue("include_properties", 0), "FALSE");
  assert.equal(parameterDisplayValue("subscriber_priority", 0), 0);
  assert.equal(parameterDisplayValue("unknown", 2), 2);
});

test("timeout values keep their units and exact large values", () => {
  assert.equal(parameterDisplayValue("fill_timeout", 0), "0 ms");
  assert.equal(parameterDisplayValue("rendezvous_timeout", 50), "50 ms");
  assert.equal(parameterDisplayValue("object_delivery_timeout", 0), "DISABLED");
  assert.equal(parameterDisplayValue("expires", 0), "NO EXPIRY / UNKNOWN");
  assert.equal(
    parameterDisplayValue("fill_timeout", "18446744073709551615"),
    "18446744073709551615 ms",
  );
});

test("nested fill parameters are decoded without mutating the logged values", () => {
  const raw = [
    { name: "group_order", value: 2 },
    { name: "fill_timeout", value: 10 },
    { name: "location_filter", value: { start_group: 0 } },
  ];
  const before = structuredClone(raw);
  const display = parameterDisplayValue("fill_parameters", raw);
  assert.equal(display[0].value, "DESCENDING");
  assert.equal(display[1].value, "10 ms");
  assert.deepEqual(display[2].value, { start_group: 0 });
  assert.deepEqual(raw, before);
  assert.deepEqual(parameterDisplayValue("fill_parameters", []), []);
});
