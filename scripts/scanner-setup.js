import { checkScanModel, DEFAULT_SCAN_MODEL } from './recipe-scan.js';

const key = 'cookbook-mac-scanner-setup-v1';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const steps = [
  ['A better scanner is ready', `<p>The scanner now checks your photo-reading model before scanning, gives clearer errors, and uses <strong>Gemma 3 4B</strong>. It is a smaller vision model than the old default.</p><p>We’ll install two free apps, download the model once, and start the updated Cookbook helper. Allow extra time for the model download. Use macOS Sonoma 14 or newer.</p><p class="setup-note">Photo scanning runs on your Mac. Use the local scanner page while Ollama and the helper are running. You can keep using yum4you.com for everything else.</p>`],
  ['Install or update Ollama', `<ol><li>Open the official download page below.</li><li>Download the Mac version. Open the download and follow its installation instructions, placing Ollama in Applications if asked.</li><li>Open <strong>Ollama</strong> from Applications and finish its first-run setup. Leave it running.</li></ol><a class="setup-action" href="https://ollama.com/download/mac" target="_blank" rel="noopener">Download Ollama for Mac ↗</a><p>Already installed? Update to the current version and open the app. You do not need to choose a cloud model or buy a subscription.</p>`],
  ['Install Node.js', `<p>This runs the small helper that connects the scanner to Ollama.</p><ol><li>Open the official Node.js download page.</li><li>Choose the <strong>LTS</strong> release and the <strong>macOS Installer (.pkg)</strong>. For an M4 Mac, select ARM64 if offered an architecture choice.</li><li>Open the installer and finish installation. Node.js 22 or newer is required.</li></ol><a class="setup-action" href="https://nodejs.org/en/download" target="_blank" rel="noopener">Download Node.js LTS ↗</a><p>Already have Node.js 22 or newer? Continue to the next step.</p>`],
  ['Download the photo-reading model', `<ol><li>Press <strong>Command-Space</strong>, type <strong>Terminal</strong>, then press Return.</li><li>Copy the command below, paste it into Terminal, and press Return.</li><li>Wait for the download to finish and show <strong>success</strong>. It is several gigabytes and may take a while.</li></ol><code id="setup-command">ollama pull gemma3:4b</code><button class="health-button" data-copy>Copy command</button><p>Leave Ollama running. A text-only or embedding model cannot read recipe photos.</p>`],
  ['Get the updated Cookbook', `<ol><li>Download the current scanner files below.</li><li>In Finder → Downloads, double-click the ZIP to unzip it if your browser has not already done that.</li><li>Open the newly extracted <strong>Cookbook-main</strong> folder. Move the extracted folder to <strong>Documents</strong> so it stays put. Look inside for <strong>Install-Mac-Scanner.command</strong>.</li></ol><a class="setup-action" href="https://github.com/adamegbert3/Cookbook/archive/refs/heads/main.zip">Download updated Cookbook ZIP</a><p>Use the new folder, even if you already have an older copy. Finder may add a number to the folder name; that’s fine. Keep any personal files in your older folder.</p>`],
  ['Add a one-click scanner to your Dock', `<p>This is the last Terminal step. It creates your own <strong>Cookbook Scanner</strong> app on this Mac.</p><ol><li>If an old helper is running, press <strong>Control-C</strong> in its Terminal. Quit Cookbook Scanner first if you are updating it.</li><li>In Terminal, type <code>bash </code>with a space after bash.</li><li>Drag <strong>Install-Mac-Scanner.command</strong> from the new Cookbook folder into Terminal, then press Return.</li><li>Finder opens with <strong>Cookbook Scanner</strong> selected. Drag it into the Dock, then click its Dock icon.</li><li>You can close Terminal. The app opens Ollama, starts the helper in the background, and opens Scan Photos.</li></ol><a class="setup-action" href="http://localhost:8080/scanner-setup.html#check">Continue to local connection check →</a><p class="setup-note"><strong>Everyday use: click Cookbook Scanner in the Dock.</strong> No commands. Keep the Cookbook folder in Documents. To stop the helper, choose Quit from the app’s Dock menu. Ollama stays open for other uses.</p>`],
  ['Check your connection', local
    ? `<p>You’re on the local helper. Now check that Ollama can find <strong>gemma3:4b</strong> and that it supports photos.</p><button id="setup-check" class="health-button scan-primary">Check Ollama connection</button><p>This checks the model’s availability. Your first photo scan will also test whether it can load into memory.</p>`
    : `<p>The website cannot check the helper on your Mac from here. Start the helper in the previous step, then open its local setup page.</p><a class="setup-action" href="http://localhost:8080/scanner-setup.html#check">Continue on this Mac’s local helper →</a>`],
  ['Sign in and scan your first recipe', `<ol><li>Open local sign-in below. Use your usual Cookbook account; the local page needs its own sign-in.</li><li>Open <strong>Admin → Scan Photos</strong>. Under “Choose a different model,” use <strong>gemma3:4b</strong> if an older model is saved.</li><li>Choose one clear JPEG or PNG photo, then press <strong>Scan recipes</strong>. The first scan can take longer while the model loads.</li><li>Review the amounts and any <strong>[unclear]</strong> text. Continue to Speed Upload and check the recipe before saving.</li></ol><a class="setup-action" href="http://localhost:8080/index.html" target="_blank" rel="noopener">Open local sign-in ↗</a><p>For iPhone HEIC photos, use Preview → File → Export → JPEG if the photo will not open. Keep Cookbook Scanner open while scanning; Terminal can stay closed.</p>`]
];
let step = 0, verified = false;
try { step = Math.min(steps.length - 1, Math.max(0, Math.trunc(Number(localStorage.getItem(key))) || 0)); } catch {}
if (location.hash === '#check') step = 6;
const title = document.getElementById('setup-title');
const body = document.getElementById('setup-body');
const feedback = document.getElementById('setup-feedback');
const next = document.getElementById('setup-next');
function render(focus = true) {
  try { localStorage.setItem(key, String(step)); } catch {}
  document.getElementById('setup-progress').textContent = `Step ${step + 1} of ${steps.length}`;
  document.getElementById('setup-meter').value = step + 1;
  title.textContent = steps[step][0]; body.innerHTML = steps[step][1]; feedback.textContent = '';
  document.getElementById('setup-back').disabled = step === 0;
  next.textContent = step === steps.length - 1 ? 'Done — open scanner →' : 'Next →';
  next.disabled = step === 6 && !verified;
  body.querySelector('[data-copy]')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(document.getElementById('setup-command').textContent); feedback.textContent = 'Copied. Paste into Terminal and press Return.'; }
    catch { feedback.textContent = 'Select the command above and press Command-C to copy it.'; }
  });
  body.querySelector('#setup-check')?.addEventListener('click', async event => {
    event.target.disabled = true; document.getElementById('setup-back').disabled = true; feedback.textContent = 'Checking Ollama and the photo model…';
    try {
      await checkScanModel('/api/ollama', DEFAULT_SCAN_MODEL); verified = true;
      try { localStorage.setItem('ollamaModelName', DEFAULT_SCAN_MODEL); } catch {}
      feedback.textContent = 'Connected! Gemma 3 4B supports photos. Press Next to sign in and scan.'; next.disabled = false;
    } catch (error) { feedback.textContent = `${error.message} Open the troubleshooting tips below, then try again.`; }
    finally { event.target.disabled = false; document.getElementById('setup-back').disabled = false; }
  });
  if (focus) title.focus();
}
document.getElementById('setup-back').onclick = () => { if (step > 0) { step--; render(); } };
next.onclick = () => { if (step < steps.length - 1) { step++; render(); } else location.href = 'http://localhost:8080/admin/scan.html'; };
window.addEventListener('hashchange', () => { if (location.hash === '#check') { step = 6; render(); } });
render(false);
