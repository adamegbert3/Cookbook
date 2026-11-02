# Cookbook / Yum for You: Codex changes and rollback handoff

Prepared November 1, 2026, at the owner's request, for Adam and his Claude assistant.

## Owner's decision

The owner reports that the app is not working and explicitly requested: undo everything from this chat, including scanner, telemetry and My Kitchen; preserve the work on a branch and do not merge it back. This document records that work and the rollback plan. GitHub deployment history is the authority for whether deployment has finished.

- Repository: https://github.com/adamegbert3/Cookbook
- Live website: https://www.yum4you.com
- Baseline before this chat: `d474ae9` — Add an Air Fryer filter (by name or a manual tag).
- Last experimental deployment: `d9ba0686443d8e15fc5527ca9bb053980a436030`.
- Preserved branch: `archive/codex-scanner-kitchen-2026-11-01`.
- Live branch: `main`. Rollback uses a new commit, not a history rewrite. No PR/merge of the archive is authorized.
- The restored application should match the baseline except for these handoff documents and a new service-worker cache name to retire cached experimental assets.

## How the application is actually arranged

1. GitHub Pages serves static HTML/CSS/JavaScript from `main`. It does not run Ollama, Node, photo inference, or a hosted application server.
2. Browser JavaScript signs in through Firebase Authentication and reads/writes Cloud Firestore in project `cookbook-82676`. Restoring Git files does not by itself restore deployed Firestore rules. Rules require a separate authenticated Firebase deployment.
3. Recipes and users are stored in Firebase, not in the Git branch. The original weekly planner/shopping state lives under `users/{uid}` or `households/{id}`. The original planner is different from the experimental dated My Kitchen planner.
4. Local admin tools use `local-tools/scan-recipe/serve-locally.mjs`, a Node HTTP helper, normally at `http://localhost:8080`. The archived implementation proxies requests to Ollama at `http://127.0.0.1:11434`. The hosted GitHub site cannot supply that local helper.
5. A browser login on `https://www.yum4you.com` is separate from a login on `http://localhost:8080`. `localhost` and `127.0.0.1` are also different browser origins. Use the URL opened by the launcher consistently.
6. The downloadable Mac app is a launcher with bundled Node 22 and a snapshot of site files. It opens Ollama, starts its own loopback helper, checks for the vision model, and opens the local scanner/setup page. It is not a native replacement for Firebase or the website, and it has no automatic site update mechanism.

## Changes made during the chat (all requested to be removed from live code)

| Commit | Change |
| --- | --- |
| `022b847` | Ollama recipe scanner changes: same-origin helper proxy, `gemma3:4b` vision model check, JPEG normalization, output validation and clearer errors. |
| `d5c9e31` | Diagnostic events, Usage & Health UI, scanner/UI polish, Firestore diagnostic rules and deployment config. |
| `61fbd4b` | Adam-specific scanner announcement, guided Mac setup, page-load sample explanation. |
| `5647fb9` | One-click Mac launcher and helper lifecycle management. |
| `f513352` | AppleScript reopen-handler compilation fix. |
| `b23d8e9` | Downloadable Apple-silicon DMG with bundled Node/site/helper and in-page model download. |
| `9ee7676` | One-time macOS Privacy & Security approval instructions. |
| `d9ba068` | My Kitchen inventory, reviewed grocery-photo drafts, dated meals, stock allocation, shopping shortages, opt-in week previews; changed household access/invite flow. |

Apple notarization was explored but cancelled by the owner. The published installers were not Developer ID signed/notarized. A local ad-hoc signature is not Apple notarization. Do not restart certificate/notarization work without a new request.

## Archived scanner operation and troubleshooting

These details describe the preserved branch, NOT a promise that the baseline scanner has the same behavior.

- Launcher source: `local-tools/scan-recipe/mac-launcher.mjs` and `mac-launcher.applescript`.
- Bundle builder: `local-tools/scan-recipe/build-mac-download.sh`.
- Scanner client: `scripts/recipe-scan.js`; guide: `scanner-setup.html` and `scripts/scanner-setup.js`.
- Expected runtime: Apple silicon, macOS 14+, Ollama installed/open, model `gemma3:4b` downloaded and advertising vision capability. Adam's machine was described as probably M4; RAM and exact macOS version were not verified.
- Helper health: `http://127.0.0.1:8080/api/scanner-health` (archived helper only).
- Helper logs: `~/Library/Logs/Cookbook Scanner/helper.log`.
- Helper ownership/PID metadata: `~/Library/Application Support/Cookbook Scanner/helper.json`. Never kill a process solely because its PID appears in a stale file.
- Relevant failures to distinguish: Gatekeeper blocking launch; Ollama missing/not running; missing/incompatible vision model; port 8080 occupied; wrong URL or separate sign-in; stale bundled app; image decoding; model timeout/malformed output; Firestore permission failure.
- Do not disable macOS security globally or expose Ollama/the helper to the internet as a troubleshooting shortcut.

