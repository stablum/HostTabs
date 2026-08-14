# HostTabs

HostTabs replaces Firefox's horizontal page-title strip with a compact
hostname → pages projection in the normal top tab area. The underlying objects
remain real Firefox tabs.

```text
[ favicon | last page title | Home | 3 | × ] [ favicon | only page title | Home | × ] [ + ]
                                   │
                                   └─ page list for that exact hostname
```

The exact hostname remains the grouping key and panel heading; the compact bar
uses the site's favicon and the most recently accessed page title. The page
count is omitted when only one page is open, and a truncated compact title uses
a single period instead of a wide ellipsis. Spaces and punctuation immediately
before that period are removed.

Version 0.1.10 targets and was source-verified against the Firefox installed on
the development machine: desktop Firefox 153.0.4 on Windows 11.

## Host-tab controls

Each web-host tab is arranged as:

```text
[ favicon + last-accessed page title ] [ Home ] [ page count ] [ × ]
```

| Control | Behavior |
| --- | --- |
| Favicon and title | For an inactive host, activates its most recently accessed page without opening the list. For the active host, toggles its page list. |
| Home | Opens the last-accessed page's origin root (for example, `https://example.com/`) in a selected new tab. The scheme, non-default port, and Firefox container are preserved. It is omitted from special non-web groups. |
| Page count | Hover to show a transient page list; it closes as soon as the pointer leaves both the host tab and list. Click to keep the list open until explicitly dismissed. Clicking the counter while its hover list is open makes the list persistent. The count is omitted when the group contains one page. |
| `×` | Closes the current page in the active host, or the last-accessed page in an inactive host. Repeated clicks keep the button in place and work backward through recent pages. |
| `+` | Opens Firefox's standard New Tab page. It stays immediately after the host tabs while the host strip scrolls independently when crowded. |

The page list shows each real tab's title and path plus its favicon, container,
pin, and audio state where applicable. In the list:

- click or press **Enter**/**Space** to activate a page;
- press **Arrow Up/Down**, **Home**, or **End** to move focus;
- click `×`, middle-click a row, or press **Delete** to close a page;
- Ctrl+click a row to toggle Firefox's real multi-selection;
- right-click a row for Firefox's native tab context menu;
- drag a row onto another row to reorder the underlying tabs;
- press **Escape**, click the panel close button, or click outside to dismiss it.

## Behavior and compatibility

- groups HTTP(S) tabs by exact hostname (`www.reddit.com` and
  `old.reddit.com` stay separate);
- places the host controls in Firefox's normal `TabsToolbar` without removing
  Firefox View, All Tabs, title-bar spacers, or window controls;
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

Version 0.1.10 limitations:

- it intentionally fails open when Firefox's built-in vertical-tabs mode is
  active; disable vertical tabs to use the requested top-toolbar interface;
- Ctrl+click real multi-selection is implemented; Shift range-selection is not;
- custom drag-and-drop reorders within the current window. Cross-window and
  drag-out behavior use Firefox's native context menu rather than imitating its
  fragile drag protocol;
- if native context-menu invocation breaks, the fallback includes reload,
  mute, pin, duplicate, close, and Move Tab to New Window, but not every native
  extension-contributed or move-to-existing-window item;
- focused live Firefox probes cover host grouping, control placement, the
  adjacent `+` button, overflow scrolling, singleton-count hiding,
  hover-versus-click panel behavior, and Home navigation. The broader manual
  GUI scenarios listed below remain unchecked.

The manual smoke-test status is explicit in
[`docs/acceptance-checklist.md`](docs/acceptance-checklist.md).

## Privacy

HostTabs makes no background network requests, includes no telemetry or remote
code, and does not inject into websites. The Home button only asks Firefox to
perform the navigation you clicked; normal Firefox networking and history then
apply. HostTabs itself stores no browsing history. Only the live set of open
real tabs exists in runtime memory, and the sole optional persisted setting is
the local `hosttabs.debug` preference.
