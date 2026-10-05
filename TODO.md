# Cookbook TODO

Running list — add to it anytime, I'll check it each session. Move items to
"Done" as they're tested and merged.

## In progress / needs your test
- [ ] **Public cards v2** — self-serve 48h public cards, admin approval for extensions, card size picker, admin "Public Cards" page, and the ingredient-review modal. On `main`; still needs a full run-through on your phone and desktop.
- [ ] **Offline Recipes page** (`offline-downloads.html`) — choose favorites, all, or specific recipes; see Saved / Not saved / Changed; remove; "Update all changed". On `main`; needs a test with a real download and a recipe edit.
- [ ] **Session timeout** — signed out after 8 hours idle, and no bounce to sign-in while the session loads. On `main`; needs a check on your phone (signed in after 8+ hours, and admin → homepage).
- [ ] **Admin cook breakdown and Anonymous bucket** — admins see who cooked a recipe; unnamed cooks sit at the bottom of Activity, kept. On `main`; needs a check as admin.
- [ ] **Category tags and category buttons** — tags and homepage category buttons use soft pills in each category's color (light and dark theme), card badges have room above the tags, and hidden cards stay readable in dark theme. On `main`; needs a check in both themes.

## Not started
- [ ] Profile "Member since" shows the Firebase login creation date (Aug 3, 2026), which is wrong. Needs the real join date, then set it as `createdAt` on the user record.
- [ ] Tokens: earn tokens after cooking a recipe, spend them in the cookbook on things like plants and customizations. Stored in Firebase. Open decisions: how tokens are earned (per cook, per recipe per day, Test Mode?), what they buy and at what price, and whether admins can grant them. Needs decisions before building.
- [ ] Guest mode: when a guest uses "Share this Recipe," offer the public `share.html` QR-card link instead of the normal internal recipe link (which needs login).
- [ ] Shopping list redesign: multiple named lists (grocery, storage, etc.) in an Apple-Reminders-style swipeable/columned view. Biggest item — needs its own scoping pass before starting.

## Done (merged to main)
- [x] Grid/List view on the homepage (compact rows with name, author, category, offline, verified, family, and favorite info; phone-friendly), with a segmented toggle.
- [x] Weekly Menu now on the profile page by default and retitled "Meal Planner"; Settings lets people move it back to the homepage.
- [x] Bottom navigation (Home, Search, +, Menu, Profile) with profile initials; Menu popup with Weekly Menu, continue reading, and Favorites.
- [x] Homepage search is a live bar under the header, and browse widgets hide while searching.
- [x] "Pick up where you left off" tracks your last 5 recipes.
- [x] Settings: choose homepage or profile for "Download All for Offline" and Test Mode (admin).
- [x] Admin Comments dashboard (`admin/comments.html`).
- [x] Fixed: Edit recipe 404 from the master recipe list on the live site.
- [x] Fixed: ingredient scaling skips a "Label:" prefix, so "Filling: 2 cups jam" scales.
- [x] Fixed: homepage cards stretch to fill the row instead of leaving a gap.
- [x] Guest mode + printable QR recipe cards (`guest-mode-and-recipe-cards`) — confirmed working live on yum4you.com.
- [x] Kitchen Tools: "📇 Print Recipe Card" shortcut, admin-only.
- [x] Add "Print Recipe Card" to the Share modal on the recipe page.

## Cancelled
- [x] ~~Liquid Glass header + wallpaper picker~~ — not visible/not working as wanted, branch deleted per your call.

## Housekeeping
- [ ] Delete merged branches once you're happy with `main`.
