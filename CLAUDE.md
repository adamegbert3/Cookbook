# Cookbook project context

Read [docs/CODEX-HANDOFF-2026-11-01.md](docs/CODEX-HANDOFF-2026-11-01.md) before troubleshooting or proposing changes.

The owner requested a rollback of ALL code/features added during the October 29–November 1 Codex chat. The intended live baseline is commit `d474ae9` (before scanner fixes, telemetry, Mac installer and My Kitchen). The rollback includes a fresh service-worker cache name and this documentation. Experimental work is preserved on `archive/codex-scanner-kitchen-2026-11-01`; it is not approved for reintroduction or merge.

This is a GitHub Pages website backed by Firebase, with separate local-only tools. An installed Cookbook Scanner Mac app contains its own copy of the website: changing GitHub does not update or remove that installed app. Do not assume the live website and a localhost page are the same version or share a browser login.

Do not erase recipes, users, kitchen documents or diagnostics as part of troubleshooting. Never commit credentials or ask anyone to paste authentication tokens into chat. Diagnose the actual failing URL, version and error before claiming the Mac scanner works.
