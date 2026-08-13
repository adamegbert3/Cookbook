// Mirrors every Cookbook recipe into a shared Google Drive folder as native
// Google Docs, using your OWN free personal Google Drive storage (not
// Firebase Storage — this avoids the Blaze/billing question entirely).
//
// Usage:  npm start
// (see README.md in this folder for one-time setup steps)

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { createHash } from 'crypto';
import { google } from 'googleapis';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = join(__dirname, 'credentials.json');
const TOKEN_PATH = join(__dirname, 'token.json');
const SERVICE_ACCOUNT_PATH = existsSync(join(__dirname, 'serviceAccountKey.json'))
    ? join(__dirname, 'serviceAccountKey.json')
    : join(__dirname, '..', 'add-user', 'serviceAccountKey.json');

const DRIVE_FOLDER_NAME = 'Family Cookbook Recipes';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function requireFile(path, helpText) {
    if (!existsSync(path)) {
        console.error(`\nMissing ${path}`);
        console.error(helpText + '\n');
        process.exit(1);
    }
}

// --- 1. Google Drive OAuth (your personal Google account) ---
async function getDriveClient() {
    requireFile(CREDENTIALS_PATH, 'See README.md for how to download this from Google Cloud Console (OAuth client, "Desktop app" type).');

    const { client_id, client_secret, redirect_uris } = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')).installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris ? redirect_uris[0] : undefined);

    if (existsSync(TOKEN_PATH)) {
        oAuth2Client.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf8')));
        return google.drive({ version: 'v3', auth: oAuth2Client });
    }

    const token = await authenticateInteractively(oAuth2Client);
    oAuth2Client.setCredentials(token);
    writeFileSync(TOKEN_PATH, JSON.stringify(token));
    console.log(`Saved auth token to ${TOKEN_PATH} — you won't need to log in again next time.\n`);

    return google.drive({ version: 'v3', auth: oAuth2Client });
}

function authenticateInteractively(oAuth2Client) {
    return new Promise((resolve, reject) => {
        const server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url, 'http://localhost:53682');
                const code = url.searchParams.get('code');

                if (!code) {
                    res.end('No code received. You can close this tab.');
                    return;
                }

                res.end('Success! You can close this tab and go back to the terminal.');
                server.close();

                const { tokens } = await oAuth2Client.getToken({
                    code,
                    redirect_uri: 'http://localhost:53682'
                });
                resolve(tokens);
            } catch (err) {
                res.end('Something went wrong. Check the terminal.');
                server.close();
                reject(err);
            }
        });

        server.listen(53682, () => {
            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
                redirect_uri: 'http://localhost:53682'
            });

            console.log('\nOpen this URL in a browser and authorize with the Google account whose Drive you want to sync to:\n');
            console.log(authUrl + '\n');
            console.log('Waiting for you to finish in the browser...\n');
        });
    });
}

// --- 2. Firestore (recipe data) ---
function getFirestore() {
    requireFile(SERVICE_ACCOUNT_PATH, 'See README.md — you can reuse the same key from local-tools/add-user, or download your own.');
    const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    return admin.firestore();
}

