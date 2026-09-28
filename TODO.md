# Cookbook TODO

Running list — add to it anytime, I'll check it each session. Move items to
"Done" as they're tested and merged.

## In progress / needs your test
- [ ] **Grid/List toggle** (`recipe-list-view-toggle` branch) — grid confirmed good, list view was rendering unstyled rows; needs a fresh look/retest.
- [ ] **Public cards v2** (`public-cards-v2` branch) — self-serve 48h public cards for any member, admin approval for extensions, card size picker, admin "Public Cards" page, and the on-page ingredient-review modal (replacing the old `prompt()` popups). Ready for your test now that Firestore rules are live.

## Not started
- [ ] Recipe page: show "cooked X times, by [names]" on each recipe (fun/social, not just admin-only stats) ONLY FOR ADMINS.
- [ ] Admin Activity page: "unidentified cooks" in Family Dishes Served are currently just missing/dropped. Don't lose the record of what was made — group unmatched cook records under an "Anonymous" bucket at the bottom of the list instead of hiding them.
- [ ] Guest mode: when a guest uses "Share this Recipe," offer the public `share.html` QR-card link instead of the normal internal recipe link (which needs login).
- [ ] Settings: customizable widget placement — choose whether Download All Recipes Offline and Test Mode show on the homepage or the profile page (per-user preference). (Weekly Menu no longer applies here — it got its own page instead, see Done below.)
- [ ] Shopping list redesign: multiple named lists (grocery, storage, etc.) in an Apple-Reminders-style swipeable/columned view. Biggest item — needs its own scoping pass before starting.

## Done (needs your test / not yet merged)
- [x] Admin Comments Dashboard — see every comment across all recipes in one place (`admin/comments.html`).
- [x] "Pick up where you left off" now actually tracks your last 5 viewed recipes and collapses to nothing when empty, instead of being a big static empty box.
- [x] Homepage declutter — search is now a live, non-blocking bar docked under the header instead of a full-screen overlay, and browse-only widgets (announcements, tags stay visible, the add/swipe/offline row, Testing Kitchen, Test Mode, Download Offline, Weekly Menu, recently-viewed) hide themselves while a search term is active.
- [x] Bottom navigation bar (mobile-only, house/menu/+/profile) — added to homepage, recipe, profile, submit, swipe, offline-recipes, shopping-list, leaderboard, settings, suggestions, weekly-menu, and favorites pages.
- [x] Weekly Menu and Favorite Recipes moved off the homepage/profile onto their own dedicated pages (`weekly-menu.html`, `favorites.html`) — the Weekly Menu widget alone was a full screen on mobile. The bottom nav's Menu icon now pops a short list (Weekly Menu / continue your last recipe / Favorites) instead of a 4th full page.

## Done (merged to main)
- [x] Guest mode + printable QR recipe cards (`guest-mode-and-recipe-cards` branch) — merged to main, confirmed working live on yum4you.com.
- [x] Kitchen Tools: "📇 Print Recipe Card" shortcut, admin-only — merged as part of the above.
- [x] Add "Print Recipe Card" to the Share modal on the recipe page.

## Cancelled
- [x] ~~Liquid Glass header + wallpaper picker~~ — not visible/not working as wanted, branch deleted per your call.

## Housekeeping
- [ ] Once features above are tested and confirmed good, merge their branches into `main` and delete them so we're not juggling a pile of branches.
