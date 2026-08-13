(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.HostTabs = root.HostTabs || {};
    Object.assign(root.HostTabs, api);
  }
})(globalThis, function () {
  "use strict";

  const NEW_TAB_URLS = new Set(["about:newtab", "about:blank"]);

  function normalizedSpec(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function groupNestedURL(spec, prefix) {
    const nested = spec.slice(prefix.length);
    return nested ? getGroupForURL(nested) : prefix;
  }

  function getReaderSource(spec) {
    try {
      const readerURL = new URL(spec);
      return readerURL.searchParams.get("url");
    } catch (_) {
      return null;
    }
  }

  function getGroupForURL(value) {
    const spec = normalizedSpec(value);
    if (!spec) {
      return "Other";
    }

    const lower = spec.toLowerCase();
    if (NEW_TAB_URLS.has(lower)) {
      return "New Tab";
    }
    if (lower.startsWith("view-source:")) {
      return groupNestedURL(spec, "view-source:");
    }
    if (lower.startsWith("about:reader")) {
      const source = getReaderSource(spec);
      return source ? getGroupForURL(source) : "about:";
    }

    try {
      const parsed = new URL(spec);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname) {
        return parsed.hostname;
      }

      switch (parsed.protocol) {
        case "about:":
          return "about:";
        case "file:":
          return "file:";
        case "data:":
          return "data:";
        case "blob:":
          return "blob:";
        case "moz-extension:":
          return "Extensions";
        default:
          return parsed.protocol || "Other";
      }
    } catch (_) {
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(spec);
      return scheme ? `${scheme[1].toLowerCase()}:` : "Other";
    }
  }

  function getSecondaryText(value) {
    const spec = normalizedSpec(value);
    if (!spec) {
      return "";
    }
    if (spec.toLowerCase().startsWith("view-source:")) {
      return `view-source: ${getSecondaryText(spec.slice("view-source:".length))}`;
    }
    if (spec.toLowerCase().startsWith("about:reader")) {
      const source = getReaderSource(spec);
      return source ? `Reader View · ${getSecondaryText(source)}` : spec;
    }
    try {
      const parsed = new URL(spec);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return `${parsed.pathname || "/"}${parsed.search}${parsed.hash}`;
      }
      if (parsed.protocol === "file:") {
        return decodeURIComponent(parsed.pathname || spec);
      }
    } catch (_) {
      // The original string is the most useful safe fallback.
    }
    return spec;
  }

  return { getGroupForURL, getSecondaryText };
});
