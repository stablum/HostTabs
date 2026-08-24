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

test("host tabs expose control-aware minimum widths to the fair allocator", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../src/chrome/hosttabs.css"),
    "utf8"
  );
  const rule = /\.hosttabs-group\s*\{([^}]*)\}/s.exec(css);

  assert.ok(rule, "host group CSS rule should exist");
  assert.match(rule[1], /flex:\s*0\s+0\s+auto\s*;/);
  assert.match(rule[1], /max-width:\s*none\s*;/);
  assert.match(rule[1], /min-width:\s*calc\(/);
  assert.match(css, /\.hosttabs-group\.has-icon\s*\{/);
  assert.match(css, /\.hosttabs-group\.has-home\s*\{/);
  assert.match(css, /\.hosttabs-group\.has-count\s*\{/);
});

test("host drag and drop has grab cursors and directional indicators", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../src/chrome/hosttabs.css"),
    "utf8"
  );

  assert.match(css, /cursor:\s*grab\s*;/);
  assert.match(css, /cursor:\s*grabbing\s*;/);
  assert.match(css, /\.hosttabs-group\.drop-before\s*\{/);
  assert.match(css, /\.hosttabs-group\.drop-after\s*\{/);
});

test("page rows retain their text column when a favicon is hidden", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../src/chrome/hosttabs.css"),
    "utf8"
  );
  const row = Array.from(
    css.matchAll(/\.hosttabs-page-row\s*\{([^}]*)\}/gs)
  ).find(match => /display:\s*grid\s*;/.test(match[1]));

  assert.ok(row, "page row CSS rule should exist");
  assert.match(row[1], /grid-template-areas:\s*"icon text status close"\s*;/);
  assert.match(css, /\.hosttabs-page-icon\s*\{[^}]*grid-area:\s*icon\s*;/s);
  assert.match(css, /\.hosttabs-page-text\s*\{[^}]*grid-area:\s*text\s*;/s);
  assert.match(css, /\.hosttabs-page-status\s*\{[^}]*grid-area:\s*status\s*;/s);
  assert.match(css, /\.hosttabs-page-close\s*\{[^}]*grid-area:\s*close\s*;/s);
});
