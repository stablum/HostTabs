"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  getGroupForURL,
  getSecondaryText,
  getHomepageURL,
} = require("../src/chrome/url-groups.js");

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

test("homepage URL removes path, query, fragment, and credentials", () => {
  assert.equal(
    getHomepageURL("https://user:secret@example.com/a/path?q=1#part"),
    "https://example.com/"
  );
});

test("homepage URL preserves scheme and non-default port", () => {
  assert.equal(
    getHomepageURL("http://localhost:8123/a/path"),
    "http://localhost:8123/"
  );
});

test("homepage URL unwraps Reader View and view-source URLs", () => {
  assert.equal(
    getHomepageURL("view-source:https://example.com/a/path"),
    "https://example.com/"
  );
  assert.equal(
    getHomepageURL("about:reader?url=https%3A%2F%2Fdeveloper.mozilla.org%2Fdocs"),
    "https://developer.mozilla.org/"
  );
});

test("special buckets do not expose a homepage URL", () => {
  assert.equal(getHomepageURL("about:config"), "");
  assert.equal(getHomepageURL("file:///C:/foo/bar.html"), "");
  assert.equal(getHomepageURL("not a url"), "");
});

test("Firefox privileged runtime uses Services.io when DOM URL is unavailable", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/chrome/url-groups.js"),
    "utf8"
  );
  const context = {
    Services: {
      io: {
        newURI(spec) {
          const parsed = new URL(spec);
          return {
            scheme: parsed.protocol.slice(0, -1),
            host: parsed.hostname,
            hostPort: parsed.host,
            pathQueryRef: `${parsed.pathname}${parsed.search}${parsed.hash}`,
          };
        },
      },
    },
    URL: class UnavailableDOMURL {
      constructor() {
        throw new Error("DOM URL must not be used in the AutoConfig global");
      }
    },
  };

  vm.runInNewContext(source, context);

  assert.equal(
    context.HostTabs.getGroupForURL("https://www.reddit.com/?feed=home"),
    "www.reddit.com"
  );
  assert.equal(
    context.HostTabs.getGroupForURL("https://www.youtube.com/"),
    "www.youtube.com"
  );
  assert.equal(
    context.HostTabs.getSecondaryText("https://www.youtube.com/watch?v=abc#player"),
    "/watch?v=abc#player"
  );
  assert.equal(
    context.HostTabs.getHomepageURL("https://localhost:8123/watch?v=abc"),
    "https://localhost:8123/"
  );
});
