(function (root) {
  "use strict";

  root.HostTabs = root.HostTabs || {};
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const TITLE_GRAPHEME_SEGMENTER =
    typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  const MEANINGFUL_TITLE_GRAPHEME =
    /[\p{L}\p{N}\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}]/u;

  function html(doc, name, className = "") {
    const element = doc.createElementNS(HTML_NS, name);
    if (className) {
      element.className = className;
    }
    return element;
  }

  function splitTitleGraphemes(value) {
    if (TITLE_GRAPHEME_SEGMENTER) {
      return Array.from(
        TITLE_GRAPHEME_SEGMENTER.segment(value),
        entry => entry.segment
      );
    }
    return Array.from(value);
  }

  function truncateTitleToFit(value, fits) {
    const title = typeof value === "string" ? value : String(value || "");
    if (!title || fits(title)) {
      return title;
    }

    const graphemes = splitTitleGraphemes(title);
    const candidateAt = length => {
      const prefixGraphemes = graphemes.slice(0, length);
      while (
        prefixGraphemes.length &&
        !MEANINGFUL_TITLE_GRAPHEME.test(prefixGraphemes.at(-1))
      ) {
        prefixGraphemes.pop();
      }
      const prefix = prefixGraphemes.join("");
      const omitted = graphemes.length - prefixGraphemes.length;
      if (!prefix) {
        return omitted > 1 ? "." : "";
      }
      // Replacing one final grapheme with a period is not a useful visual
      // abbreviation: it occupies a character slot without exposing more of
      // the title. Reserve the marker for genuinely shortened prefixes.
      return omitted > 1 ? `${prefix}.` : prefix;
    };
    let best = graphemes.length > 1 && fits(".") ? "." : "";
    let low = 0;
    let high = graphemes.length;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = candidateAt(middle);
      if (fits(candidate)) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return best;
  }

  function allocateGroupWidths(naturalWidths, minimumWidths, availableWidth) {
    const count = Math.min(naturalWidths.length, minimumWidths.length);
    if (!count) {
      return [];
    }

    const minimums = [];
    const naturals = [];
    for (let index = 0; index < count; index += 1) {
      const minimum = Math.max(0, Number(minimumWidths[index]) || 0);
      minimums.push(minimum);
      naturals.push(Math.max(minimum, Number(naturalWidths[index]) || 0));
    }

    const width = Math.max(0, Number(availableWidth) || 0);
    const minimumTotal = minimums.reduce((total, value) => total + value, 0);
    const naturalTotal = naturals.reduce((total, value) => total + value, 0);
    if (width <= minimumTotal) {
      return minimums;
    }
    if (width >= naturalTotal) {
      return naturals;
    }

    // Give every group the same extra title allowance above its own
    // control-aware minimum. A group whose full title needs less space leaves
    // its unused share for the remaining groups.
    const allocations = minimums.slice();
    let remaining = width - minimumTotal;
    let flexible = naturals
      .map((natural, index) => ({ index, capacity: natural - minimums[index] }))
      .filter(item => item.capacity > 0);

    while (remaining > 0.01 && flexible.length) {
      const share = remaining / flexible.length;
      const saturated = flexible.filter(item => item.capacity <= share + 0.01);
      if (!saturated.length) {
        for (const item of flexible) {
          allocations[item.index] += share;
        }
        remaining = 0;
        break;
      }

      const saturatedIndexes = new Set(saturated.map(item => item.index));
      for (const item of saturated) {
        allocations[item.index] += item.capacity;
        remaining -= item.capacity;
      }
      flexible = flexible.filter(item => !saturatedIndexes.has(item.index));
    }

    return allocations;
  }

  function buildGroupTabOrder(groups, draggedLabel, targetLabel, placeAfter) {
    const draggedIndex = groups.findIndex(group => group.label === draggedLabel);
    const targetIndex = groups.findIndex(group => group.label === targetLabel);
    if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
      return null;
    }

    const reorderedGroups = groups.slice();
    const [draggedGroup] = reorderedGroups.splice(draggedIndex, 1);
    const adjustedTargetIndex = reorderedGroups.findIndex(
      group => group.label === targetLabel
    );
    reorderedGroups.splice(
      adjustedTargetIndex + (placeAfter ? 1 : 0),
      0,
      draggedGroup
    );
    return reorderedGroups.flatMap(group =>
      group.tabs.map(record => record.tab).filter(Boolean)
    );
  }

  root.HostTabs.truncateTitleToFit = truncateTitleToFit;
  root.HostTabs.allocateGroupWidths = allocateGroupWidths;
  root.HostTabs.buildGroupTabOrder = buildGroupTabOrder;

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
      this.panelPersistent = false;
      this.closeLockLabel = null;
      this.renderFrame = 0;
      this.destroyed = false;
      this.draggedTab = null;
      this.draggedGroupLabel = null;
      this.groupDropTarget = null;
      this.removeTabListeners = null;
      this.boundOutsidePointer = event => this.onOutsidePointer(event);
      this.boundEscape = event => this.onWindowKeyDown(event);
      this.boundUnload = () => this.destroy("window unload");
      this.boundResize = () => {
        this.positionPanel();
        this.fitGroupTitles();
      };
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
      this.panel.addEventListener("pointerleave", event =>
        this.onHoverRegionLeave(this.openGroup, event.relatedTarget)
      );
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
      this.win.requestAnimationFrame(() => {
        if (this.destroyed) {
          return;
        }
        this.fitGroupTitles();
        if (activeGroup) {
          this.groupButtons.get(activeGroup.label)?.scrollIntoView({
            block: "nearest",
            inline: "nearest",
          });
        }
      });
    }

    renderGroupButtons() {
      const labels = new Set(this.groups.map(group => group.label));
      if (this.closeLockLabel && !labels.has(this.closeLockLabel)) {
        this.closeLockLabel = null;
      }
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
        if (!button.isConnected) {
          this.strip.appendChild(button);
        }
      }

      // Keep the close target under the pointer during a repeated-close run.
      // Native-order sorting resumes as soon as that close button is left.
      if (!this.closeLockLabel) {
        for (const group of this.groups) {
          this.strip.appendChild(this.groupButtons.get(group.label));
        }
      }
    }

    createGroupButton(label) {
      const group = html(this.doc, "div", "hosttabs-group");
      group.dataset.group = label;
      group.setAttribute("role", "group");

      const icon = html(this.doc, "img", "hosttabs-group-icon");
      icon.alt = "";
      icon.setAttribute("role", "presentation");
      icon.addEventListener("error", () => {
        icon.hidden = true;
        group.classList.remove("has-icon");
        this.win.requestAnimationFrame(() => {
          if (!this.destroyed) {
            this.fitGroupTitles();
          }
        });
      });
      const name = html(this.doc, "span", "hosttabs-group-name");
      const main = html(this.doc, "button", "hosttabs-group-main");
      main.type = "button";
      main.draggable = true;
      main.setAttribute("aria-haspopup", "dialog");
      main.setAttribute("aria-controls", "hosttabs-panel");
      main.append(icon, name);

      const count = html(this.doc, "button", "hosttabs-group-count");
      count.type = "button";
      count.setAttribute("aria-haspopup", "dialog");
      count.setAttribute("aria-controls", "hosttabs-panel");
      const countValue = html(this.doc, "span", "hosttabs-group-count-value");
      count.appendChild(countValue);

      const home = html(this.doc, "button", "hosttabs-group-home");
      home.type = "button";
      const homeIcon = this.doc.createElementNS(SVG_NS, "svg");
      homeIcon.classList.add("hosttabs-group-home-icon");
      homeIcon.setAttribute("viewBox", "0 0 16 16");
      homeIcon.setAttribute("aria-hidden", "true");
      homeIcon.setAttribute("focusable", "false");
      const homePath = this.doc.createElementNS(SVG_NS, "path");
      homePath.setAttribute("d", "M8 1.4 1.5 6.8V14h4V9.5h5V14h4V6.8L8 1.4Z");
      homeIcon.appendChild(homePath);
      home.appendChild(homeIcon);

      const close = html(this.doc, "button", "hosttabs-group-close");
      close.type = "button";
      close.textContent = "×";

      group.append(main, home, count, close);
      group._hosttabs = { main, icon, name, home, count, countValue, close };

      group.addEventListener("pointerleave", event =>
        this.onHoverRegionLeave(label, event.relatedTarget)
      );
      group.addEventListener("contextmenu", event =>
        this.openGroupContextMenu(label, group, event)
      );
      group.addEventListener("dragstart", event =>
        this.onGroupDragStart(event, label, group)
      );
      group.addEventListener("dragover", event =>
        this.onGroupDragOver(event, label, group)
      );
      group.addEventListener("dragleave", event =>
        this.onGroupDragLeave(event, label, group)
      );
      group.addEventListener("drop", event =>
        this.onGroupDrop(event, label, group)
      );
      group.addEventListener("dragend", () => this.onGroupDragEnd());

      main.addEventListener("click", () => this.activateGroup(label, main));
      main.addEventListener("auxclick", event => {
        if (event.button === 1) {
          event.preventDefault();
        }
      });
      home.addEventListener("click", () => this.openGroupHomepage(label));
      count.addEventListener("pointerenter", () => this.openHoverPanel(label, count));
      count.addEventListener("click", () => this.togglePanel(label, count));
      count.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          this.closePanel(true);
        }
      });
      close.addEventListener("click", () => this.closeGroupPage(label));
      close.addEventListener("pointerleave", () => this.releaseCloseLock(label));
      close.addEventListener("blur", () => {
        if (!close.matches(":hover")) {
          this.releaseCloseLock(label);
        }
      });
      return group;
    }

    onGroupDragStart(event, label, button) {
      if (
        event.target?.closest?.(
          ".hosttabs-group-home, .hosttabs-group-count, .hosttabs-group-close"
        )
      ) {
        event.preventDefault();
        return;
      }
      this.closePanel();
      if (!event.dataTransfer) {
        event.preventDefault();
        return;
      }
      this.draggedGroupLabel = label;
      button.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `hosttabs-group:${label}`);
    }

    onGroupDragOver(event, label, button) {
      if (!this.draggedGroupLabel || this.draggedGroupLabel === label) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      const rect = button.getBoundingClientRect();
      const placeAfter = event.clientX >= rect.left + rect.width / 2;
      this.clearGroupDropIndicators();
      button.classList.add(placeAfter ? "drop-after" : "drop-before");
      this.groupDropTarget = { label, placeAfter };
    }

    onGroupDragLeave(event, label, button) {
      if (event.relatedTarget && button.contains(event.relatedTarget)) {
        return;
      }
      button.classList.remove("drop-before", "drop-after");
      if (this.groupDropTarget?.label === label) {
        this.groupDropTarget = null;
      }
    }

    onGroupDrop(event, label, button) {
      if (!this.draggedGroupLabel || this.draggedGroupLabel === label) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const target = this.groupDropTarget;
      const rect = button.getBoundingClientRect();
      const placeAfter =
        target?.label === label
          ? target.placeAfter
          : event.clientX >= rect.left + rect.width / 2;
      const orderedTabs = buildGroupTabOrder(
        this.groups,
        this.draggedGroupLabel,
        label,
        placeAfter
      );
      this.onGroupDragEnd();
      if (orderedTabs) {
        this.adapter.reorderTabs(orderedTabs);
      }
    }

    onGroupDragEnd() {
      this.draggedGroupLabel = null;
      this.groupDropTarget = null;
      this.clearGroupDropIndicators();
      for (const button of this.groupButtons.values()) {
        button.classList.remove("is-dragging");
      }
    }

    clearGroupDropIndicators() {
      for (const button of this.groupButtons.values()) {
        button.classList.remove("drop-before", "drop-after");
      }
    }

    async openGroupContextMenu(label, button, event) {
      event.preventDefault();
      event.stopPropagation();
      const group = this.groups.find(candidate => candidate.label === label);
      const record = group?.lastAccessedTab || group?.tabs[0];
      if (!record) {
        return;
      }

      this.closePanel();
      if (!(await this.adapter.openNativeTabContextMenu(record.tab, button, event))) {
        this.openFallbackMenu(record, event);
      }
    }

    activateGroup(label, button) {
      const group = this.groups.find(candidate => candidate.label === label);
      if (group?.active) {
        this.togglePanel(label, button);
        return;
      }
      const record = group?.lastAccessedTab || group?.tabs[0];
      if (record && !record.active) {
        this.adapter.activateTab(record.tab);
      }
      this.closePanel();
    }

    openGroupHomepage(label) {
      const group = this.groups.find(candidate => candidate.label === label);
      const source = group?.lastAccessedTab || group?.tabs[0];
      const homepageURL = root.HostTabs.getHomepageURL(source?.url);
      if (!homepageURL) {
        return;
      }
      this.closePanel();
      this.adapter.openURLInNewTab(homepageURL, source.tab);
    }

    closeGroupPage(label) {
      const group = this.groups.find(candidate => candidate.label === label);
      const { target, next } = root.HostTabs.getGroupClosePlan(group);
      if (!target) {
        return;
      }
      if (this.closeLockLabel && this.closeLockLabel !== label) {
        this.groupButtons.get(this.closeLockLabel)?.style.removeProperty("width");
      }
      this.closeLockLabel = label;
      const groupButton = this.groupButtons.get(label);
      const lockedWidth = groupButton?.getBoundingClientRect().width;
      if (lockedWidth) {
        groupButton.style.width = `${lockedWidth}px`;
      }
      if (target.active && next) {
        this.adapter.activateTab(next.tab);
      }
      this.adapter.closeTab(target.tab);
    }

    releaseCloseLock(label) {
      if (this.closeLockLabel !== label) {
        return;
      }
      this.groupButtons.get(label)?.style.removeProperty("width");
      this.closeLockLabel = null;
      this.scheduleRender("hostname close pointer left");
    }

    updateGroupButton(button, group) {
      const count = group.tabs.length;
      const pageTitle = group.lastAccessedTab?.title || group.label;
      const homepageURL = root.HostTabs.getHomepageURL(group.lastAccessedTab?.url);
      if (button._hosttabs.name.dataset.fullTitle !== pageTitle) {
        button._hosttabs.name.dataset.fullTitle = pageTitle;
        button._hosttabs.name.textContent = pageTitle;
      }
      button._hosttabs.countValue.textContent = String(count);
      button._hosttabs.count.hidden = count === 1;
      button.classList.toggle("has-count", count > 1);
      button.setAttribute("aria-label", group.label);
      button._hosttabs.main.title = `${pageTitle} — ${group.label}`;
      button._hosttabs.main.setAttribute(
        "aria-label",
        group.active
          ? `${group.label}, ${pageTitle}, show open tabs`
          : `${group.label}, ${pageTitle}, open the last accessed page`
      );
      button._hosttabs.home.hidden = !homepageURL;
      button.classList.toggle("has-home", Boolean(homepageURL));
      button._hosttabs.home.title = homepageURL
        ? `Open ${homepageURL} in a new tab`
        : "";
      button._hosttabs.home.setAttribute(
        "aria-label",
        homepageURL ? `${group.label}, open homepage in a new tab` : ""
      );
      button._hosttabs.count.title = `Show ${count} open ${count === 1 ? "tab" : "tabs"}`;
      button._hosttabs.count.setAttribute(
        "aria-label",
        `${group.label}, show ${count} open ${count === 1 ? "tab" : "tabs"}`
      );
      button._hosttabs.count.setAttribute(
        "aria-expanded",
        String(this.openGroup === group.label)
      );
      button._hosttabs.main.setAttribute(
        "aria-expanded",
        String(this.openGroup === group.label)
      );
      button._hosttabs.close.title = group.active
        ? `Close the current ${group.label} page`
        : `Close the last accessed ${group.label} page`;
      button._hosttabs.close.setAttribute("aria-label", button._hosttabs.close.title);
      button.classList.toggle("is-active", group.active);

      const icon = button._hosttabs.icon;
      const favicon = group.lastAccessedTab?.favicon || group.favicon;
      button.classList.toggle("has-icon", Boolean(favicon));
      if (favicon) {
        if (icon.src !== favicon) {
          icon.src = favicon;
        }
        icon.hidden = false;
      } else {
        icon.removeAttribute("src");
        icon.hidden = true;
      }
    }

    fitGroupTitles() {
      const buttons = Array.from(this.groupButtons.values()).filter(
        button => button.isConnected
      );
      this.strip.style.removeProperty("flex");
      for (const button of buttons) {
        button.style.flex = "0 0 auto";
        const name = button._hosttabs.name;
        name.textContent = name.dataset.fullTitle || "";
      }

      // Measure the natural widths without allowing flexbox to favor groups
      // with longer titles. The strip itself can still shrink beside the +
      // button, which gives us the exact space available for all groups.
      const allocatedStripWidth = this.strip.getBoundingClientRect().width;
      const naturalWidths = buttons.map(
        button => button.getBoundingClientRect().width
      );
      const stripStyle = this.win.getComputedStyle(this.strip);
      const gap = Number.parseFloat(stripStyle.columnGap || stripStyle.gap) || 0;
      for (const button of buttons) {
        button.style.flex = "0 0 0px";
      }
      const minimumWidths = buttons.map(
        button => button.getBoundingClientRect().width
      );
      const groupSpace = Math.max(
        0,
        allocatedStripWidth - gap * Math.max(0, buttons.length - 1)
      );
      const allocatedWidths = allocateGroupWidths(
        naturalWidths,
        minimumWidths,
        groupSpace
      );

      // Lock the fair allocations before shortening the visible strings so
      // title fitting cannot feed back into group or strip sizing.
      this.strip.style.flex = `0 0 ${allocatedStripWidth}px`;
      buttons.forEach((button, index) => {
        button.style.flex = `0 0 ${allocatedWidths[index]}px`;
      });

      for (const button of buttons) {
        const name = button._hosttabs.name;
        const fullTitle = name.dataset.fullTitle || "";
        if (!name.clientWidth) {
          continue;
        }
        const fits = text => {
          name.textContent = text;
          return name.scrollWidth <= name.clientWidth;
        };
        name.textContent = truncateTitleToFit(fullTitle, fits);
      }
    }

    togglePanel(label, button) {
      if (this.openGroup === label && !this.panel.hidden) {
        if (this.panelPersistent) {
          this.closePanel(true);
        } else {
          // Clicking a panel that hover already opened promotes it to the
          // existing persistent click behavior instead of toggling it closed.
          this.panelPersistent = true;
          this.openingButton = button;
          this.schedulePanelLayout(true);
        }
        return;
      }
      this.openPanel(label, button, true, true);
    }

    openHoverPanel(label, button) {
      if (this.panelPersistent) {
        return;
      }
      if (this.openGroup === label && !this.panel.hidden) {
        return;
      }
      this.openPanel(label, button, false, false);
    }

    openPanel(label, button, persistent, moveFocus) {
      this.openGroup = label;
      this.openingButton = button;
      this.panelPersistent = persistent;
      this.renderGroupButtons();
      this.renderOpenGroup();
      this.panel.hidden = false;
      this.panel.setAttribute("aria-label", `${label} open tabs`);
      this.positionPanel();
      this.schedulePanelLayout(moveFocus);
    }

    schedulePanelLayout(moveFocus) {
      this.win.requestAnimationFrame(() => {
        if (this.panel.hidden) {
          return;
        }
        this.positionPanel();
        if (moveFocus) {
          const active = this.pageList.querySelector(".hosttabs-page-row.is-active");
          (active || this.pageList.querySelector(".hosttabs-page-row"))?.focus();
          active?.scrollIntoView({ block: "nearest" });
        }
      });
    }

    onHoverRegionLeave(label, relatedTarget) {
      if (
        this.panelPersistent ||
        !label ||
        this.openGroup !== label ||
        this.panel.hidden
      ) {
        return;
      }
      const groupButton = this.groupButtons.get(label);
      if (
        this.panel.contains(relatedTarget) ||
        groupButton?.contains(relatedTarget)
      ) {
        return;
      }
      this.closePanel();
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
      row.addEventListener("contextmenu", async event => {
        event.preventDefault();
        event.stopPropagation();
        if (!(await this.adapter.openNativeTabContextMenu(record.tab, row, event))) {
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
      // Touch the anchor so a pointer can enter a transient hover panel without
      // crossing pixels that belong to neither the host tab nor the panel.
      const top = Math.min(anchor.bottom, this.win.innerHeight - 80);
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
      this.panelPersistent = false;
      for (const groupButton of this.groupButtons.values()) {
        groupButton._hosttabs.count.setAttribute("aria-expanded", "false");
        groupButton._hosttabs.main.setAttribute("aria-expanded", "false");
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
      this.closeLockLabel = null;
      this.panelPersistent = false;
      this.draggedGroupLabel = null;
      this.groupDropTarget = null;
      this.log.info(`Destroyed (${reason}); Firefox native tabs restored`);
      this.onDestroy?.(this);
    }
  }

  root.HostTabs.HostTabsController = HostTabsController;
})(globalThis);
