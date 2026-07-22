# Add a Family Member (local tool)

Creates a new Cookbook login (Firebase Auth account + `users/{uid}` Firestore
document) from your own Mac's terminal, so you never have to open the
Firebase Console to add someone.

This only needs to be set up once. It's completely free — no Cloud Functions,
no Blaze plan required, since it runs with your own admin credentials on
your own machine.

## One-time setup

1. **Install Node.js** if you don't have it: https://nodejs.org (LTS version).
2. **Download your service account key** (this is what lets the script act as an admin):
   - Go to the [Firebase Console](https://console.firebase.google.com/) → your Cookbook project.
   - Click the gear icon → **Project settings** → **Service accounts** tab.
   - Click **Generate new private key** → confirm.
   - Save the downloaded file into this folder (`local-tools/add-user/`) and rename it to exactly:
     ```
     serviceAccountKey.json
     ```
   - **Keep this file secret.** It's already covered by `.gitignore` in this repo so it won't
     accidentally get committed — do not share it or upload it anywhere.
3. Install dependencies (one time):
   ```bash
   cd local-tools/add-user
   npm install
   ```

## Adding a person

```bash
cd local-tools/add-user
npm start
```

You'll be asked for their name, email, and a temporary password, plus whether
they should be an Admin. The script creates their login and their profile
document in one step. Give them the email + temporary password so they can
sign in — they can change the password from the login screen's "forgot
password" link at any time.

### Making someone an Admin

The website checks a hardcoded `ADMIN_UIDS` list in a few files (this was
already the pattern before this tool existed). If you say "yes" to the Admin
prompt, the script prints the new UID and reminds you to paste it into the
`ADMIN_UIDS` array in:

- `scripts/dashboard.js`
- `scripts/main.js`
- `scripts/profile.js`
- `edit-recipe.html`
