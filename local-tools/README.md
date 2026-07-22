# Local Tools

Small command-line helpers you run from your own machine — never deployed to
the live website. They exist specifically to avoid Firebase's paid "Blaze"
plan and Cloud Functions: both scripts use free, local resources instead.

- **[add-user](add-user/)** — create a new family member's login without
  opening the Firebase Console.
- **[scan-recipe](scan-recipe/)** — turn a photo of a recipe card into JSON
  using a free local AI model (Ollama), ready to paste into the admin
  dashboard's bulk upload box.
- **[sync-to-drive](sync-to-drive/)** — mirror every recipe into a shared
  Google Drive folder as Google Docs, using your own free Drive storage.

Each folder has its own README with setup steps.