// --- 3. Drive folder ---
async function getOrCreateFolder(drive) {
    const res = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`,
        fields: 'files(id, name)'
    });

    if (res.data.files.length > 0) return res.data.files[0].id;

    const folder = await drive.files.create({
        requestBody: { name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
    });
    return folder.data.id;
}

// --- 4. Build a simple, readable HTML doc for a recipe ---
function recipeToHtml(recipe) {
    const ingredients = recipe.ingredients || recipe.recipeIngredient || [];
    const instructions = recipe.instructions || recipe.recipeInstructions || [];

    const ingHtml = Array.isArray(ingredients) ? ingredients.map(i => `<li>${i}</li>`).join('') : '';
    const instHtml = Array.isArray(instructions) ? instructions.map(s => `<li>${s}</li>`).join('') : '';
    const notesHtml = recipe.notes && String(recipe.notes).trim()
        ? `<h2>Notes</h2><p>${recipe.notes}</p>`
        : '';

    return `<html><body>
        <h1>${recipe.name || 'Untitled'}</h1>
        <p><em>From: ${recipe.author || 'Family'}</em></p>
        <h2>Ingredients</h2>
        <ul>${ingHtml}</ul>
        <h2>Instructions</h2>
        <ol>${instHtml}</ol>
        ${notesHtml}
    </body></html>`;
}

// A short fingerprint of everything that actually shows up in the Drive
// doc. Lets a run skip recipes that haven't changed since last time —
// which matters once this runs automatically after every save instead of
// once a day, since re-uploading every recipe every time would make a
// large cookbook take minutes for a one-recipe edit.
function contentHash(recipe) {
    const key = JSON.stringify({
        name: recipe.name || '',
        author: recipe.author || '',
        ingredients: recipe.ingredients || recipe.recipeIngredient || [],
        instructions: recipe.instructions || recipe.recipeInstructions || [],
        notes: recipe.notes || ''
    });
    return createHash('sha1').update(key).digest('hex');
}

// --- 5. Main sync ---
async function main() {
    const drive = await getDriveClient();
    const db = getFirestore();

    console.log('Finding (or creating) the shared Drive folder...');
    const folderId = await getOrCreateFolder(drive);

    console.log('Reading recipes from Firestore...');
    const snap = await db.collection('recipes').get();

    let created = 0, updated = 0, unchanged = 0, hidden = 0;
    const keepFileIds = new Set();

    for (const docSnap of snap.docs) {
        const recipe = docSnap.data();
        const name = recipe.name || 'Untitled Recipe';

        // Hidden AND Testing Kitchen (draft) recipes aren't created — a
        // draft is explicitly not ready for the family to see yet, so it
        // must never reach the shared Drive folder. If one was visible
        // before (and already has a Drive file), the cleanup pass below
        // removes it — same as a deleted recipe.
        if (recipe.isHidden === true || recipe.isDraft === true) { hidden++; continue; }

        const hash = contentHash(recipe);

        if (recipe.driveFileId && recipe.driveContentHash === hash) {
            keepFileIds.add(recipe.driveFileId);
            unchanged++;
            continue;
        }

        const html = recipeToHtml(recipe);
        let handledAsUpdate = false;

        if (recipe.driveFileId) {
            try {
                await drive.files.update({
                    fileId: recipe.driveFileId,
                    requestBody: { name },
                    media: { mimeType: 'text/html', body: html }
                });
                await docSnap.ref.update({ driveContentHash: hash });
                keepFileIds.add(recipe.driveFileId);
                updated++;
                process.stdout.write(`  updated: ${name}\n`);
                handledAsUpdate = true;
            } catch (err) {
                // The Drive file this recipe used to point to is gone (e.g.
                // it was manually deleted from Drive) — recreate it below
                // instead of failing the whole sync.
                console.warn(`  ${name}: existing Drive file is gone (${err.message}), recreating...`);
            }
        }

        if (!handledAsUpdate) {
            try {
                const file = await drive.files.create({
                    requestBody: { name, mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
                    media: { mimeType: 'text/html', body: html },
                    fields: 'id, webViewLink'
                });

                await docSnap.ref.update({
                    driveFileId: file.data.id,
                    autoDriveUrl: file.data.webViewLink,
                    driveContentHash: hash
                });

                keepFileIds.add(file.data.id);
                created++;
                process.stdout.write(`  created: ${name}\n`);
            } catch (err) {
                console.error(`  failed: ${name} (${err.message})`);
            }
        }
    }

    // Anything left in the Drive folder that isn't a current, visible
    // recipe was either deleted from the cookbook or hidden since the last
    // sync — trash it so the family's Drive folder never gets stale or
    // shows something that was pulled from the site.
    console.log('Checking for recipes removed from the cookbook...');
    const existingFiles = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name)',
        pageSize: 1000
    });

    let removed = 0;
    for (const file of existingFiles.data.files) {
        if (!keepFileIds.has(file.id)) {
            await drive.files.update({ fileId: file.id, requestBody: { trashed: true } });
            removed++;
            process.stdout.write(`  removed: ${file.name}\n`);
        }
    }

    console.log(`\nDone. Created ${created}, updated ${updated}, removed ${removed}, unchanged ${unchanged}, ${hidden} hidden.`);
    console.log(`Folder: https://drive.google.com/drive/folders/${folderId}\n`);
}

main().catch((err) => {
    console.error('\nSync failed:', err.message);
    process.exit(1);
});
