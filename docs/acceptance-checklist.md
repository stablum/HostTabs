# Acceptance checklist

Legend: **automated** means exercised by repository tests; **source-verified**
means checked against Firefox 153.0.4 source; **needs live smoke test** means
Firefox must be restarted with HostTabs installed and a person must exercise
browser chrome. Focused isolated probes also run against installed Firefox
154.0.1.

## Automated and statically verified

- [x] Exact-host URL grouping, subdomain separation, localhost/IP, New Tab,
  other `about:`, file, data, blob, extension, view-source, Reader View, unknown,
  and malformed inputs.
- [x] Group and page ordering derives only from native tab positions.
- [x] Host-group drag planning moves all represented real tabs as one stable
  block, and the adapter applies the complete order through native `moveTabTo`.
- [x] Hostname close planning selects the active tab or the inactive group's
  last-accessed tab, then identifies the previous visit.
- [x] The new-tab adapter prefers `BrowserCommands.openTab()` and falls back to
  `cmd_newNavigatorTabNoEvent`.
- [x] Homepage derivation removes path/query/fragment and credentials, preserves
  HTTP(S) scheme and non-default ports, unwraps Reader View/view-source, and
  rejects special non-web buckets.
- [x] Homepage tabs use Firefox's trusted-tab API, open in the foreground, and
  preserve the source tab's container when present.
- [x] Counter hover opens a transient panel, click promotes it to persistent,
  persistent click still toggles closed, and transient pointer-leave handling
  distinguishes the host tab and panel from outside targets.
- [x] Compact-title truncation uses rendered DOM measurements, removes trailing
  spacing/punctuation from the fitting prefix, and does not replace one omitted
  final grapheme with a same-slot period.
- [x] Unicode title fitting preserves emoji prefixes and truncates only at
  grapheme boundaries, including joined and skin-tone-modified emoji sequences.
- [x] Host-tab context-menu targeting selects the group's last-accessed real tab
  and retains the existing fallback if Firefox's native popup cannot open.
- [x] Native context-menu invocation assigns the represented real tab to both
  the host/page anchor and original event target before opening the popup.
- [x] Native context-menu invocation runs Firefox's lazy localization
  initializer before opening and uses the existing fallback if it throws.
- [x] Host groups share title space evenly above their control-aware minimums,
  redistribute space unused by short titles, and retain stable allocated widths
  while their display titles are shortened.
- [x] Full titles may grow past the former 220 px ceiling into unused toolbar
  space before any title is shortened, while `+` remains directly adjacent.
- [x] Page-row icon, text, status, and close elements have fixed grid areas, so
  hiding a missing favicon cannot move the title into the narrow icon column.
- [x] All shipped JavaScript passes Node syntax checking.
- [x] All PowerShell files pass the PowerShell parser.
- [x] Installer `-WhatIf` detects Firefox 154.0.1 and the correct current profile
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
- [x] Firefox's current no-event new-tab command delegates to
  `BrowserCommands.openTab()`.
- [x] `#tabContextMenu` derives `contextTab` from `triggerNode.tab` and retains
  the native Move Tab / Move to New Window commands.

## Needs a live Firefox restart smoke test

Focused isolated Firefox 154.0.1 probes have verified exact-host rendering, an
adjacent new-tab button, spare-space title expansion, fair adaptive shrinking
before minimum-width overflow, Unicode emoji-prefix truncation, host-tab native
context-menu targeting, complete visible labels, and the built-in Undo Close
Tab entry,
singleton-count hiding, Home-before-count placement, foreground Home navigation
to the origin root, transient hover versus persistent click panel behavior, and
stable multi-page host-block movement by dragging a compact host title. A live
missing-favicon layout probe also verified that a 550 px row retains a 466 px
text column rather than collapsing it to the 20 px icon slot.
The remaining broader manual checks are:

- [ ] Restored session renders and the native strip disappears only after the
  custom strip appears.
- [ ] Window drag, double-click maximize, caption controls, restored/maximized
  layouts, and F11 fullscreen behave normally.
- [ ] Host title/Home/count/close controls, long-title page panel,
  outside/Escape close, and panel clamping look correct across Firefox themes
  and Windows scaling values.
- [ ] Ctrl+T/W/Shift+T/N/Shift+N/Tab/PageUp/PageDown, Alt+Left/Right, Ctrl+L,
  F6, and F11 remain native.
- [ ] Dynamic navigation migrates a row between hosts, including while its
  panel is open.
- [ ] Two windows stay independent while receiving/moving tabs.
- [ ] Native context-menu extension contributions, containers, multi-selection,
  and every command work from both a host tab and a custom row.
- [ ] Pinned, audible/muted, container, lazy-restored, and hundreds-of-tabs
  scenarios render acceptably.
- [ ] Deliberately breaking a required source file causes fail-open behavior.
- [ ] Install, repair after an update, and uninstall are exercised on a test
  profile before relying on them for the main profile.

These remaining items require broader manual interaction with an installed,
visible Firefox rather than focused automation in an isolated profile.
