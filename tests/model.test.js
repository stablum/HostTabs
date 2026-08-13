"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGroups, getGroupClosePlan } = require("../src/chrome/model.js");

test("groups and pages follow underlying Firefox tab order", () => {
  const records = [
    { position: 0, url: "https://www.reddit.com/a", active: false, favicon: "r" },
    { position: 1, url: "https://github.com/a", active: false, favicon: "g" },
    { position: 2, url: "https://www.reddit.com/b", active: true, favicon: "" },
    { position: 3, url: "https://wikipedia.org/a", active: false, favicon: "w" },
    { position: 4, url: "https://www.reddit.com/c", active: false, favicon: "" },
  ];

  const groups = buildGroups(records);
  assert.deepEqual(
    groups.map(group => [group.label, group.tabs.map(tab => tab.position)]),
    [
      ["www.reddit.com", [0, 2, 4]],
      ["github.com", [1]],
      ["wikipedia.org", [3]],
    ]
  );
  assert.equal(groups[0].active, true);
  assert.equal(groups[0].favicon, "r");
});

test("navigation changes grouping without changing tab positions", () => {
  const records = [
    { position: 0, url: "https://example.com", active: true },
    { position: 1, url: "https://mozilla.org", active: false },
  ];
  records[0].url = "https://mozilla.org/new-place";
  const groups = buildGroups(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "mozilla.org");
  assert.deepEqual(groups[0].tabs.map(tab => tab.position), [0, 1]);
});

test("groups retain the most recently accessed real tab", () => {
  const records = [
    {
      id: "older",
      position: 0,
      url: "https://example.com/older",
      lastAccessed: 100,
      active: false,
    },
    {
      id: "recent",
      position: 1,
      url: "https://example.com/recent",
      lastAccessed: 300,
      active: false,
    },
    {
      id: "middle",
      position: 2,
      url: "https://example.com/middle",
      lastAccessed: 200,
      active: false,
    },
  ];

  const [group] = buildGroups(records);
  assert.equal(group.lastAccessedTab.id, "recent");
});

test("the active tab is the group's last-accessed fallback", () => {
  const records = [
    {
      id: "restored",
      position: 0,
      url: "https://example.com/restored",
      lastAccessed: 500,
      active: false,
    },
    {
      id: "active",
      position: 1,
      url: "https://example.com/active",
      active: true,
    },
  ];

  const [group] = buildGroups(records);
  assert.equal(group.lastAccessedTab.id, "active");
});

test("closing an active group targets its active tab then the previous visit", () => {
  const records = [
    {
      id: "previous",
      position: 0,
      url: "https://example.com/previous",
      lastAccessed: 400,
      active: false,
    },
    {
      id: "active",
      position: 1,
      url: "https://example.com/active",
      lastAccessed: 100,
      active: true,
    },
    {
      id: "older",
      position: 2,
      url: "https://example.com/older",
      lastAccessed: 200,
      active: false,
    },
  ];

  const [group] = buildGroups(records);
  const plan = getGroupClosePlan(group);
  assert.equal(plan.target.id, "active");
  assert.equal(plan.next.id, "previous");
});

test("closing an inactive group targets its last-accessed tab", () => {
  const records = [
    {
      id: "older",
      position: 0,
      url: "https://example.com/older",
      lastAccessed: 100,
      active: false,
    },
    {
      id: "recent",
      position: 1,
      url: "https://example.com/recent",
      lastAccessed: 300,
      active: false,
    },
    {
      id: "middle",
      position: 2,
      url: "https://example.com/middle",
      lastAccessed: 200,
      active: false,
    },
  ];

  const [group] = buildGroups(records);
  const plan = getGroupClosePlan(group);
  assert.equal(plan.target.id, "recent");
  assert.equal(plan.next.id, "middle");
});
