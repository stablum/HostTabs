(function (root) {
  "use strict";

  root.HostTabs = root.HostTabs || {};
  const HTML_NS = "http://www.w3.org/1999/xhtml";

  function html(doc, name, className = "") {
    const element = doc.createElementNS(HTML_NS, name);
    if (className) {
      element.className = className;
    }
    return element;
  }

  class HostTabsController {
    constructor(win, cssText, logger, onDestroy) {
      this.win = win;
      this.doc = win.document;
      this.cssText = cssText;
      this.log = logger;
      this.onDestroy = onDestroy;
      this.adapter = new root.HostTabs.FirefoxAdapter(win, logger);
      this.groupButtons = new Map();
      this.groups = [];
      this.openGroup = null;
      this.openingButton = null;
      this.renderFrame = 0;
      this.destroyed = false;
      this.draggedTab = null;
      this.removeTabListeners = null;
      this.boundOutsidePointer = event => this.onOutsidePointer(event);
      this.boundEscape = event => this.onWindowKeyDown(event);
      this.boundUnload = () => this.destroy("window unload");
      this.boundResize = () => this.positionPanel();
      this.boundFullscreen = () => this.closePanel();
    }

    init() {
      try {
        const compatible = this.adapter.assertCompatible();
        this.toolbar = compatible.toolbar;
        this.target = compatible.target;
        this.nativeTabs = compatible.nativeTabs;
        this.installStyle();
        this.buildToolbar();
        this.buildPanel();
        this.installListeners();

        // Enumerating and rendering successfully is part of the fail-open
        // transaction. Native tabs are hidden only after all of this succeeds.
        this.render();
        this.root.dataset.ready = "true";
        this.doc.documentElement.classList.add("hosttabs-active");
        this.log.info(`Initialized with ${this.adapter.getAllTabs().length} real tabs`);
        return this;
      } catch (error) {
        this.log.error("Initialization failed; keeping Firefox's native tabs visible", error);
        this.destroy("failed initialization");
        throw error;
      }
    }

    installStyle() {
      if (!this.cssText || typeof this.cssText !== "string") {
        throw new Error("HostTabs stylesheet did not load");
      }
      this.style = html(this.doc, "style");
      this.style.id = "hosttabs-style";
      this.style.textContent = this.cssText;
      this.doc.head.appendChild(this.style);
    }

    buildToolbar() {
      this.root = html(this.doc, "div", "hosttabs-root");
      this.root.id = "hosttabs-root";
      this.root.setAttribute("role", "toolbar");
      this.root.setAttribute("aria-label", "Open tabs grouped by hostname");

      this.strip = html(this.doc, "div", "hosttabs-strip");
      this.strip.setAttribute("role", "group");
      this.strip.setAttribute("aria-label", "Hostname groups");
      this.strip.addEventListener("wheel", event => this.onStripWheel(event), {
        passive: false,
      });

      this.newTabButton = html(this.doc, "button", "hosttabs-new-tab");
      this.newTabButton.type = "button";
      this.newTabButton.textContent = "+";
      this.newTabButton.title = "Open a new tab";
      this.newTabButton.setAttribute("aria-label", "Open a new tab");
      this.newTabButton.addEventListener("click", () => this.adapter.newTab());

      this.root.append(this.strip, this.newTabButton);
      this.target.insertBefore(this.root, this.nativeTabs);
    }

    buildPanel() {
      this.panel = html(this.doc, "section", "hosttabs-panel");
      this.panel.id = "hosttabs-panel";
      this.panel.hidden = true;
      this.panel.setAttribute("role", "dialog");
      this.panel.setAttribute("aria-modal", "false");

      const header = html(this.doc, "header", "hosttabs-panel-header");
      this.panelTitle = html(this.doc, "strong", "hosttabs-panel-title");
      this.panelClose = html(this.doc, "button", "hosttabs-panel-close");
      this.panelClose.type = "button";
      this.panelClose.textContent = "×";
      this.panelClose.title = "Close page list";
      this.panelClose.setAttribute("aria-label", "Close page list");
      this.panelClose.addEventListener("click", () => this.closePanel(true));
      header.append(this.panelTitle, this.panelClose);

      this.pageList = html(this.doc, "div", "hosttabs-page-list");
      this.pageList.setAttribute("role", "listbox");
      this.panel.append(header, this.pageList);
      this.doc.body.appendChild(this.panel);

      this.fallbackMenu = html(this.doc, "div", "hosttabs-fallback-menu");
      this.fallbackMenu.hidden = true;
      this.fallbackMenu.setAttribute("role", "menu");
      this.doc.body.appendChild(this.fallbackMenu);
    }

    installListeners() {
      this.removeTabListeners = this.adapter.listenForTabChanges(reason =>
        this.scheduleRender(reason)
      );
      this.win.addEventListener("mousedown", this.boundOutsidePointer, true);
      this.win.addEventListener("keydown", this.boundEscape, true);
      this.win.addEventListener("resize", this.boundResize);
      this.win.addEventListener("fullscreen", this.boundFullscreen);
      this.win.addEventListener("unload", this.boundUnload, { once: true });
    }

    scheduleRender(reason) {
      if (this.destroyed || this.renderFrame) {
        return;
      }
      this.log.debug(`Scheduling render after ${reason}`);
      this.renderFrame = this.win.requestAnimationFrame(() => {
        this.renderFrame = 0;
        try {
          this.render();
        } catch (error) {
          // A runtime incompatibility must also fail open. Leaving a broken
          // projection active after an update is not acceptable.
          this.log.error("Render failed; tearing down to restore native tabs", error);
          this.destroy("render failure");
        }
      });
    }

    render() {
      const records = this.adapter.getAllTabs().map(tab => this.adapter.toRecord(tab));
      this.groups = root.HostTabs.buildGroups(records);
      this.renderGroupButtons();

      if (this.openGroup) {
        const stillPresent = this.groups.some(group => group.label === this.openGroup);
        if (stillPresent) {
          this.renderOpenGroup();
        } else {
          this.closePanel();
        }
      }

      const activeGroup = this.groups.find(group => group.active);
      if (activeGroup) {
        this.win.requestAnimationFrame(() => {
          this.groupButtons.get(activeGroup.label)?.scrollIntoView({
            block: "nearest",
            inline: "nearest",
          });
        });
      }
    }

    renderGroupButtons() {
      const labels = new Set(this.groups.map(group => group.label));
      for (const [label, button] of this.groupButtons) {
        if (!labels.has(label)) {
          button.remove();
          this.groupButtons.delete(label);
        }
      }

      for (const group of this.groups) {
        let button = this.groupButtons.get(group.label);
        if (!button) {
          button = this.createGroupButton(group.label);
          this.groupButtons.set(group.label, button);
        }
        this.updateGroupButton(button, group);
        this.strip.appendChild(button);
      }
    }

    createGroupButton(label) {
      const button = html(this.doc, "button", "hosttabs-group");
      button.type = "button";
      button.dataset.group = label;
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "hosttabs-panel");

      const icon = html(this.doc, "img", "hosttabs-group-icon");
      icon.alt = "";
      icon.setAttribute("role", "presentation");
      icon.addEventListener("error", () => (icon.hidden = true));
      const name = html(this.doc, "span", "hosttabs-group-name");
      const count = html(this.doc, "span", "hosttabs-group-count");
      count.setAttribute("aria-hidden", "true");
      button.append(icon, name, count);
      button._hosttabs = { icon, name, count };

      button.addEventListener("click", () => this.togglePanel(label, button));
      button.addEventListener("auxclick", event => {
        if (event.button === 1) {
          event.preventDefault();
        }
      });
      button.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          this.closePanel(true);
        }
      });
      return button;
    }

    updateGroupButton(button, group) {
      const count = group.tabs.length;
      button._hosttabs.name.textContent = group.label;
      button._hosttabs.count.textContent = String(count);
      button.title = group.label;
      button.setAttribute(
        "aria-label",
        `${group.label}, ${count} open ${count === 1 ? "tab" : "tabs"}`
      );
      button.setAttribute("aria-expanded", String(this.openGroup === group.label));
      button.classList.toggle("is-active", group.active);

      const icon = button._hosttabs.icon;
      if (group.favicon) {
        if (icon.src !== group.favicon) {
          icon.src = group.favicon;
        }
        icon.hidden = false;
      } else {
        icon.removeAttribute("src");
        icon.hidden = true;
      }
    }

    togglePanel(label, button) {
      if (this.openGroup === label && !this.panel.hidden) {
        this.closePanel(true);
        return;
      }
      this.openGroup = label;
      this.openingButton = button;
      this.renderGroupButtons();
      this.renderOpenGroup();
      this.panel.hidden = false;
      this.panel.setAttribute("aria-label", `${label} open tabs`);
      this.positionPanel();
      this.win.requestAnimationFrame(() => {
        this.positionPanel();
        const active = this.pageList.querySelector(".hosttabs-page-row.is-active");
        (active || this.pageList.querySelector(".hosttabs-page-row"))?.focus();
        active?.scrollIntoView({ block: "nearest" });
      });
    }

    renderOpenGroup() {
      const group = this.groups.find(candidate => candidate.label === this.openGroup);
      if (!group) {
        this.closePanel();
        return;
      }
      this.panelTitle.textContent = `${group.label} · ${group.tabs.length}`;
      this.pageList.replaceChildren();
      for (const record of group.tabs) {
        this.pageList.appendChild(this.createPageRow(record));
      }
      this.positionPanel();
    }

    createPageRow(record) {
      const row = html(this.doc, "div", "hosttabs-page-row");
      row.tab = record.tab;
      row.dataset.tabId = record.id;
      row.tabIndex = 0;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(record.active || record.multiselected));
      row.setAttribute("aria-label", record.title);
      row.classList.toggle("is-active", record.active);
      row.classList.toggle("is-multiselected", record.multiselected);
      row.draggable = true;

      const icon = html(this.doc, "img", "hosttabs-page-icon");
      icon.alt = "";
      icon.setAttribute("role", "presentation");
      if (record.favicon) {
        icon.src = record.favicon;
      } else {
        icon.hidden = true;
      }
      icon.addEventListener("error", () => (icon.hidden = true));

      const text = html(this.doc, "div", "hosttabs-page-text");
      const title = html(this.doc, "div", "hosttabs-page-title");
      title.textContent = record.title;
      const secondary = html(this.doc, "div", "hosttabs-page-secondary");
      secondary.textContent = root.HostTabs.getSecondaryText(record.url);
      secondary.title = record.url;
      text.append(title, secondary);

      const status = html(this.doc, "div", "hosttabs-page-status");
      if (record.container) {
        const marker = html(this.doc, "span", "hosttabs-container-marker");
        marker.title = record.container.name;
        marker.setAttribute("aria-label", record.container.name);
        if (record.container.color) {
          marker.classList.add(`identity-color-${record.container.color}`);
        }
        status.appendChild(marker);
      }
      if (record.pinned) {
        const pinned = html(this.doc, "img", "hosttabs-pin");
        pinned.src = "chrome://browser/skin/pin.svg";
        pinned.alt = "";
        pinned.title = "Pinned tab";
        pinned.setAttribute("aria-label", "Pinned tab");
        status.appendChild(pinned);
      }
      if (record.muted || record.audible) {
        const audio = html(this.doc, "button", "hosttabs-audio");
        audio.type = "button";
        audio.textContent = record.muted ? "⊘" : "♪";
        audio.title = record.muted ? "Unmute tab" : "Mute tab";
        audio.setAttribute("aria-label", audio.title);
        audio.addEventListener("click", event => {
          event.stopPropagation();
          this.adapter.toggleMute(record.tab);
        });
        status.appendChild(audio);
      }

      const close = html(this.doc, "button", "hosttabs-page-close");
      close.type = "button";
      close.textContent = "×";
      close.title = `Close ${record.title}`;
      close.setAttribute("aria-label", close.title);
      close.addEventListener("click", event => {
        event.stopPropagation();
        this.adapter.closeTab(record.tab);
      });

      row.append(icon, text, status, close);
      row.addEventListener("click", event => {
        if (event.ctrlKey || event.metaKey) {
          if (this.adapter.toggleMultiSelection(record.tab)) {
            event.preventDefault();
            this.scheduleRender("multi-selection");
          }
          return;
        }
        this.adapter.activateTab(record.tab);
        this.closePanel();
      });
      row.addEventListener("auxclick", event => {
        if (event.button === 1) {
          event.preventDefault();
          this.adapter.closeTab(record.tab);
        }
      });
      row.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.adapter.openNativeTabContextMenu(record.tab, row, event)) {
          this.openFallbackMenu(record, event);
        }
      });
      row.addEventListener("keydown", event => this.onRowKeyDown(event, record));
      row.addEventListener("dragstart", event => {
        this.draggedTab = record.tab;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "hosttabs-tab");
      });
      row.addEventListener("dragover", event => {
        if (this.draggedTab) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      });
      row.addEventListener("drop", event => {
        event.preventDefault();
        if (this.draggedTab) {
          this.adapter.moveTabBefore(this.draggedTab, record.tab);
        }
        this.draggedTab = null;
      });
      row.addEventListener("dragend", () => (this.draggedTab = null));
      return row;
    }

    onRowKeyDown(event, record) {
      if (event.target !== event.currentTarget) {
        return;
      }
      const rows = Array.from(this.pageList.querySelectorAll(".hosttabs-page-row"));
      const index = rows.indexOf(event.currentTarget);
      let target = null;
      switch (event.key) {
        case "ArrowDown":
          target = rows[Math.min(rows.length - 1, index + 1)];
          break;
        case "ArrowUp":
          target = rows[Math.max(0, index - 1)];
          break;
        case "Home":
          target = rows[0];
          break;
        case "End":
          target = rows.at(-1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          this.adapter.activateTab(record.tab);
          this.closePanel();
          return;
        case "Delete":
          event.preventDefault();
          this.adapter.closeTab(record.tab);
          return;
        case "Escape":
          event.preventDefault();
          this.closePanel(true);
          return;
        default:
          return;
      }
      if (target) {
        event.preventDefault();
        target.focus();
        target.scrollIntoView({ block: "nearest" });
      }
    }

    openFallbackMenu(record, event) {
      this.fallbackMenu.replaceChildren();
      const actions = [
        ["Reload Tab", () => this.adapter.reloadTab(record.tab)],
        [record.muted ? "Unmute Tab" : "Mute Tab", () => this.adapter.toggleMute(record.tab)],
        [record.pinned ? "Unpin Tab" : "Pin Tab", () => this.adapter.togglePin(record.tab)],
        ["Duplicate Tab", () => this.adapter.duplicateTab(record.tab)],
        ["Move Tab to New Window", () => this.adapter.moveTabToNewWindow(record.tab)],
        ["Close Tab", () => this.adapter.closeTab(record.tab)],
      ];
      for (const [label, action] of actions) {
        const button = html(this.doc, "button", "hosttabs-fallback-action");
        button.type = "button";
        button.textContent = label;
        button.setAttribute("role", "menuitem");
        button.addEventListener("click", () => {
          this.fallbackMenu.hidden = true;
          try {
            action();
          } catch (error) {
            this.log.error(`Fallback action failed: ${label}`, error);
          }
        });
        this.fallbackMenu.appendChild(button);
      }
      this.fallbackMenu.hidden = false;
      const width = 260;
      this.fallbackMenu.style.left = `${Math.max(8, Math.min(event.clientX, this.win.innerWidth - width - 8))}px`;
      this.fallbackMenu.style.top = `${Math.max(8, Math.min(event.clientY, this.win.innerHeight - 260))}px`;
      this.fallbackMenu.querySelector("button")?.focus();
    }

    positionPanel() {
      if (!this.panel || this.panel.hidden || !this.openingButton?.isConnected) {
        return;
      }
      const anchor = this.openingButton.getBoundingClientRect();
      const margin = 10;
      const width = Math.min(560, Math.max(320, this.win.innerWidth - margin * 2));
      const left = Math.max(
        margin,
        Math.min(anchor.left, this.win.innerWidth - width - margin)
      );
      const top = Math.min(anchor.bottom + 2, this.win.innerHeight - 80);
      this.panel.style.width = `${width}px`;
      this.panel.style.left = `${left}px`;
      this.panel.style.top = `${top}px`;
      this.panel.style.maxHeight = `${Math.max(120, this.win.innerHeight - top - margin)}px`;
    }

    closePanel(returnFocus = false) {
      if (!this.panel) {
        return;
      }
      const button = this.openingButton;
      this.panel.hidden = true;
      this.fallbackMenu.hidden = true;
      this.openGroup = null;
      this.openingButton = null;
      for (const groupButton of this.groupButtons.values()) {
        groupButton.setAttribute("aria-expanded", "false");
      }
      if (returnFocus) {
        button?.focus();
      }
    }

    onOutsidePointer(event) {
      if (!this.fallbackMenu.hidden && !this.fallbackMenu.contains(event.target)) {
        this.fallbackMenu.hidden = true;
      }
      if (
        !this.panel.hidden &&
        !this.panel.contains(event.target) &&
        !this.root.contains(event.target)
      ) {
        this.closePanel();
      }
    }

    onWindowKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }
      if (!this.fallbackMenu.hidden) {
        this.fallbackMenu.hidden = true;
        event.preventDefault();
      } else if (!this.panel.hidden) {
        this.closePanel(true);
        event.preventDefault();
      }
    }

    onStripWheel(event) {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        this.strip.scrollLeft += event.deltaY;
        event.preventDefault();
      }
    }

    destroy(reason = "requested") {
      if (this.destroyed) {
        return;
      }
      this.destroyed = true;
      // Removing this class first is the fail-open switch.
      this.doc.documentElement.classList.remove("hosttabs-active");
      if (this.renderFrame) {
        this.win.cancelAnimationFrame(this.renderFrame);
        this.renderFrame = 0;
      }
      try {
        this.removeTabListeners?.();
      } catch (error) {
        this.log.debug("Tab listener cleanup failed", error);
      }
      this.win.removeEventListener("mousedown", this.boundOutsidePointer, true);
      this.win.removeEventListener("keydown", this.boundEscape, true);
      this.win.removeEventListener("resize", this.boundResize);
      this.win.removeEventListener("fullscreen", this.boundFullscreen);
      this.win.removeEventListener("unload", this.boundUnload);
      this.panel?.remove();
      this.fallbackMenu?.remove();
      this.root?.remove();
      this.style?.remove();
      this.groupButtons.clear();
      this.groups = [];
      this.log.info(`Destroyed (${reason}); Firefox native tabs restored`);
      this.onDestroy?.(this);
    }
  }

  root.HostTabs.HostTabsController = HostTabsController;
})(globalThis);
