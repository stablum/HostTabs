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

test("homepage opens as a foreground trusted tab in the source container", () => {
  const FirefoxAdapter = loadAdapter();
  const openedTab = {};
  const calls = [];
  const win = {
    document: {},
    gBrowser: {
      addTrustedTab(url, options) {
        calls.push({ url, options });
        return openedTab;
      },
      selectedTab: null,
    },
  };
  const sourceTab = {
    getAttribute(name) {
      return name === "usercontextid" ? "4" : "";
    },
  };

  new FirefoxAdapter(win, logger).openURLInNewTab("https://example.com/", sourceTab);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/");
  assert.deepEqual({ ...calls[0].options }, {
    inBackground: false,
    relatedToCurrent: true,
    userContextId: 4,
  });
  assert.equal(win.gBrowser.selectedTab, openedTab);
});

test("homepage navigation falls back to Firefox's trusted link helper", () => {
  const FirefoxAdapter = loadAdapter();
  const calls = [];
  const win = {
    document: {},
    gBrowser: {},
    openTrustedLinkIn(url, where, options) {
      calls.push({ url, where, options });
    },
  };

  new FirefoxAdapter(win, logger).openURLInNewTab("https://example.com/", null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/");
  assert.equal(calls[0].where, "tab");
  assert.deepEqual({ ...calls[0].options }, {
    inBackground: false,
    relatedToCurrent: true,
  });
});

test("native tab context menu receives the represented real tab as trigger context", () => {
  const FirefoxAdapter = loadAdapter();
  const tab = {};
  const target = {};
  const calls = [];
  const menu = {
    openPopupAtScreen(...args) {
      calls.push(args);
    },
  };
  const win = {
    document: {
      getElementById(id) {
        return id === "tabContextMenu" ? menu : null;
      },
    },
    gBrowser: {},
    TabContextMenu: {},
    mozInnerScreenX: 10,
    mozInnerScreenY: 20,
  };
  const anchor = {
    getBoundingClientRect() {
      return { left: 30, top: 40 };
    },
  };
  const event = { target, screenX: 100, screenY: 200 };

  const opened = new FirefoxAdapter(win, logger).openNativeTabContextMenu(
    tab,
    anchor,
    event
  );

  assert.equal(opened, true);
  assert.equal(anchor.tab, tab);
  assert.equal(target.tab, tab);
  assert.deepEqual(calls, [[100, 200, true, event]]);
});

test("host group reordering applies a complete real-tab order", () => {
  const FirefoxAdapter = loadAdapter();
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const moves = [];
  const win = {
    document: {},
    gBrowser: {
      tabs,
      moveTabTo(tab, index) {
        moves.push([tab.id, index]);
        const current = tabs.indexOf(tab);
        tabs.splice(current, 1);
        tabs.splice(index, 0, tab);
      },
    },
  };

  const applied = new FirefoxAdapter(win, logger).reorderTabs([
    tabs[2],
    tabs[3],
    tabs[0],
    tabs[1],
  ]);

  assert.equal(applied, true);
  assert.deepEqual(tabs.map(tab => tab.id), ["c", "d", "a", "b"]);
  assert.deepEqual(moves, [["c", 0], ["d", 1]]);
});
