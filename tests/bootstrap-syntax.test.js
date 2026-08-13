"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const relativePath of [
  "../src/bootstrap/autoconfig.js",
  "../src/bootstrap/hosttabs.cfg",
]) {
  test(`${relativePath} parses as JavaScript`, () => {
    const absolutePath = path.join(__dirname, relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename: absolutePath }));
  });
}

test("AutoConfig preference loader uses LF line endings", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/bootstrap/autoconfig.js")
  );
  assert.equal(source.includes(Buffer.from("\r\n")), false);
});
