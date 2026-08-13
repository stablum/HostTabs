(function (root) {
  "use strict";

  const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
  // Firefox 153 exposes Services as a privileged global and no longer ships
  // Services.sys.mjs. Keep the import only as a fallback for older releases.
  const Services =
    root.Services ||
    ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;

  function childFile(parent, ...parts) {
    const file = parent.clone();
    for (const part of parts) {
      file.append(part);
    }
    return file;
  }

  function readUTF8(file) {
    const fileStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(
      Ci.nsIFileInputStream
    );
    const converter = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(
      Ci.nsIConverterInputStream
    );
    fileStream.init(file, -1, 0, 0);
    converter.init(
      fileStream,
      "UTF-8",
      0,
      Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER
    );
    let text = "";
    const chunk = {};
    try {
      while (converter.readString(0xffffffff, chunk)) {
        text += chunk.value;
      }
    } finally {
      converter.close();
    }
    return text;
  }

  function report(level, message, error) {
    const suffix = error ? `\n${error.stack || error}` : "";
    const text = `[HostTabs] ${message}${suffix}`;
    if (level === "error" || level === "warn") {
      Cu.reportError(text);
    }
    if (level !== "debug" || Services.prefs.getBoolPref("hosttabs.debug", false)) {
      Services.console.logStringMessage(text);
    }
  }

  const logger = {
    debug: (message, error) => report("debug", message, error),
    info: (message, error) => report("info", message, error),
    warn: (message, error) => report("warn", message, error),
    error: (message, error) => report("error", message, error),
  };

  class HostTabsBootstrap {
    constructor() {
      this.controllers = new Map();
      this.started = false;
      this.profileRoot = Services.dirsvc.get("ProfD", Ci.nsIFile);
      this.sourceRoot = childFile(this.profileRoot, "chrome", "hosttabs");
      this.cssText = "";
    }

    start() {
      if (this.started) {
        return;
      }
      this.loadSource();
      this.started = true;
      Services.obs.addObserver(this, "browser-delayed-startup-finished");
      Services.obs.addObserver(this, "quit-application-granted");

      const windows = Services.wm.getEnumerator("navigator:browser");
      while (windows.hasMoreElements()) {
        const win = windows.getNext();
        if (win.gBrowserInit?.delayedStartupFinished) {
          this.initializeWindow(win);
        }
      }
      logger.info(`Bootstrap started for Firefox ${Services.appinfo.version}`);
    }

    loadSource() {
      const scripts = [
        "url-groups.js",
        "model.js",
        "firefox-adapter.js",
        "hosttabs.uc.js",
      ];
      for (const name of scripts) {
        const file = childFile(this.sourceRoot, name);
        if (!file.exists()) {
          throw new Error(`Required HostTabs source is missing: ${file.path}`);
        }
        Services.scriptloader.loadSubScript(
          Services.io.newFileURI(file).spec,
          root,
          "UTF-8"
        );
      }
      const cssFile = childFile(this.sourceRoot, "hosttabs.css");
      if (!cssFile.exists()) {
        throw new Error(`Required HostTabs stylesheet is missing: ${cssFile.path}`);
      }
      this.cssText = readUTF8(cssFile);
    }

    observe(subject, topic) {
      if (topic === "browser-delayed-startup-finished") {
        this.initializeWindow(subject);
      } else if (topic === "quit-application-granted") {
        this.stop("Firefox shutdown");
      }
    }

    isBrowserWindow(win) {
      return Boolean(
        win &&
          !win.closed &&
          win.document?.documentElement?.getAttribute("windowtype") === "navigator:browser" &&
          win.location?.href === "chrome://browser/content/browser.xhtml" &&
          win.gBrowser
      );
    }

    initializeWindow(win) {
      if (!this.started || !this.isBrowserWindow(win) || this.controllers.has(win)) {
        return;
      }
      try {
        const controller = new root.HostTabs.HostTabsController(
          win,
          this.cssText,
          logger,
          destroyed => {
            if (this.controllers.get(win) === destroyed) {
              this.controllers.delete(win);
            }
          }
        ).init();
        this.controllers.set(win, controller);
        this.installDevAPI(win);
      } catch (error) {
        logger.error("Window initialization failed open", error);
      }
    }

    installDevAPI(win) {
      const bootstrap = this;
      win.HostTabsDev = Object.freeze({
        destroy() {
          bootstrap.controllers.get(win)?.destroy("HostTabsDev.destroy()");
        },
        reinitialize() {
          bootstrap.controllers.get(win)?.destroy("HostTabsDev.reinitialize()");
          bootstrap.initializeWindow(win);
        },
        enableVerbose(enabled = true) {
          Services.prefs.setBoolPref("hosttabs.debug", Boolean(enabled));
          logger.info(`Verbose logging ${enabled ? "enabled" : "disabled"}`);
        },
      });
    }

    stop(reason = "requested") {
      if (!this.started) {
        return;
      }
      this.started = false;
      try {
        Services.obs.removeObserver(this, "browser-delayed-startup-finished");
        Services.obs.removeObserver(this, "quit-application-granted");
      } catch (_) {
        // Observer cleanup can race application shutdown.
      }
      for (const [win, controller] of [...this.controllers]) {
        controller.destroy(reason);
        try {
          delete win.HostTabsDev;
        } catch (_) {
          // Window globals can already be dead during shutdown.
        }
      }
      this.controllers.clear();
      logger.info(`Bootstrap stopped (${reason})`);
    }
  }

  try {
    root.HostTabsBootstrap?.stop?.("bootstrap reload");
    root.HostTabsBootstrap = new HostTabsBootstrap();
    root.HostTabsBootstrap.start();
  } catch (error) {
    report("error", "Bootstrap failed before any native tab UI was hidden", error);
  }
})(globalThis);