The exact cause of the user's current failure is NOT established. Get the exact failing URL, what was clicked, the error text, OS/architecture, installer version, and relevant console/helper error before assigning a cause. The tests below do not establish success on Adam's actual Mac.

## Archived telemetry

The new diagnostics used the `diagnostic_events` collection with a bounded vocabulary, browser/OS family, event timing/count and a session identifier. They did not store photo contents, recipe text or arbitrary error messages. Collection respected the local opt-out, Do Not Track, sign-in and offline checks. Existing older visit/cook analytics predate this chat and remain in the baseline.

The Usage & Health panel was `admin/usage.html`. Six diagnostic events were observed during the original setup, but there was no verified real Mac photo-scan success. An `expiresAt` field alone does not enable Firestore TTL deletion; do not assume TTL was enabled or promise no cost. The rollback removes the new collector and its rules; historical diagnostic records are retained, not deleted. An already-open or installed experimental app may still try to send events until closed, though restored rules should reject new diagnostic writes.

## Archived My Kitchen and compatibility limits

- Page: `kitchen.html`; controller: `scripts/kitchen.js`; calculations: `scripts/kitchen-core.js`; photo drafts: `scripts/food-scan.js`.
- One transactional document per household/solo user: `households/{id}/kitchen/state` or `users/{uid}/kitchen/state`.
- Planning reserves stock; only confirming Cooked today deducts it. Shopping checkmarks do not purchase food or replenish stock. Unknown dates do not cover demand until reviewed; no food-safety guarantee is inferred.
- Suggestions come from previously reviewed ingredient templates, not automatic understanding of every recipe. Names must match inventory. No mass-to-volume conversion is guessed.
- Fill my week previews empty dinner slots and shortages, requires approval, and preserves occupied slots. Original weekday plans were not migrated.
- Limits: 200 batches, 100 meals, 100 templates, 100 extras, 1,000 checkmarks, 100 recent actions and a client payload cap. See archived `KITCHEN.md`.
- The household change replaced public household enumeration with exact `household_invites/{code}` lookup. Existing codes required a member to open Settings once to create that index entry. This is a compatibility point to investigate if an old client failed during the experimental deployment; it is not a confirmed cause of the reported failure.
- This feature did not import the user's private inventory from MyKitchen/BetterDND or the separate Rexburg Kitchen service. They are separate products/data sources.

## What was tested, and what was not

At `d9ba068`, 26 Node tests and 7 Firestore emulator tests passed. GitHub's Mac job compiled AppleScript, built/verified the DMG and published it. GitHub Pages deployed successfully and the new page returned HTTP 200. Browser tests with synthetic local data exercised adding food and preview/approval while keeping stock unchanged. A later browser automation confirmation stalled, so this was not a complete manual end-to-end acceptance test.

No real scan on Adam's Mac was verified. No real Ollama photo inference was established by the mocked/proxy tests. No claim that the entire app works on his device should be inferred from green CI or HTTP 200. The owner subsequently reported the app was not working and requested rollback.

## Rollback procedure and remaining local state

Restore all eight commits on `main` via a revert commit; retain the archive branch. Deploy baseline `firestore.rules` with a temporary local Firebase config if needed (baseline has no `firebase.json`). Publish a fresh service-worker cache identifier. Withdraw the three chat-created DMG releases by making them drafts, retaining their artifacts for recovery. No customer Firestore documents are deleted or migrated backward.

Existing installations on Macs will NOT revert when GitHub rolls back. Quit Cookbook Scanner and use the live website to get the restored web version. Close old tabs and reload while online; the new service worker should retire the previous cache. If a page still appears stale, capture its URL/version before changing storage. Avoid clearing all browser data as a first step because it can affect offline data/sign-in.

Restoring the original rules also restores their original permission model, including broader household metadata access. This rollback is not a new security audit. Historical My Kitchen documents/invite indexes may remain dormant; their retention is intentional. Existing experimental apps should not be used against the restored app/rules.

To resume development later, branch from current `main`, examine the archive diff, reproduce one concrete failure, and selectively propose changes. Do not merge the whole archive or redeploy its rules simply to make an old installer work. The owner's current instruction is to keep that work off the live site.
