(function (root) {
  "use strict";

  root.HostTabs = root.HostTabs || {};

  class FirefoxAdapter {
    constructor(win, logger) {
      this.win = win;
      this.doc = win.document;
      this.gBrowser = win.gBrowser;
      this.log = logger;
      this.tabIds = new WeakMap();
      this.nextTabId = 1;
      this.contextualIdentityService = null;

      try {
        const imported = ChromeUtils.importESModule(
          "resource://gre/modules/ContextualIdentityService.sys.mjs"
        );
        this.contextualIdentityService = imported.ContextualIdentityService;
      } catch (error) {
        this.log.debug("Container identity service is unavailable", error);
      }
    }

    assertCompatible() {
      if (!this.gBrowser || !this.gBrowser.tabContainer) {
        throw new Error("gBrowser/tabContainer is unavailable");
      }
      const toolbar = this.doc.getElementById("TabsToolbar");
      const target = this.doc.getElementById("TabsToolbar-customization-target");
      const nativeTabs = this.doc.getElementById("tabbrowser-tabs");
      if (!toolbar || !target || !nativeTabs) {
        throw new Error(
          "Firefox tab toolbar markup is incompatible (TabsToolbar, customization target, or tabbrowser-tabs missing)"
        );
      }
      if (nativeTabs.getAttribute("orient") === "vertical") {
        throw new Error("Firefox vertical tabs are enabled; HostTabs requires the horizontal top TabsToolbar");
      }
      return { toolbar, target, nativeTabs };
    }

    getAllTabs() {
      return Array.from(this.gBrowser.tabs || []);
    }

    getTabId(tab) {
      if (!this.tabIds.has(tab)) {
        this.tabIds.set(tab, `hosttabs-tab-${this.nextTabId++}`);
      }
      return this.tabIds.get(tab);
    }

    getTabURL(tab) {
      try {
        return tab.linkedBrowser?.currentURI?.spec || "about:blank";
      } catch (error) {
        this.log.debug("Could not read a tab URL", error);
        return "about:blank";
      }
    }

    getTabTitle(tab) {
      return tab.label || tab.getAttribute?.("label") || this.getTabURL(tab) || "Untitled";
    }

    getTabFavicon(tab) {
      return tab.image || tab.getAttribute?.("image") || "";
    }

    getTabPosition(tab) {
      return Number.isInteger(tab._tPos) ? tab._tPos : this.getAllTabs().indexOf(tab);
    }

    getTabLastAccessed(tab) {
      try {
        const timestamp = Number(tab.lastAccessed);
        return Number.isFinite(timestamp) ? timestamp : 0;
      } catch (error) {
        this.log.debug("Could not read when a tab was last accessed", error);
        return 0;
      }
    }

    getContainerInfo(tab) {
      const rawId = tab.getAttribute?.("usercontextid");
      const userContextId = Number.parseInt(rawId || "0", 10);
      if (!userContextId) {
        return null;
      }
      try {
        const identity = this.contextualIdentityService?.getPublicIdentityFromId(userContextId);
        if (identity) {
          return {
            id: userContextId,
            name: identity.name || `Container ${userContextId}`,
            color: identity.color || "",
            icon: identity.icon || "",
          };
        }
      } catch (error) {
        this.log.debug("Could not resolve a container identity", error);
      }
      return { id: userContextId, name: `Container ${userContextId}`, color: "", icon: "" };
    }

    toRecord(tab) {
      return {
        id: this.getTabId(tab),
        tab,
        url: this.getTabURL(tab),
        title: this.getTabTitle(tab),
        favicon: this.getTabFavicon(tab),
        position: this.getTabPosition(tab),
        lastAccessed: this.getTabLastAccessed(tab),
        active: tab === this.gBrowser.selectedTab,
        pinned: Boolean(tab.pinned || tab.hasAttribute?.("pinned")),
        muted: Boolean(tab.muted || tab.hasAttribute?.("muted")),
        audible: Boolean(tab.soundPlaying || tab.hasAttribute?.("soundplaying")),
        multiselected: Boolean(tab.multiselected || tab.hasAttribute?.("multiselected")),
        container: this.getContainerInfo(tab),
      };
    }

    activateTab(tab) {
      this.gBrowser.selectedTab = tab;
    }

    closeTab(tab) {
      this.gBrowser.removeTab(tab, { animate: true, byMouse: true });
    }

    newTab() {
      if (typeof this.win.BrowserCommands?.openTab === "function") {
        this.win.BrowserCommands.openTab();
        return;
      }
      if (typeof this.win.goDoCommand === "function") {
        this.win.goDoCommand("cmd_newNavigatorTabNoEvent");
        return;
      }
      throw new Error("Firefox new-tab command is unavailable");
    }

    openURLInNewTab(url, sourceTab) {
      const options = {
        inBackground: false,
        relatedToCurrent: true,
      };
      const userContextId = Number.parseInt(
        sourceTab?.getAttribute?.("usercontextid") || "0",
        10
      );
      if (userContextId) {
        options.userContextId = userContextId;
      }

      if (typeof this.gBrowser.addTrustedTab === "function") {
        const tab = this.gBrowser.addTrustedTab(url, options);
        this.gBrowser.selectedTab = tab;
        return;
      }
      if (typeof this.win.openTrustedLinkIn === "function") {
        this.win.openTrustedLinkIn(url, "tab", options);
        return;
      }
      throw new Error("Firefox trusted new-tab navigation is unavailable");
    }

    reloadTab(tab) {
      this.gBrowser.reloadTab(tab);
    }

    toggleMute(tab) {
      if (typeof tab.toggleMuteAudio === "function") {
        tab.toggleMuteAudio();
        return;
      }
      throw new Error("Firefox tab audio API is unavailable");
    }

    togglePin(tab) {
      if (tab.pinned) {
        this.gBrowser.unpinTab(tab);
      } else {
        this.gBrowser.pinTab(tab);
      }
    }

    duplicateTab(tab) {
      if (typeof this.win.duplicateTabIn === "function") {
        this.win.duplicateTabIn(tab, "tab");
        return;
      }
      throw new Error("Firefox duplicate-tab API is unavailable");
    }

    moveTabToNewWindow(tab) {
      if (typeof this.gBrowser.replaceTabsWithWindow === "function") {
        this.gBrowser.replaceTabsWithWindow(tab);
        return;
      }
      throw new Error("Firefox Move Tab to New Window API is unavailable");
    }

    moveTabBefore(tab, targetTab) {
      if (tab === targetTab || typeof this.gBrowser.moveTabTo !== "function") {
        return;
      }
      this.gBrowser.moveTabTo(tab, this.getTabPosition(targetTab));
    }

    toggleMultiSelection(tab) {
      if (
        typeof this.gBrowser.addToMultiSelectedTabs !== "function" ||
        typeof this.gBrowser.removeFromMultiSelectedTabs !== "function"
      ) {
        return false;
      }
      if (tab.multiselected) {
        this.gBrowser.removeFromMultiSelectedTabs(tab);
      } else {
        this.gBrowser.addToMultiSelectedTabs(tab);
      }
      return true;
    }

    openNativeTabContextMenu(tab, row, event) {
      const menu = this.doc.getElementById("tabContextMenu");
      if (!menu || typeof menu.openPopupAtScreen !== "function" || !this.win.TabContextMenu) {
        return false;
      }

      // Firefox 153's TabContextMenu.updateContextMenu reads
      // popup.triggerNode.tab before falling back to the selected tab. Passing
      // the original contextmenu event makes its target the trigger node.
      row.tab = tab;
      if (event.target && typeof event.target === "object") {
        event.target.tab = tab;
      }
      const rect = row.getBoundingClientRect();
      const screenX = event.screenX || this.win.mozInnerScreenX + rect.left + 16;
      const screenY = event.screenY || this.win.mozInnerScreenY + rect.top + 16;
      try {
        menu.openPopupAtScreen(screenX, screenY, true, event);
        return true;
      } catch (error) {
        this.log.warn("Native tab context menu could not be opened", error);
        return false;
      }
    }

    listenForTabChanges(callback) {
      const tabContainer = this.gBrowser.tabContainer;
      const events = [
        "TabOpen",
        "TabClose",
        "TabSelect",
        "TabMove",
        "TabPinned",
        "TabUnpinned",
        "TabAttrModified",
        "SSTabRestored",
        "TabBrowserInserted",
      ];
      const onEvent = event => callback(event.type);
      for (const eventName of events) {
        tabContainer.addEventListener(eventName, onEvent);
      }

      const progressListener = {
        onLocationChange: () => callback("LocationChange"),
      };
      try {
        this.gBrowser.addTabsProgressListener(progressListener);
      } catch (error) {
        for (const eventName of events) {
          tabContainer.removeEventListener(eventName, onEvent);
        }
        throw error;
      }

      return () => {
        for (const eventName of events) {
          tabContainer.removeEventListener(eventName, onEvent);
        }
        try {
          this.gBrowser.removeTabsProgressListener(progressListener);
        } catch (error) {
          this.log.debug("Tabs progress listener was already removed", error);
        }
      };
    }
  }

  root.HostTabs.FirefoxAdapter = FirefoxAdapter;
})(globalThis);
