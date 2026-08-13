# HostTabs

HostTabs replaces Firefox's horizontal page-title strip with a compact
hostname → pages projection in the normal top tab area. The underlying objects
remain real Firefox tabs.

```text
[ (r) Third page title  ⌂ 3 × ] [ (g) HostTabs  ⌂ × ] [ + ]
                │ count (hidden when it is 1)
              └─ www.reddit.com
                 ├─ Why Firefox extensions can no longer…   /r/firefox/…
                 ├─ Mozilla discussion concerning…          /r/programming/…
                 └─ Third page title                         /comments/…
```

The exact hostname remains the grouping key and panel heading; the compact bar
uses the site's favicon and the most recently accessed page title.

Version 0.1.7 targets and was source-verified against the Firefox installed on
the development machine: desktop Firefox 153.0.4 on Windows 11.

## What it does

- groups HTTP(S) tabs by exact hostname (`www.reddit.com` and
  `old.reddit.com` stay separate);
- puts compact site-favicon and last-page-title controls in `TabsToolbar`;
- activates the most recently accessed page when an inactive hostname title is
  clicked, without opening a menu;
- toggles the vertical page list from the count, or from the title when that
  hostname is already active;
- hides the page counter for single-page groups and places a home button before
  it that opens the hostname root in a new tab;
- provides a stable hostname close button that closes the current page, or the
  most recently accessed page in an inactive group, then promotes the previous
  visit for repeated cleanup clicks;
- derives all order and state from each window's own real `gBrowser.tabs`;
- migrates a row automatically when its real tab navigates to another host;
- preserves Firefox shortcuts, session restore, history, pinned state,
  containers, audio state, and native window ownership;
- reuses Firefox's actual tab context menu, including Move Tab and Move to New
  Window, with an explicit smaller fallback if that internal hook breaks;
- supports horizontal host scrolling, vertically scrolling page lists,
  keyboard navigation, middle-click close, Ctrl+click real multi-selection,
  audio toggling, and same-window real-tab reorder by dragging a row.

Special buckets include `New Tab`, `about:`, `file:`, `data:`, `blob:`, and
`Extensions`. Reader View and `view-source:` are associated with the nested
website when possible.

## Architecture and safety

```text
Firefox real tabs (one gBrowser per window)
        ↓
FirefoxAdapter — isolated internal APIs and native operations
        ↓
pure URL/model projection
        ↓
HostTabs controller in the existing top TabsToolbar
```

A WebExtension is intentionally not involved. Public extension APIs cannot
replace Firefox's top tab-strip presentation, while a privileged AutoConfig
startup script can operate directly on real browser-chrome tabs without an IPC
bridge or substitute session model.

HostTabs fails open. It does not hide `TabsToolbar`, window spacers, Firefox
View, All Tabs, or caption controls. CSS hides only the native tab presentation,
and only while `document.documentElement` has `hosttabs-active`. A controller
adds that class after it finds compatible markup, inserts the UI, enumerates
tabs, installs listeners, and completes its first render. Initialization or
later render failure calls `destroy()`, whose first action restores native tabs.

The projection is event-driven and animation-frame-coalesced; it uses no
polling, content scripts, page-DOM inspection, or persistent tab database.

## Installation

Close Firefox first, then run PowerShell from the repository root:

```powershell
pwsh -File .\scripts\install.ps1
```

The installer detects running Firefox processes, registry App Paths, PATH,
Scoop, and standard Mozilla directories. It prints the executable and version.
It parses Mozilla's profile configuration and selects a single profile only
when it can identify an obvious current match. Otherwise it stops and lists
choices:

```powershell
pwsh -File .\scripts\install.ps1 `
  -FirefoxPath 'C:\path\to\firefox.exe' `
  -ProfilePath 'C:\path\to\profile'
```

Preview without writing:

```powershell
pwsh -File .\scripts\install.ps1 -WhatIf
```

Fully exit and restart Firefox after installation. Merely opening another
window in the already-running Firefox process is not enough to load a new
AutoConfig file.

### Installed files

Firefox installation directory:

```text
<Firefox>\defaults\pref\hosttabs-autoconfig.js
<Firefox>\hosttabs.cfg
```

Selected Firefox profile:

