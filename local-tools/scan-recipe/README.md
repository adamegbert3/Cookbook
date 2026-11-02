# Scan Recipe Photos & PDFs (AI, free & local)

Turns photos or PDFs of recipe cards/cookbook pages into structured recipe
data, using a free AI model that runs entirely on your own M3 MacBook. No
API key, no Firebase billing, no cloud costs — everything happens on your
machine, and nothing is ever uploaded anywhere.

There are two ways to use it — **the website is easier for normal use**;
the terminal tool is handy for scanning a big folder of files at once.

**First time using any of this on a given Mac?** These tools live inside
the project folder, so that folder has to actually exist on this computer
first:
```bash
git clone https://github.com/adamegbert3/Cookbook.git
cd Cookbook
```
(If `git` isn't found, macOS will prompt you to install "Command Line
Tools" the first time — click Install, wait a minute, then run the clone
command again.) Run every command in this guide from inside that `Cookbook`
folder.

## One-time setup (needed for both options)

1. **Install Ollama** (the free local AI runner): https://ollama.com/download
2. **Download the vision model** (one-time download, a few GB):
   ```bash
   ollama pull llama3.2-vision
   ```
3. **Start Ollama so the website is allowed to talk to it.** By default,
   Ollama blocks web pages from calling it (a security protection). Start it
   with:
   ```bash
   OLLAMA_ORIGINS=* ollama serve
   ```
   Leave that terminal window open while you're scanning. If Ollama is
   already running in the background (it often auto-starts), quit it first
   (find it in your menu bar and choose Quit, or `killall Ollama`), then run
   the command above instead.

## Option 1: From the website (recommended)

**Important — read this first:** the scanner will not work from the normal
`https://www.yum4you.com/admin.html` link. Browsers permanently block a
secure (HTTPS) page from calling a plain HTTP address, and that includes
Ollama at `localhost` — there is no setting or workaround for this, it's a
hard security rule with no exception for `localhost`. So scanning has to
happen from a plain-HTTP copy of the page instead:

1. In a terminal, from the project folder, run:
   ```bash
   node local-tools/scan-recipe/serve-locally.mjs
   ```
   It prints two links. Open the first one (`.../index.html`) and log in —
   this is a separate login session from the live site, so you'll need to
   sign in here too, even if you're already logged into yum4you.com.
2. Then open the second link (`.../admin.html`) and tap the **📷 Scan
   Photos** icon (or go straight to `.../admin/scan.html`).
3. Click the file picker and select one photo, one PDF, or **select several
   files at once**.
4. Click **🔍 Scan File(s)**. It scans them one at a time (you'll see
   progress: "Scanning 2 of 5..."), and PDFs are read page-by-page (up to 10
   pages) automatically — no extra steps.
5. When it's done, review the JSON it found, then click
   **⬇️ Send to Speed Upload Station** and **🚀 Launch Recipes**.

Leave the `serve-locally.mjs` terminal window running the whole time you're
scanning; press Ctrl+C when you're done.

**A file isn't assumed to be exactly one recipe.** The scanner looks at the
actual content and figures out how many recipes are really there:
- One photo/PDF with one recipe → one recipe out.
- One PDF where a recipe's ingredients/instructions continue across several
  pages → still counted as one recipe, combined from all those pages.
- One photo or PDF page with two+ recipes on it (e.g. a cookbook spread) →
  each one comes out as its own separate recipe.

