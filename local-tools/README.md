# Local Tools

Small command-line helpers you run from your own machine — never deployed to
the live website. They exist specifically to avoid Firebase's paid "Blaze"
plan and Cloud Functions: both scripts use free, local resources instead.

- **[add-user](add-user/)** — create a new family member's login without
  opening the Firebase Console. (Mostly superseded by the admin console's
  own "Invite a Family Member" tool, which needs no local setup at all —
  kept around as a fallback.)
- **[scan-recipe](scan-recipe/)** — turn a photo of a recipe card into JSON
  using a free local AI model (Ollama), ready to paste into the admin
  console's Speed Upload Station. Also hosts `serve-locally.mjs`, the local
  HTTP server that three separate admin tools depend on (not just this
  one) to get around a browser security rule that blocks the live HTTPS
  site from doing things like calling Ollama, fetching another site's raw
  HTML, or running a local script:
    - 📷 Scan Photos (this folder's own feature)
    - 🔗 Import Recipe from a Link (`scripts/recipe-import.js`)
    - ☁️ Drive Sync's on-demand trigger (`local-tools/sync-to-drive`)
- **[sync-to-drive](sync-to-drive/)** — mirror every recipe into a shared
  Google Drive folder as Google Docs, using your own free Drive storage.

Each folder has its own README with setup steps.
