(function (root, factory) {
  const api = factory(root.Services, root.URL);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.HostTabs = root.HostTabs || {};
    Object.assign(root.HostTabs, api);
  }
})(globalThis, function (services, URLConstructor) {
  "use strict";

  const NEW_TAB_URLS = new Set(["about:newtab", "about:blank"]);

  function normalizedSpec(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function groupNestedURL(spec, prefix) {
    const nested = spec.slice(prefix.length);
    return nested ? getGroupForURL(nested) : prefix;
  }

  function safeURIProperty(uri, name) {
    try {
      return typeof uri[name] === "string" ? uri[name] : "";
    } catch (_) {
      // Some nsIURI implementations throw for components they do not have.
      return "";
    }
  }

  function parseURL(spec) {
    if (services?.io?.newURI) {
      const uri = services.io.newURI(spec);
      const scheme = safeURIProperty(uri, "scheme");
      return {
        protocol: scheme ? `${scheme}:` : "",
        hostname: safeURIProperty(uri, "host"),
        hostPort: safeURIProperty(uri, "hostPort"),
        pathQueryRef: safeURIProperty(uri, "pathQueryRef"),
      };
    }

    if (typeof URLConstructor !== "function") {
      throw new TypeError("No URL parser is available");
    }
    const parsed = new URLConstructor(spec);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      hostPort: parsed.host,
      pathQueryRef: `${parsed.pathname || ""}${parsed.search}${parsed.hash}`,
    };
  }

  function getQueryParameter(spec, name) {
    const queryStart = spec.indexOf("?");
    if (queryStart < 0) {
      return null;
    }
    const fragmentStart = spec.indexOf("#", queryStart);
    const query = spec.slice(
      queryStart + 1,
      fragmentStart < 0 ? spec.length : fragmentStart
    );
    for (const field of query.split("&")) {
      const separator = field.indexOf("=");
      const rawName = separator < 0 ? field : field.slice(0, separator);
      if (decodeURIComponent(rawName.replace(/\+/g, " ")) !== name) {
        continue;
      }
      const rawValue = separator < 0 ? "" : field.slice(separator + 1);
      return decodeURIComponent(rawValue.replace(/\+/g, " "));
    }
    return null;
  }

  function getReaderSource(spec) {
    try {
      return getQueryParameter(spec, "url");
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
      const parsed = parseURL(spec);
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
      const parsed = parseURL(spec);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.pathQueryRef || "/";
      }
      if (parsed.protocol === "file:") {
        return decodeURIComponent(parsed.pathQueryRef || spec);
      }
    } catch (_) {
      // The original string is the most useful safe fallback.
    }
    return spec;
  }

  function getHomepageURL(value) {
    const spec = normalizedSpec(value);
    if (!spec) {
      return "";
    }

    const lower = spec.toLowerCase();
    if (lower.startsWith("view-source:")) {
      return getHomepageURL(spec.slice("view-source:".length));
    }
    if (lower.startsWith("about:reader")) {
      const source = getReaderSource(spec);
      return source ? getHomepageURL(source) : "";
    }

    try {
      const parsed = parseURL(spec);
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.hostname
      ) {
        return `${parsed.protocol}//${parsed.hostPort || parsed.hostname}/`;
      }
    } catch (_) {
      // Special and malformed URLs do not have a web homepage.
    }
    return "";
  }

  return { getGroupForURL, getSecondaryText, getHomepageURL };
});
