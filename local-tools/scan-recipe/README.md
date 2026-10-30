# Scan recipe photos and PDFs with Ollama

## Quick start (Mac and Windows)

1. Install current Node.js (22 or newer) and Ollama from https://ollama.com/download.
2. Open Ollama. In Terminal or PowerShell run:

   ollama pull gemma3:4b
   ollama list

3. From the Cookbook project folder run:

   node local-tools/scan-recipe/serve-locally.mjs

4. Open http://localhost:8080/index.html and sign in. Open Admin → Scan Photos.
5. Click **Check Ollama connection**. Select photos/PDFs and scan. Review the results before sending them to Speed Upload Station.

Keep Ollama and the helper running. No npm install is needed for scanning.
The helper forwards requests to Ollama on the same computer, avoiding browser CORS configuration.
Do not set OLLAMA_ORIGINS=* or expose Ollama to your network for this workflow.
The hosted website does not run this local helper; use the localhost page.

## M-series MacBook troubleshooting

- The default is gemma3:4b, a smaller vision model than the previous llama3.2-vision default. Actual speed depends on memory and document size.
- If an old model is saved in the browser, expand **Choose a vision model** and enter gemma3:4b.
- Model not found: run ollama pull with the exact name selected in the page.
- Cannot read photos: an embedding/text-only model is selected. nomic-embed-text is not a photo reader.
- Cannot reach Ollama: open the Ollama app, then rerun the connection check. If using ollama serve instead, leave that terminal open. An address-already-in-use error usually means the app is already serving; do not start a second server.
- Unknown model architecture: update Ollama and try gemma3:4b. This is a model-loading failure, not a photo-quality issue.
- Out of memory or timeout: close memory-heavy apps, scan one photo at a time, and split long PDFs.
- HEIC cannot decode: export the photo as JPEG or PNG in Preview or Photos. Browser support for HEIC varies.
- Local Firebase login uses a separate session from the live site. If Firebase reports an unauthorized domain, the project owner must allow localhost in Firebase Authentication's authorized domains.

Photos are decoded and converted to JPEG in the browser with a maximum 2400-pixel long edge.
PDFs render up to 10 pages into one request so recipes spanning pages can remain together.
Large PDFs may still need splitting. Requests time out after five minutes and are capped at 40 MB by the helper.
The model is instructed to preserve measurements and mark unreadable text as [unclear]; it can still make mistakes.

## Command line (images only)

From local-tools/scan-recipe:

    node scan-recipe.mjs /path/to/photo.jpg /path/to/another.png

This writes scanned-recipes.json in the current directory. Copy it into Speed Upload Station.
Use JPEG/PNG images; PDF rendering is available in the browser scanner.
Set OLLAMA_MODEL to override the model. Set OLLAMA_URL to the API base (default http://127.0.0.1:11434/api);
the older full /api/generate URL is also accepted.

Mac shell example:

    OLLAMA_MODEL=gemma3:4b node scan-recipe.mjs photo.jpg

PowerShell example:

    $env:OLLAMA_MODEL = 'gemma3:4b'
    node scan-recipe.mjs photo.jpg

## Optional phone access on a trusted home network

The helper binds to 127.0.0.1 by default. To opt into LAN access, start it with HOST=0.0.0.0
(Mac: HOST=0.0.0.0 node local-tools/scan-recipe/serve-locally.mjs;
PowerShell: set $env:HOST = '0.0.0.0' first).
Open http://COMPUTER_LAN_IP:8080/index.html on the phone. Ollama stays bound to loopback;
do not change its host or origins. The helper includes import and Drive-sync endpoints without
server-side authentication, so only enable LAN access on a network you trust. Do not port-forward it.
Firebase login may require the LAN hostname to be authorized.

For a different Ollama host, configure OLLAMA_BASE_URL on the helper computer, not in the browser.

## Verification

    node --test local-tools/scan-recipe/scan.test.mjs

Tests cover output validation, a full mocked scan through the helper, missing/non-vision models,
private-file blocking, malformed URLs, and cross-origin requests.
