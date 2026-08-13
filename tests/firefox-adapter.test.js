"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadAdapter() {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/chrome/firefox-adapter.js"),
    "utf8"
  );
  const context = {
    ChromeUtils: { importESModule: () => ({}) },
  };
  vm.runInNewContext(source, context);
  return context.HostTabs.FirefoxAdapter;
}

const logger = {
  debug() {},
  warn() {},
};

test("new tab uses Firefox's BrowserCommands no-event path", () => {
  const FirefoxAdapter = loadAdapter();
  let opened = 0;
  const win = {
    document: {},
    gBrowser: {},
    BrowserCommands: {
      openTab() {
        opened += 1;
      },
    },
    goDoCommand() {
      assert.fail("legacy command fallback should not run");
    },
  };

  new FirefoxAdapter(win, logger).newTab();
  assert.equal(opened, 1);
});

test("new tab falls back to Firefox's explicit no-event command", () => {
  const FirefoxAdapter = loadAdapter();
  const commands = [];
  const win = {
    document: {},
    gBrowser: {},
    goDoCommand(command) {
      commands.push(command);
    },
  };

  new FirefoxAdapter(win, logger).newTab();
  assert.deepEqual(commands, ["cmd_newNavigatorTabNoEvent"]);
});
