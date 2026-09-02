// auth.js — simple client-side shared-password gate.
//
// This is intentionally NOT real security: anyone who reads the page
// source or is on the network can see everything. It exists only to keep
// the site out of casual view / search engines, per the project's own
// "low stakes, not high security" requirement. Do not put anything here
// that actually needs protecting.

const SESSION_KEY = 'ffl_unlocked_v1';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildGateMarkup() {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <form class="auth-box" autocomplete="off">
      <h1>Password required</h1>
      <p>This site is for league members only.</p>
      <input type="password" name="password" placeholder="Password" autofocus />
      <button type="submit">Enter</button>
      <p class="auth-error" hidden>Wrong password — try again.</p>
    </form>
  `;
  return overlay;
}

/**
 * Gate the current page. Resolves once the correct password has been
 * entered (or was already verified this session). Until it resolves, the
 * caller should not fetch data or render the page content.
 */
export function requireAuth(passwordHash) {
  return new Promise((resolve) => {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      resolve();
      return;
    }

    const overlay = buildGateMarkup();
    document.body.appendChild(overlay);
    document.body.classList.add('auth-locked');

    const form = overlay.querySelector('form');
    const input = overlay.querySelector('input');
    const error = overlay.querySelector('.auth-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const attemptHash = await sha256Hex(input.value);
      if (attemptHash === passwordHash) {
        sessionStorage.setItem(SESSION_KEY, '1');
        document.body.classList.remove('auth-locked');
        overlay.remove();
        resolve();
      } else {
        error.hidden = false;
        input.value = '';
        input.focus();
      }
    });
  });
}
