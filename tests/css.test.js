"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("compact host titles leave overflow marking to the measured title fitter", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../src/chrome/hosttabs.css"),
    "utf8"
  );
  const rule = /\.hosttabs-group-name\s*\{([^}]*)\}/s.exec(css);

  assert.ok(rule, "host title CSS rule should exist");
  assert.match(rule[1], /text-overflow:\s*clip\s*;/);
  assert.doesNotMatch(rule[1], /text-overflow:\s*ellipsis\s*;/);
});
