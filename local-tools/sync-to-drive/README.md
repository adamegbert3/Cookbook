# Sync Recipes to Google Drive (local tool)

Automatically mirrors every recipe in the Cookbook into a shared Google
Drive folder as native Google Docs (so anyone can open them right in Drive,
no PDF viewer needed), and writes the resulting link back onto each recipe
so a **📄 View PDF / Google Drive Copy** button shows up on the recipe page.

This uses **your own personal Google Drive storage** — not Firebase Storage —
specifically so it stays free with no risk of hitting Firebase's paid
"Blaze" plan requirement.

## How much storage will this actually use?

Recipe docs are just text (title, ingredients, instructions, notes) — no
photos. A typical recipe as a Google Doc is roughly 20-100 KB. Even at
1,000 recipes, that's well under 100 MB total — a tiny fraction of the
**15 GB free** every personal Google account gets. You could have many
thousands of recipes before storage became a real concern.

(For reference: Firebase Storage's free Spark-plan tier, if it's available
on this project, is 5 GB — also more than enough, but Drive avoids the
billing-plan question altogether.)

## One-time setup

1. **Install Node.js** if you don't have it: https://nodejs.org (LTS version).
2. **Create a Google Cloud OAuth client** (free, no billing needed):
   - Go to https://console.cloud.google.com/ and create a new project (or reuse one).
   - Search for **"Google Drive API"** and click **Enable**.
   - Go to **APIs & Services → OAuth consent screen** → choose **External** →
     fill in an app name (e.g. "Cookbook Sync") and your email → save through
     the remaining steps (you can leave it in "Testing" mode — that's fine
     since only you will use it).
   - Under **Test users**, add your own Google account's email.
   - Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Choose **Application type: Desktop app**, give it any name, click **Create**.
   - Click **Download JSON** on the credential you just created.
   - Save that file into this folder (`local-tools/sync-to-drive/`) and rename it to exactly:
     ```
     credentials.json
     ```
3. **Reuse (or create) your Firebase service account key** — the same kind
   used by the `add-user` tool. Either:
   - Copy `local-tools/add-user/serviceAccountKey.json` into this folder too, or
   - Leave it where it is — this script automatically falls back to that
     location if it doesn't find its own copy.
4. Install dependencies (one time):
   ```bash
   cd local-tools/sync-to-drive
   npm install
   ```

`credentials.json`, `token.json`, and `serviceAccountKey.json` are all
covered by the repo's `.gitignore` — never share these files.

## Running a sync

```bash
cd local-tools/sync-to-drive
npm start
```

The first time, it will print a Google login URL — open it in a browser,
sign in with the Google account whose Drive you want to use, and approve
access. After that, it remembers you (via `token.json`) and just runs.

Each run:
1. Finds (or creates) a **"Family Cookbook Recipes"** folder in that Drive account.
2. Creates a Google Doc for any recipe that doesn't have one yet.
3. Updates the Doc's content for any recipe that already has one, so edits
   made on the website stay in sync.
4. Skips recipes marked Hidden in the admin dashboard.

Anyone with access to that Drive folder can browse all the recipes directly
in Drive — no cookbook login needed. Run this again any time recipes
change (there's no automatic schedule; this is a manual command by design,
so nothing runs — or costs anything — in the background).

## Finding out how many recipes you have

You don't need this tool for that — the admin dashboard has a
**📊 Recipe Counts by Category** button (under "Master Recipe List") that
shows your total recipe count and a breakdown by category any time.
