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

test("AutoConfig bootstrap prefers Firefox's privileged Services global", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/bootstrap/hosttabs.cfg"),
    "utf8"
  );
  const reportedErrors = [];
  let importCalls = 0;
  const bootstrapFile = {
    append() {},
    exists() {
      return false;
    },
    isFile() {
      return false;
    },
  };
  const profileDir = {
    clone() {
      return bootstrapFile;
    },
  };

  vm.runInNewContext(source, {
    Components: {
      interfaces: { nsIFile: Symbol("nsIFile") },
      utils: { reportError: error => reportedErrors.push(error) },
    },
    ChromeUtils: {
      importESModule() {
        importCalls += 1;
        throw new Error("Legacy Services module is unavailable");
      },
    },
    Services: {
      appinfo: { inSafeMode: false },
      dirsvc: { get: () => profileDir },
    },
  });

  assert.equal(importCalls, 0);
  assert.deepEqual(reportedErrors, []);
});

test("profile bootstrap prefers Firefox's privileged Services global", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/chrome/bootstrap.js"),
    "utf8"
  );
  const reportedErrors = [];
  let importCalls = 0;
  const missingFile = {
    append() {},
    clone() {
      return this;
    },
    exists() {
      return false;
    },
    path: "missing-hosttabs-source",
  };

  vm.runInNewContext(source, {
    Components: {
      classes: {},
      interfaces: { nsIFile: Symbol("nsIFile") },
      utils: { reportError: error => reportedErrors.push(error) },
    },
    ChromeUtils: {
      importESModule() {
        importCalls += 1;
        throw new Error("Legacy Services module is unavailable");
      },
    },
    Services: {
      console: { logStringMessage() {} },
      dirsvc: { get: () => missingFile },
      prefs: { getBoolPref: () => false },
    },
  });

  assert.equal(importCalls, 0);
  assert.equal(reportedErrors.length, 1);
  assert.match(String(reportedErrors[0]), /Required HostTabs source is missing/);
});
