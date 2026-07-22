# Scan Recipe Photos & PDFs (AI, free & local)

Turns photos or PDFs of recipe cards/cookbook pages into structured recipe
data, using a free AI model that runs entirely on your own M3 MacBook. No
API key, no Firebase billing, no cloud costs — everything happens on your
machine, and nothing is ever uploaded anywhere.

There are two ways to use it — **the website is easier for normal use**;
the terminal tool is handy for scanning a big folder of files at once.

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

1. Go to the **admin dashboard** → **📷 Scan Recipe Photos & PDFs**.
2. Click the file picker and select one photo, one PDF, or **select several
   files at once** — each file becomes its own recipe.
3. Click **🔍 Scan File(s)**. It scans them one at a time (you'll see
   progress: "Scanning 2 of 5..."), and PDFs are read page-by-page (up to 5
   pages) automatically — no extra steps.
4. When it's done, review the JSON it found, then click
   **⬇️ Send to Speed Upload Station** and **🚀 Launch Recipes**.

### Scanning from your phone (Ollama stays on the computer)

You can trigger scans from your phone while the actual AI work happens on
your Mac, as long as both devices are on the **same home WiFi**:

1. On the computer, find its local network address: Wi-Fi settings →
   click the (i) next to your network → it'll look like `192.168.1.42`.
2. Start Ollama so it accepts connections from other devices on the network
   (not just from itself):
   ```bash
   OLLAMA_HOST=0.0.0.0:11434 OLLAMA_ORIGINS=* ollama serve
   ```
   (If Ollama auto-started already, quit it from the menu bar first, or
   `killall Ollama`, then run the command above.)
3. On your phone, open the admin dashboard → **📷 Scan Recipe Photos &
   PDFs** → expand **"Scanning from your phone instead of the computer
   running Ollama?"** → enter `http://192.168.1.42:11434` (using your
   computer's actual address) in the box.
4. Scan as normal — the photo/PDF is sent from your phone, but the AI
   model runs on your computer.

**One catch:** if your cookbook site is served over HTTPS (which is normal
for a real domain), browsers block a secure page from calling a plain
`http://` address on the network — this is called "mixed content," and it's
a browser security rule, not something this site can turn off. `localhost`
gets a special exception, but a LAN address like `192.168.1.42` does not.
If scanning from your phone doesn't work and the browser console mentions
"mixed content" or "blocked," that's why. Two ways around it:
- Load the admin dashboard itself from the computer's address too — e.g.
  run `npx serve` in this project's root folder on the computer, then visit
  `http://192.168.1.42:3000/admin.html` from your phone instead of your
  real domain. Since the page itself is then plain HTTP, calling Ollama's
  HTTP address is no longer blocked.
- Or just scan from the same computer that's running Ollama (Option 1
  above) — simplest, and works every time with zero setup.

## Option 2: From the terminal (`scan-recipe.mjs`)

Better for batch-processing a whole folder of photos at once without
clicking through the browser each time. Currently handles **images only**
(no PDFs — use the website for PDFs, since it can render pages itself).

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
- For multi-page PDFs, only the first 5 pages are read (a safety limit so
  one huge file can't hang your browser) — split anything longer into
  smaller PDFs first.
