# My Kitchen

Open `kitchen.html` from the cookbook menu. Inventory, dated meals and shopping are shared with current household members, or private to a solo account. Existing weekday plans remain in the original planner; they are not silently migrated.

1. Add pantry, fridge or freezer batches. Confirm amount, unit and a planning cutoff (or explicitly choose no cutoff). Unknown dates stay visible but do not cover meal demand.
2. Plan a recipe and review its ingredient rows. Match names with inventory. Quantities support compatible mass/volume conversions, but never infer density or substitute ingredients.
3. Reviewed recipes become dinner suggestions. **Fill my week** previews empty dinner slots and shortages; approval is required to save. Existing meals are preserved.
4. Shopping sums uncovered demand across the selected seven dates. Checkmarks and extras do not change food stock. Add purchases as confirmed batches.
5. Only **Cooked today** consumes reserved stock, atomically and once. Skip/remove release reservations. Past uncompleted meals are flagged for review. Removing cooked entries does not restore consumed food.

Photo scanning runs through the local Mac scanner and Ollama. It produces editable drafts, not purchases or safety determinations. Unreadable quantities stay blank; printed dates must be reviewed. Photos are not written to Firestore. To scan with this version, install the latest Cookbook Scanner DMG and open My Kitchen from its local cookbook.

## Storage and access

`households/{id}/kitchen/state` or `users/{uid}/kitchen/state` is a bounded, versioned transaction document. A single transaction updates stock and meals together to prevent double consumption across devices. Review forms reject stale revisions rather than overwriting changes. Limits: 200 batches, 100 meals, 100 reviewed recipe templates, 100 shopping extras, 1,000 checkmarks and 100 recent events; client payload limit 600,000 characters. This first version favors simple atomic updates over unlimited history. Remove old completed/skipped meals and obsolete batches/extras as needed.

Household documents are no longer enumerable by regular users. Exact join-code lookup uses `household_invites/{code}`; existing members open Settings once to register an existing code. New codes use cryptographic randomness. Leaving removes membership and access; household data remains with that household. Admins retain household administration access. Personal kitchen state is owner-only.

Deploy `firestore.rules` before publishing the new page. No production data migration is required. Cached older clients may need a refresh to use the new invitation flow.

## Validation

- `node --test local-tools/scan-recipe/*.test.mjs`
- Java 21+, then `cd local-tools/kitchen-rules && npm ci && npm test` (demo Firestore emulator only).
- The Mac release workflow runs both suites before publishing an installer. Browser checks should use synthetic local data, not test food added to a real household.
