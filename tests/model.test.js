"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGroups } = require("../src/chrome/model.js");

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
