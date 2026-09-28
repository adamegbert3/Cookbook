# Cookbook TODO

Running list — add to it anytime, I'll check it each session. Move items to
"Done" as they're tested and merged.

## In progress / needs your test
- [ ] **Grid/List toggle** (`recipe-list-view-toggle` branch) — grid confirmed good, list view was rendering unstyled rows; needs a fresh look/retest.
- [ ] **Public cards v2** (`public-cards-v2` branch) — self-serve 48h public cards for any member, admin approval for extensions, card size picker, admin "Public Cards" page, and the on-page ingredient-review modal (replacing the old `prompt()` popups). Ready for your test now that Firestore rules are live.

## Not started
- [ ] Guest mode: when a guest uses "Share this Recipe," offer the public `share.html` QR-card link instead of the normal internal recipe link (which needs login).
- [ ] Admin: a Comments Dashboard — see every comment across all recipes in one place, to spot what people are talking about.
- [ ] Homepage declutter:
  - Shrink "Pick up where you left off" to fit its content instead of a big fixed box.
  - Live, scrollable search results as you type (Google-suggestions style) instead of a full-screen search overlay that hides everything.
  - Hide browse-only widgets (category pills, favorites, Testing Kitchen, Test Mode, Download Offline) while a search is active.
- [ ] Bottom navigation bar (mobile-app style): house icon (center, → homepage), + (add recipe), profile picture (→ profile), etc. Intended to replace/reduce a lot of the homepage button clutter.
- [ ] Settings: customizable widget placement — choose whether things like Download All Recipes Offline, Test Mode, and the Weekly Menu show on the homepage or the profile page (per-user preference).
- [ ] Shopping list redesign: multiple named lists (grocery, storage, etc.) in an Apple-Reminders-style swipeable/columned view. Biggest item — needs its own scoping pass before starting.

## Done (merged to main)
- [x] Guest mode + printable QR recipe cards (`guest-mode-and-recipe-cards` branch) — merged to main, confirmed working live on yum4you.com.
- [x] Kitchen Tools: "📇 Print Recipe Card" shortcut, admin-only — merged as part of the above.
- [x] Add "Print Recipe Card" to the Share modal on the recipe page.

## Cancelled
- [x] ~~Liquid Glass header + wallpaper picker~~ — not visible/not working as wanted, branch deleted per your call.

## Housekeeping
- [ ] Once features above are tested and confirmed good, merge their branches into `main` and delete them so we're not juggling a pile of branches.