```text
<profile>\chrome\hosttabs\bootstrap.js
<profile>\chrome\hosttabs\url-groups.js
<profile>\chrome\hosttabs\model.js
<profile>\chrome\hosttabs\firefox-adapter.js
<profile>\chrome\hosttabs\hosttabs.uc.js
<profile>\chrome\hosttabs\hosttabs.css
<profile>\chrome\hosttabs\install-manifest.json
```

Updates may also create timestamped files under
`<profile>\chrome\hosttabs-install-backups`. The manifest records every created
or modified file and backup.

AutoConfig has a single configuration filename. If the installer finds another
loader or a well-known `.cfg`, it refuses to overwrite or guess how to compose
it and prints exact manual integration steps. Dedicated HostTabs files are
backed up before updates. No `userChrome.css` is replaced.

AutoConfig UI access requires `general.config.sandbox_enabled=false`. Treat the
two installation files and all profile HostTabs sources as trusted local code.
HostTabs changes no unrelated Firefox security preference.

## Uninstallation

```powershell
pwsh -File .\scripts\uninstall.ps1
```

If necessary, pass the same `-FirefoxPath` and `-ProfilePath`. Uninstall reads
the manifest, removes only recorded HostTabs-created files, restores any
recorded shared-file backups newest-to-oldest, removes only empty directories,
and leaves other chrome customizations, extensions, preferences, history,
bookmarks, and profiles untouched. Fully exit and restart Firefox afterward.

## Diagnostics and repair

```powershell
pwsh -File .\scripts\diagnose.ps1
pwsh -File .\scripts\repair.ps1
```

Diagnostics are local-only. The report includes Firefox path/version, selected
profile, both AutoConfig pieces, profile source/CSS, debug preference, conflicts,
manifest, and recorded install version. It uploads nothing.

Firefox/Scoop updates can replace installation-directory files. `repair.ps1`
checks and safely reinstalls missing dedicated bootstrap/profile files, while
preserving the manifest and backups. It does not patch Firefox internals.

## Debugging and development

After restarting Firefox, press **Ctrl+Shift+J** to open the Browser Console and
filter for `[HostTabs]`. In that privileged console:

```js
HostTabsDev.enableVerbose(true)  // persists hosttabs.debug = true
HostTabsDev.destroy()            // immediately restores native tabs
HostTabsDev.reinitialize()       // rebuilds this window's controller
```

Disable verbose logging with `HostTabsDev.enableVerbose(false)`. Source and
AutoConfig changes generally require a full Firefox restart. Use an explicit
temporary/test profile for risky development; the loader runs only in a profile
containing `chrome/hosttabs/bootstrap.js`.

Run repository checks with no dependency install:

```powershell
npm test
npm run check
npm run test:installer  # isolated temporary install/update/repair/uninstall
```

## Firefox updates and current limitations

Browser-chrome JavaScript is not a stable public extension API. The adapter
isolates current dependencies (`gBrowser`, `_tPos`, tab events, toolbar/menu
IDs, multi-select/audio/move methods, and native context-menu trigger behavior),
but a future Firefox update can require maintenance. See
[`docs/firefox-internals.md`](docs/firefox-internals.md) for the exact installed
revision and findings, and run diagnostics/repair after upgrades.

Version 0.1.7 limitations:

- it intentionally fails open when Firefox's built-in vertical-tabs mode is
  active; disable vertical tabs to use the requested top-toolbar interface;
- Ctrl+click real multi-selection is implemented; Shift range-selection is not;
- custom drag-and-drop reorders within the current window. Cross-window and
  drag-out behavior use Firefox's native context menu rather than imitating its
  fragile drag protocol;
- if native context-menu invocation breaks, the fallback includes reload,
  mute, pin, duplicate, close, and Move Tab to New Window, but not every native
  extension-contributed or move-to-existing-window item;
- automated logic/static/tooling checks were run, but browser-chrome behavior
  was not claimed as live-tested without installing and restarting Firefox.

The manual smoke-test status is explicit in
[`docs/acceptance-checklist.md`](docs/acceptance-checklist.md).

## Privacy

HostTabs makes no network requests, includes no telemetry or remote code, does
not inject into websites, and stores no browsing history. Only the live set of
open real tabs exists in runtime memory. The sole optional persisted setting is
the local `hosttabs.debug` preference.
