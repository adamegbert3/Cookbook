# Cookbook TODO

Running list — add to it anytime, I'll check it each session. Move items to
"Done" as they're tested and merged.

## In progress / needs your test
- [ ] **List view bug**: rows render unstyled (white background, no card look) — investigating.
- [ ] **Guest mode + QR recipe cards** (`guest-mode-and-recipe-cards` branch) — iframe print rewrite, needs your test.
- [ ] **Grid/List toggle + homepage grid width fix + cache-busting** (`recipe-list-view-toggle` branch) — grid confirmed good, list view broken (see above).

## Not started
- [ ] Kitchen Tools: add a "📇 Print Recipe Card" shortcut, visible to Adam only (reuses the existing `canUseTestMode`-style admin-only gating pattern).
- [ ] Guest mode: when a guest uses "Share this Recipe," offer the public `share.html` QR-card link instead of the normal internal recipe link (which needs login).
- [ ] Admin: a Comments Dashboard — see every comment across all recipes in one place, to spot what people are talking about.
- [ ] Homepage declutter:
  - Shrink "Pick up where you left off" to fit its content instead of a big fixed box.
  - Live, scrollable search results as you type (Google-suggestions style) instead of a full-screen search overlay that hides everything.
  - Hide browse-only widgets (category pills, favorites, Testing Kitchen, Test Mode, Download Offline) while a search is active.
- [ ] Bottom navigation bar (mobile-app style): house icon (center, → homepage), + (add recipe), profile picture (→ profile), etc. Intended to replace/reduce a lot of the homepage button clutter.
- [ ] Settings: customizable widget placement — choose whether things like Download All Recipes Offline, Test Mode, and the Weekly Menu show on the homepage or the profile page (per-user preference).
- [ ] Shopping list redesign: multiple named lists (grocery, storage, etc.) in an Apple-Reminders-style swipeable/columned view. Biggest item — needs its own scoping pass before starting.

## Cancelled
- [x] ~~Liquid Glass header + wallpaper picker~~ — not visible/not working as wanted, branch deleted per your call.

## Housekeeping
- [ ] Once features above are tested and confirmed good, merge their branches into `main` and delete them so we're not juggling a pile of branches.
