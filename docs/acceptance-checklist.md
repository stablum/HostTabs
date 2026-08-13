# Acceptance checklist

Legend: **automated** means exercised by repository tests; **source-verified**
means checked against the exact installed Firefox 153.0.4 source; **needs live
smoke test** means Firefox must be restarted with HostTabs installed and a
person must exercise browser chrome.

## Automated and statically verified

- [x] Exact-host URL grouping, subdomain separation, localhost/IP, New Tab,
  other `about:`, file, data, blob, extension, view-source, Reader View, unknown,
  and malformed inputs.
- [x] Group and page ordering derives only from native tab positions.
- [x] All shipped JavaScript passes Node syntax checking.
- [x] All PowerShell files pass the PowerShell parser.
- [x] Installer `-WhatIf` detects Firefox 153.0.4 and the correct current profile
  without writing anything.
- [x] Diagnostic script detects the same installation/profile and reports the
  expected pre-install missing state.
- [x] Install, update, diagnostics, missing-file repair, and uninstall complete
  against isolated temporary Firefox/profile directories; uninstall leaves no
  recorded HostTabs file behind.
- [x] The isolated installer test refuses a foreign AutoConfig without writing
  HostTabs bootstrap files.
- [x] Native-strip CSS is conditional on `:root.hosttabs-active`.
- [x] Every controller error path removes that activation class first.
- [x] AutoConfig files use LF and `.env`/`AGENTS.md` are ignored.

## Source-verified against Firefox 153.0.4

- [x] HostTabs is inserted beside, not in place of, preserved titlebar/caption
  elements.
- [x] Per-window delayed-startup observer topic and `gBrowser` model.
- [x] Tab lifecycle/attribute/progress events used by reconciliation.
- [x] Real tab activation, close, position, pin, audio, multi-select, and move
  APIs are present.
- [x] `#tabContextMenu` derives `contextTab` from `triggerNode.tab` and retains
  the native Move Tab / Move to New Window commands.

## Needs a live Firefox restart smoke test

- [ ] Restored session renders and the native strip disappears only after the
  custom strip appears.
- [ ] Window drag, double-click maximize, caption controls, restored/maximized
  layouts, and F11 fullscreen behave normally.
- [ ] Host buttons, long-title page panel, outside/Escape close, and panel
  clamping look correct under the active Firefox theme and Windows scaling.
- [ ] Ctrl+T/W/Shift+T/N/Shift+N/Tab/PageUp/PageDown, Alt+Left/Right, Ctrl+L,
  F6, and F11 remain native.
- [ ] Dynamic navigation migrates a row between hosts, including while its
  panel is open.
- [ ] Two windows stay independent while receiving/moving tabs.
- [ ] Native context menu opens from a custom row and its full set of commands,
  extension contributions, containers, and multi-selection work.
- [ ] Pinned, audible/muted, container, lazy-restored, and hundreds-of-tabs
  scenarios render acceptably.
- [ ] Deliberately breaking a required source file causes fail-open behavior.
- [ ] Install, repair after an update, and uninstall are exercised on a test
  profile before relying on them for the main profile.

The repository does not claim the live items above were tested during its
creation. They require modifying an installed Firefox and restarting it.