A PDF longer than 10 pages only has its first 10 read (a safety limit so
one huge file can't hang your browser); if you're missing recipes from a
long document, split it into smaller PDFs first.

### Scanning from your phone (Ollama stays on the computer)

You can trigger scans from your phone while the actual AI work happens on
your Mac, as long as both devices are on the **same home WiFi** — and this
also requires the `serve-locally.mjs` server from above, since the HTTPS
blocking rule applies here too:

1. On the computer, run `node local-tools/scan-recipe/serve-locally.mjs`
   and note the port it prints (default `8080`).
2. Find the computer's local network address: Wi-Fi settings → click the
   (i) next to your network → it'll look like `192.168.1.42`.
3. Start Ollama so it accepts connections from other devices on the network
   (not just from itself):
   ```bash
   OLLAMA_HOST=0.0.0.0:11434 OLLAMA_ORIGINS=* ollama serve
   ```
   (If Ollama auto-started already, quit it from the menu bar first, or
   `killall Ollama`, then run the command above.)
4. On your phone (same WiFi), open `http://192.168.1.42:8080/index.html`
   (your computer's address, not "localhost" — that only means something on
   the computer itself), log in, then go to `.../admin/scan.html`.
5. Expand **"Scanning from your phone instead of the computer running
   Ollama?"** and enter
   `http://192.168.1.42:11434` in the box.
6. Scan as normal — the photo/PDF is sent from your phone, but the AI
   model runs on your computer.

## Option 2: From the terminal (`scan-recipe.mjs`)

Better for batch-processing a whole folder of photos at once without
clicking through the browser each time, and doesn't run into any of the
HTTPS/localhost issues above since there's no browser involved. Currently
handles **images only** (no PDFs — use the website for PDFs, since it can
render pages itself).

```bash
cd local-tools/scan-recipe
node scan-recipe.mjs ~/Desktop/grandmas-pie.jpg ~/Desktop/chili.jpg
```

You can pass as many image paths as you want in one go (Node's built-in
`fetch` is the only thing this script needs — no `npm install` required).
It will:

1. Send each photo to your local Ollama model.
2. Ask it to pull out the title, author, category, ingredients, instructions, and notes.
3. Write everything to `scanned-recipes.json` in this folder.

Then:

1. Open `scanned-recipes.json`, copy its contents.
2. Go to the admin dashboard → **🚀 Speed Upload Station**.
3. Paste the JSON into the box and click **🚀 Launch Recipes**.

## Troubleshooting

**"Cannot find module .../serve-locally.mjs" or "no such file or directory"**
You're not inside the project folder. See the `git clone` step at the very
top of this README — every command here needs to run from inside the
cloned `Cookbook` folder (`cd Cookbook` first).

**Ollama fails with `unknown model architecture: 'mllama'`**
This means Ollama itself can't load `llama3.2-vision` — this is an Ollama
compatibility issue, not something wrong with the scan or this site.
`mllama` is the architecture name for Llama 3.2 Vision; the version of
Ollama installed doesn't have support for it wired up correctly. Try, in
order:
1. **Update Ollama** — open the Ollama menu bar icon → check for an update
   (or just re-download and reinstall from https://ollama.com/download).
2. **Switch to a different vision model.** `llava` is older and more
   broadly compatible:
   ```bash
   ollama pull llava
   ```
   Then, on the website, open **📷 Scan Recipe Photos & PDFs → "🧠 Model not
   loading?"** and type `llava` into the box (this is remembered after
   that, no need to type it every time). For the terminal tool, set
   `OLLAMA_MODEL=llava` before running it:
   ```bash
   OLLAMA_MODEL=llava node scan-recipe.mjs photo.jpg
   ```
3. If you want to double-check the model itself outside of this site
   entirely, run `ollama run llama3.2-vision "describe a photo"` directly
   in Terminal — if that also fails with the same architecture error, it
   confirms this is purely an Ollama/model issue to resolve with steps 1-2
   above, nothing to fix here.

## After scanning (either option)

Recipes come in unreviewed (⚠️ Needs Review) by default — always double-check
the scanned ingredients/instructions against the original card before marking
a recipe as Verified in the edit screen, since handwriting recognition isn't
perfect.

## Tips for better scans

- Good lighting and a flat, non-blurry photo matter more than resolution.
- If a card is hard to read, the model may return an error for that one file
  and skip it — retake the photo and try again.
- Prefer typed/printed recipes over cursive handwriting when possible; messy
  handwriting is the main source of mistakes.
- If a multi-recipe file only turns up some of the recipes, try splitting
  it into smaller files — the model does better focused on less at once.
