import { checkScanModel, DEFAULT_SCAN_MODEL } from './recipe-scan.js';

const key = 'cookbook-mac-scanner-download-v1';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const steps = [
  ['No Terminal. Just your recipes.', `<p>Install <strong>Cookbook Scanner</strong> like a Mac app. It includes the helper and its runtime, so there is no separate Node.js installation or project folder to manage.</p><p>Made for Apple silicon Macs (M1, M2, M3, M4 and newer), with macOS 14 or newer. Install Ollama once, then download the photo model with a button.</p>`],
  ['Download Cookbook Scanner', `<a class="setup-action" href="https://github.com/adamegbert3/Cookbook/releases/latest/download/Cookbook-Scanner-Apple-Silicon.dmg">Download for Mac · Apple silicon</a><p>Save the disk image, then open it from Downloads. This app is for M-series Macs, including M4. Intel Macs are not supported by this download.</p><p>This community build is not Apple-notarized; macOS may ask you to approve it before its first launch.</p>`],
  ['Drag into Applications', `<ol><li>Open the downloaded <strong>Cookbook Scanner</strong> disk image.</li><li>Drag <strong>Cookbook Scanner</strong> onto the <strong>Applications</strong> shortcut in that window.</li><li>Open your Applications folder and launch Cookbook Scanner from there. Eject the disk image when finished.</li></ol><p>If macOS blocks this unnotarized app, review <a href="https://support.apple.com/102445" target="_blank" rel="noopener">Apple’s guidance for opening downloaded apps</a>. Approval is your choice; no security settings are changed by the installer.</p><p>Updating an older copy? Quit Cookbook Scanner first, then replace it in Applications. If you made the earlier launcher in your personal Applications folder, remove its old Dock shortcut and use this new app instead.</p>`],
  ['Install Ollama once', `<a class="setup-action" href="https://ollama.com/download/mac" target="_blank" rel="noopener">Download Ollama for Mac ↗</a><ol><li>Open the official Ollama download.</li><li>Drag Ollama into Applications and open it.</li><li>Finish its first-run screens. Leave Ollama open.</li></ol><p>Already installed? Open or update Ollama, then continue. The scanner uses a local model; no paid AI subscription is needed.</p>`],
  ['Open your scanner app', `<p>Open <strong>Cookbook Scanner</strong> from Applications. It opens Ollama, starts the helper quietly, and opens your browser.</p><p>If the model is not installed yet, it opens the download/check step automatically. Continue there to install the photo model with one button.</p><a class="setup-action" href="http://localhost:8080/scanner-setup.html#check">Continue in the local app →</a>`],
  ['Keep it in your Dock', `<p>Drag <strong>Cookbook Scanner</strong> from Applications into the Dock.</p><p><strong>Next time, click that icon.</strong> The app opens the scanner and starts Ollama for you. No Terminal, commands, or helper folder to keep track of.</p><p>Keep the app open while scanning. Choose Quit from its Dock menu to stop the helper. Ollama remains open for other uses.</p>`],
  ['Get the photo model and check', local
    ? `<p>Download <strong>Gemma 3 4B</strong> once (about 3.4 GB). Keep Ollama and Cookbook Scanner open. This may take several minutes.</p><button id="setup-download" class="health-button scan-primary">Download photo model · 3.4 GB</button><p>Already have it?</p><button id="setup-check" class="health-button">Check Ollama connection</button><p>The first photo scan also checks whether the model fits in available memory.</p>`
    : `<p>Open Cookbook Scanner from Applications first. Downloading the model happens on your Mac, through the local helper.</p><a class="setup-action" href="http://localhost:8080/scanner-setup.html#check">Open local model setup →</a>`],
  ['Sign in and scan your first recipe', `<ol><li>Sign in locally with your usual Cookbook account. It has a separate session from the website.</li><li>Open <strong>Admin → Scan Photos</strong> and choose one clear JPEG or PNG photo.</li><li>Press <strong>Scan recipes</strong>. Review the amounts and any <strong>[unclear]</strong> text before saving.</li></ol><a class="setup-action" href="http://localhost:8080/index.html" target="_blank" rel="noopener">Open local sign-in ↗</a><p>For iPhone HEIC photos, use Preview → File → Export → JPEG if needed. Keep Cookbook Scanner open while scanning.</p>`]
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
  body.querySelector('#setup-download')?.addEventListener('click', async event => {
    event.target.disabled = true; document.getElementById('setup-back').disabled = true; next.disabled = true;
    const checkButton = body.querySelector('#setup-check'); if (checkButton) checkButton.disabled = true;
    feedback.textContent = 'Starting download. Leave this page and Ollama open…';
    try {
      const response = await fetch('/api/ollama/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: DEFAULT_SCAN_MODEL }), signal: AbortSignal.timeout(3600000) });
      if (!response.ok) throw Error('Could not start the download. Open Ollama and try again.');
      const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '', succeeded = false;
      function progress(line) {
        if (!line.trim()) return;
        const data = JSON.parse(line); if (data.error) throw Error(data.error);
        if (data.status === 'success') succeeded = true;
        feedback.textContent = data.total ? 'Downloading model layer: ' + Math.round((data.completed || 0) / data.total * 100) + '%' : (data.status || 'Downloading…');
      }
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(progress);
        if (done) { progress(pending); break; }
      }
      if (!succeeded) throw Error('Download did not finish. Click Download to resume.');
      await checkScanModel('/api/ollama', DEFAULT_SCAN_MODEL); verified = true;
      try { localStorage.setItem('ollamaModelName', DEFAULT_SCAN_MODEL); } catch {}
      next.disabled = false; feedback.textContent = 'Model installed and ready! Press Next to sign in and scan.';
    } catch (error) { feedback.textContent = error.message + ' You can retry; completed download layers are reused.'; }
    finally { event.target.disabled = false; document.getElementById('setup-back').disabled = false; if (checkButton) checkButton.disabled = false; }
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
