"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadHostTabs() {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/chrome/hosttabs.uc.js"),
    "utf8"
  );
  const context = { HostTabs: {} };
  vm.runInNewContext(source, context);
  return context.HostTabs;
}

function controllerStub() {
  const HostTabsController = loadHostTabs().HostTabsController;
  const controller = Object.create(HostTabsController.prototype);
  controller.openGroup = "example.com";
  controller.openingButton = {};
  controller.panelPersistent = false;
  controller.panel = {
    hidden: false,
    contains(target) {
      return target === "panel-child";
    },
  };
  controller.groupButtons = new Map([
    [
      "example.com",
      {
        contains(target) {
          return target === "group-child";
        },
      },
    ],
  ]);
  return controller;
}

test("title truncation strips punctuation and spaces before its single period", () => {
  const { truncateTitleToFit } = loadHostTabs();
  const fits = value => value.length <= 7;

  assert.equal(truncateTitleToFit("Alpha -------- Omega", fits), "Alpha.");
  assert.equal(truncateTitleToFit("Already fits", () => true), "Already fits");
  assert.equal(truncateTitleToFit("Ångström / more", value => value.length <= 9), "Ångström.");
});

test("title truncation does not replace only one omitted character with a period", () => {
  const { truncateTitleToFit } = loadHostTabs();
  const fits = value => value !== "New Tab" && value.length <= 7;

  assert.equal(truncateTitleToFit("New Tab", fits), "New Ta");
  assert.equal(truncateTitleToFit("X", value => value === "."), "");
});

test("adaptive widths give equally controlled host tabs equal space", () => {
  const { allocateGroupWidths } = loadHostTabs();

  assert.deepEqual(
    Array.from(allocateGroupWidths([220, 220, 220], [100, 100, 100], 450)),
    [150, 150, 150]
  );
});

test("adaptive widths redistribute space unused by naturally short tabs", () => {
  const { allocateGroupWidths } = loadHostTabs();

  assert.deepEqual(
    Array.from(allocateGroupWidths([120, 220, 220], [100, 100, 100], 400)),
    [120, 140, 140]
  );
});

test("adaptive widths preserve different control minimums and overflow safely", () => {
  const { allocateGroupWidths } = loadHostTabs();
  const fair = Array.from(
    allocateGroupWidths([220, 220, 220], [100, 140, 100], 420)
  );

  assert.ok(Math.abs(fair[0] - 126.6667) < 0.001);
  assert.ok(Math.abs(fair[1] - 166.6667) < 0.001);
  assert.ok(Math.abs(fair[2] - 126.6667) < 0.001);
  assert.deepEqual(
    Array.from(allocateGroupWidths([220, 220], [100, 140], 200)),
    [100, 140]
  );
});

test("hover opens a transient panel but never replaces a persistent panel", () => {
  const controller = controllerStub();
  const calls = [];
  controller.panel.hidden = true;
  controller.openGroup = null;
  controller.openPanel = (...args) => calls.push(args);

  const button = {};
  controller.openHoverPanel("example.com", button);
  assert.deepEqual(calls, [["example.com", button, false, false]]);

  controller.panelPersistent = true;
  controller.openHoverPanel("other.example", {});
  assert.equal(calls.length, 1);
});

test("clicking an open hover panel pins it and retains click focus behavior", () => {
  const controller = controllerStub();
  let layoutFocus = null;
  let closed = false;
  const button = {};
  controller.schedulePanelLayout = moveFocus => (layoutFocus = moveFocus);
  controller.closePanel = () => (closed = true);

  controller.togglePanel("example.com", button);

  assert.equal(controller.panelPersistent, true);
  assert.equal(controller.openingButton, button);
  assert.equal(layoutFocus, true);
  assert.equal(closed, false);
});

test("clicking an already persistent panel keeps the existing toggle-close behavior", () => {
  const controller = controllerStub();
  controller.panelPersistent = true;
  let returnFocus = null;
  controller.closePanel = value => (returnFocus = value);

  controller.togglePanel("example.com", {});

  assert.equal(returnFocus, true);
});

test("a transient panel closes only after leaving both host tab and panel", () => {
  const controller = controllerStub();
  let closes = 0;
  controller.closePanel = () => (closes += 1);

  controller.onHoverRegionLeave("example.com", "panel-child");
  controller.onHoverRegionLeave("example.com", "group-child");
  assert.equal(closes, 0);

  controller.onHoverRegionLeave("example.com", "outside");
  assert.equal(closes, 1);

  controller.panelPersistent = true;
  controller.onHoverRegionLeave("example.com", "outside");
  assert.equal(closes, 1);
});
