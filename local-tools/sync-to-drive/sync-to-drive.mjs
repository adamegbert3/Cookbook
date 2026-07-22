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
    const notesHtml = recipe.notes ? `<h2>Notes</h2><p>${recipe.notes}</p>` : '';

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

// --- 5. Main sync ---
async function main() {
    const drive = await getDriveClient();
    const db = getFirestore();

    console.log('Finding (or creating) the shared Drive folder...');
    const folderId = await getOrCreateFolder(drive);

    console.log('Reading recipes from Firestore...');
    const snap = await db.collection('recipes').get();

    let created = 0, updated = 0, skipped = 0;

    for (const docSnap of snap.docs) {
        const recipe = docSnap.data();

        if (recipe.isHidden === true) { skipped++; continue; }

        const html = recipeToHtml(recipe);
        const name = recipe.name || 'Untitled Recipe';

        try {
            if (recipe.driveFileId) {
                await drive.files.update({
                    fileId: recipe.driveFileId,
                    requestBody: { name },
                    media: { mimeType: 'text/html', body: html }
                });
                updated++;
                process.stdout.write(`  updated: ${name}\n`);
            } else {
                const file = await drive.files.create({
                    requestBody: { name, mimeType: 'application/vnd.google-apps.document', parents: [folderId] },
                    media: { mimeType: 'text/html', body: html },
                    fields: 'id, webViewLink'
                });

                await docSnap.ref.update({
                    driveFileId: file.data.id,
                    autoDriveUrl: file.data.webViewLink
                });

                created++;
                process.stdout.write(`  created: ${name}\n`);
            }
        } catch (err) {
            console.error(`  failed: ${name} (${err.message})`);
        }
    }

    console.log(`\nDone. Created ${created}, updated ${updated}, skipped ${skipped} hidden recipe(s).`);
    console.log(`Folder: https://drive.google.com/drive/folders/${folderId}\n`);
}

main().catch((err) => {
    console.error('\nSync failed:', err.message);
    process.exit(1);
});
