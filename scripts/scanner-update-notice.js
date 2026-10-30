// Adam's existing built-in admin ID; this is presentation, never authorization.
const ADAM_UID = 'n5aAU1g1tBY04Ut0HnhqegSgZe92';
const version = 'scanner-mac-setup-v1';
export function showScannerUpdate(user) {
  if (user?.uid !== ADAM_UID || document.getElementById('scanner-update-notice')) return;
  const key = `${version}:${user.uid}`;
  try { if (localStorage.getItem(key) || sessionStorage.getItem(key)) return; } catch {}
  const notice = document.createElement('section');
  notice.id = 'scanner-update-notice'; notice.className = 'setup-notice'; notice.setAttribute('aria-label', 'Scanner update');
  notice.innerHTML = `<h2>Your photo scanner has been updated</h2><p>Smaller vision model, clearer errors, and a new Mac setup guide. Get the updated helper and walk through Ollama setup one step at a time.</p><a class="pill-btn btn-teal" href="/scanner-setup.html">Set up my Mac scanner →</a><button type="button" data-later>Remind me next session</button><button type="button" data-dismiss>I’ve seen this</button>`;
  const dismiss = permanent => { try { (permanent ? localStorage : sessionStorage).setItem(key, '1'); } catch {} notice.remove(); };
  notice.querySelector('[data-later]').onclick = () => dismiss(false);
  notice.querySelector('[data-dismiss]').onclick = () => dismiss(true);
  document.body.prepend(notice);
}
