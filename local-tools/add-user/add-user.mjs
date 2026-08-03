// Local CLI tool to add a family member to the Cookbook without opening the
// Firebase Console. Run this from your own machine (never deploy it to the
// website -- it needs a private service account key).
//
// Usage:  npm start
// (see README.md in this folder for one-time setup steps)

import { readFileSync, existsSync } from 'fs';
import { createInterface } from 'readline/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEY_PATH = join(__dirname, 'serviceAccountKey.json');

if (!existsSync(KEY_PATH)) {
    console.error('\nMissing serviceAccountKey.json in this folder.');
    console.error('See README.md for how to download it from the Firebase Console.\n');
    process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function main() {
    console.log('\nCookbook - Add a Family Member\n');

    const name = (await rl.question('Full name (e.g. "Aunt Sally"): ')).trim();
    const email = (await rl.question('Email address: ')).trim();
    // Note: this is a plain local terminal prompt, so the password is visible as you type.
    const password = (await rl.question('Temporary password (min 6 characters): ')).trim();

    if (!name || !email || password.length < 6) {
        console.error('\nName, email, and a 6+ character password are all required.');
        rl.close();
        process.exit(1);
    }

    const makeAdminAnswer = (await rl.question('Should this person be an Admin? (y/N): ')).trim().toLowerCase();
    const makeAdmin = makeAdminAnswer === 'y' || makeAdminAnswer === 'yes';

    try {
        const userRecord = await auth.createUser({
            email,
            password,
            displayName: name
        });

        // Keep this shape in sync with scripts/invite-signup.js and the
        // "Check User Documents" repair tool in scripts/dashboard.js.
        // Personal recipe notes are NOT a field here — they live one per
        // recipe under users/{uid}/private_notes/{recipeId}.
        await db.collection('users').doc(userRecord.uid).set({
            Name: name,
            email,
            role: makeAdmin ? 'admin' : 'user',
            favorites: [],      // array, not ""
            householdId: null,  // set when they join/create a household
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`\nCreated account for ${name} (${email})`);
        console.log(`UID: ${userRecord.uid}`);

        if (makeAdmin) {
            console.log('\nAdmin access is set (role: "admin" on their profile) — no code changes or');
            console.log('redeploy needed, it takes effect the next time they sign in. You can also');
            console.log('promote/demote anyone later from the admin console\'s "Manage Admin Access"');
            console.log('widget instead of this script.');
        }

        console.log('\nGive them the email + temporary password so they can sign in at the site.');
        console.log('They can reset their password from the login screen at any time.\n');

    } catch (err) {
        console.error('\nError creating user:', err.message);
    } finally {
        rl.close();
    }
}

main();
