"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getGroupForURL, getSecondaryText } = require("../src/chrome/url-groups.js");

const cases = [
  ["https://www.reddit.com/foo", "www.reddit.com"],
  ["http://www.reddit.com/foo", "www.reddit.com"],
  ["https://old.reddit.com/foo", "old.reddit.com"],
  ["https://localhost:8123/foo", "localhost"],
  ["https://127.0.0.1:9000/", "127.0.0.1"],
  ["about:newtab", "New Tab"],
  ["about:blank", "New Tab"],
  ["about:config", "about:"],
  ["about:addons", "about:"],
  ["about:preferences", "about:"],
  ["file:///C:/foo/bar.html", "file:"],
  ["data:text/plain,hello", "data:"],
  ["blob:https://example.com/id", "blob:"],
  ["moz-extension://generated-uuid/page.html", "Extensions"],
  ["view-source:https://example.com/test", "example.com"],
  ["about:reader?url=https%3A%2F%2Fdeveloper.mozilla.org%2Fdocs", "developer.mozilla.org"],
  ["custom-scheme:thing", "custom-scheme:"],
  ["not a url", "Other"],
  [null, "Other"],
];

for (const [input, expected] of cases) {
  test(`${String(input)} -> ${expected}`, () => {
    assert.equal(getGroupForURL(input), expected);
  });
}

test("HTTP secondary text keeps path, query, and fragment", () => {
  assert.equal(
    getSecondaryText("https://example.com/a/long/path?q=1#part"),
    "/a/long/path?q=1#part"
  );
});

test("malformed secondary text is safe", () => {
  assert.doesNotThrow(() => getSecondaryText("%%%"));
  assert.equal(getSecondaryText("%%%"), "%%%");
});
