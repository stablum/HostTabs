# Firefox 153 integration notes

Research was performed on 2026-08-13 against the Firefox actually installed on
this Windows 11 machine:

- executable: `C:\Users\foo\scoop\apps\firefox\current\firefox.exe`
- product version: `153.0.4`
- build ID: `20260810162159`
- source repository: `https://hg.mozilla.org/releases/mozilla-release`
- source revision: `54be19de0e08edff0b797e55fd935dd3978b0a6d`
- selected active profile identified by matching `compatibility.ini`:
  `C:\Users\foo\AppData\Roaming\Mozilla\Firefox\Profiles\ml09cm58.default-release-1`
- existing AutoConfig: none (only Mozilla's `defaults/pref/channel-prefs.js`)

The implementation deliberately keeps all findings below behind
`firefox-adapter.js` or the AutoConfig bootstrap.

## Browser window and toolbar

The browser window document remains `chrome://browser/content/browser.xhtml`.
Its current toolbar include has this shape:

```text
TabsToolbar.browser-titlebar
├── titlebar-spacer[type=pre-tabs]
├── .toolbar-items
│   └── #TabsToolbar-customization-target
│       ├── #firefox-view-button
│       ├── #tabbrowser-tabs
│       ├── #new-tab-button
│       └── #alltabs-button
├── titlebar-spacer[type=post-tabs]
└── titlebar-buttonbox-container (from titlebar-items.inc.xhtml)
```

Source: [navigator-toolbox.inc.xhtml at the installed revision](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/base/content/navigator-toolbox.inc.xhtml#l24).

HostTabs inserts only its root immediately before `#tabbrowser-tabs`. It does
not hide `#TabsToolbar`, either titlebar spacer, Firefox View, All Tabs, or the
caption button container. Firefox's `.browser-titlebar` supplies
`-moz-window-dragging: drag`; HostTabs explicitly marks its interactive controls
`no-drag` and leaves its empty flex area draggable. Source:
[browser-shared.css](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/themes/shared/browser-shared.css#l338).

The custom `+` delegates to `BrowserCommands.openTab()`. Firefox 153 maps the
explicit no-event command `cmd_newNavigatorTabNoEvent` to that same method, so
HostTabs uses it as the compatibility fallback instead of the event-dependent
`cmd_newNavigatorTab`: [browser-sets.js](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/base/content/browser-sets.js).

Native-strip suppression is a stylesheet rule guarded by the runtime
`hosttabs-active` root class. The controller adds that class only after markup,
listeners, tab enumeration, and the initial render all succeed. `destroy()`
removes it before doing any other cleanup.

## Startup and per-window lifetime

Firefox 153 sets `gBrowserInit.delayedStartupFinished` and then notifies the
`browser-delayed-startup-finished` observer with the browser window as subject.
Source: [browser-init.js](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/base/content/browser-init.js#l790).

The AutoConfig-loaded bootstrap:

1. initializes already-open `navigator:browser` windows whose delayed startup
   has finished;
2. observes the same topic for future windows;
3. gives each window a separate controller and `gBrowser` projection;
4. ignores non-browser windows;
5. tears controllers down on window unload/application shutdown.

The installation-level `hosttabs.cfg` checks the current profile for
`chrome/hosttabs/bootstrap.js`, so profiles not selected during installation do
not run HostTabs.

Firefox 153 exposes `Services` directly in privileged globals and no longer
ships `resource://gre/modules/Services.sys.mjs`. Both bootstrap layers prefer
that global and retain the module import only as a compatibility fallback for
older Firefox releases.

The AutoConfig global also does not expose the page-global WHATWG `URL`
constructor. Runtime URL grouping therefore parses strings with
`Services.io.newURI`; the pure module retains the standard `URL` constructor as
a fallback for Node tests and non-Firefox environments.

## Real-tab model and events

Firefox documents one `gBrowser` per browser window. HostTabs reads
`gBrowser.tabs` and never creates a parallel browsing/session model. The
adapter uses `linkedBrowser.currentURI`, `tab.label`, `tab.image`, and `_tPos`
to build lightweight render records. Lazy restored tabs keep their cached
`currentURI` and tab attributes; HostTabs does not force them to load.

The installed tabbrowser dispatches `TabSelect`, `TabAttrModified`, `TabOpen`,
`TabClose`, and `TabMove` as bubbling custom events. Relevant installed-source
locations are [tabbrowser.js:1867](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/components/tabbrowser/content/tabbrowser.js#l1867),
[2161](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/components/tabbrowser/content/tabbrowser.js#l2161),
[4980](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/components/tabbrowser/content/tabbrowser.js#l4980),
[5924](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/components/tabbrowser/content/tabbrowser.js#l5924), and
[7402](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/components/tabbrowser/content/tabbrowser.js#l7402).
The controller also listens for pin/unpin, session restore, insertion, and uses
`addTabsProgressListener().onLocationChange` for immediate hostname migration.
Events are coalesced into one animation-frame reconciliation.

Firefox's tab element exposes `lastAccessed`, which is updated during native
tab selection and carries restored-session access information. HostTabs uses
that value to choose the real tab activated by an inactive hostname-title
click and to display that page's title/favicon. Clicking the active hostname
title toggles its page list instead; the count toggles the list and is hidden
for single-page groups. The currently selected tab wins if a timestamp is
unavailable. For HTTP(S) groups, the Home control derives the origin root from
that same tab and opens it through Firefox's trusted-tab API, preserving a
non-default port and the source tab's container.

The hostname close control closes that active tab, or the last-accessed tab for
an inactive hostname. When it closes the active tab, HostTabs explicitly
selects the next-most-recent tab in the same group immediately before Firefox's
native `removeTab` call. This prevents Firefox from transiently selecting—and
marking as recently accessed—a neighboring hostname. While the pointer stays
over the close control, the group keeps its toolbar position and width so
repeated clicks do not move the target; native-position ordering resumes when
the pointer leaves.

## Native tab context menu

The current menu is `#tabContextMenu` in
[main-popupset.inc.xhtml](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/base/content/main-popupset.inc.xhtml#l8).
Its `popupshowing` listener calls `TabContextMenu.updateContextMenu`:
[main-popupset.js](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/base/content/main-popupset.js#l597).

At the installed revision, `updateContextMenu` resolves its context with:

```js
let triggerTab =
  aPopupMenu.triggerNode &&
  (aPopupMenu.triggerNode.tab || aPopupMenu.triggerNode.closest("tab"));
this.contextTab = triggerTab || gBrowser.selectedTab;
this.contextTabs = this.contextTab.multiselected
  ? gBrowser.selectedTabs
  : [this.contextTab];
```

Source: [tabbrowser.js](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/components/tabbrowser/content/tabbrowser.js#l10192).

HostTabs assigns the real tab to the custom row and original event target's
`tab` property and calls
`openPopupAtScreen(..., true, originalContextMenuEvent)`. That preserves the
trigger node, native multi-selection, extension-contributed menu items, and
Firefox's current commands. In particular, `context_openTabInWindow` calls
`gBrowser.replaceTabsWithWindow(TabContextMenu.contextTab)` in the installed
source. The installed revision's
[XULPopupElement WebIDL](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/dom/chrome-webidl/XULPopupElement.webidl#l89)
defines that fourth argument as the trigger event and exposes the resulting
read-only `triggerNode`. If native opening is unavailable or throws, HostTabs exposes a small
fallback menu that explicitly includes **Move Tab to New Window**.

## Multi-selection and moving

Firefox 153 has `addToMultiSelectedTabs`, `removeFromMultiSelectedTabs`, and the
`selectedTabs` getter at
[tabbrowser.js:7701](https://hg.mozilla.org/releases/mozilla-release/file/54be19de0e08edff0b797e55fd935dd3978b0a6d/browser/components/tabbrowser/content/tabbrowser.js#l7701).
HostTabs maps Ctrl+click to those real APIs. It does not emulate selection.

Within one hostname panel, drag-to-row calls Firefox's `moveTabTo` to reorder
the real tab. Cross-window movement and detaching are intentionally delegated
to the native context menu; duplicating Firefox's internal drag data structures
would be substantially more fragile.

## AutoConfig

Mozilla's current enterprise documentation confirms that the preference file
belongs in `defaults/pref`, the named `.cfg` belongs at the installation root,
the preference loader must use LF line endings on Windows, and the `.cfg` first
line must be a comment: [Customize Firefox using AutoConfig](https://support.mozilla.org/en-US/kb/customizing-firefox-using-autoconfig).

HostTabs uses dedicated names (`hosttabs-autoconfig.js` and `hosttabs.cfg`). The
installer refuses to overwrite or automatically combine another
`general.config.filename` declaration or well-known `.cfg` file. Privileged UI
access requires `general.config.sandbox_enabled=false`; this is the only
security-sensitive preference changed and is why AutoConfig files must be
treated as trusted local code.

## Update-sensitive surface

The following are intentionally isolated but undocumented and must be checked
after a Firefox chrome refactor:

- element IDs and placement: `TabsToolbar`, `TabsToolbar-customization-target`,
  `tabbrowser-tabs`, `tabContextMenu`;
- `gBrowser`, `tabContainer`, `linkedBrowser.currentURI`, and `_tPos`;
- tab custom events and `addTabsProgressListener`;
- `TabContextMenu` trigger-node behavior and `openPopupAtScreen`;
- real-tab commands such as `removeTab`, `moveTabTo`,
  `replaceTabsWithWindow`, multi-selection, and `toggleMuteAudio`.

Missing core toolbar/tab APIs cause initialization to throw before activation,
leaving native tabs visible. Missing optional APIs disable only their feature
or use the documented fallback menu.
