import { PASSWORD_HASH, SITE_TITLE, RULES_DOC_ID } from '../config.js';
import { requireAuth } from './auth.js';

document.title = SITE_TITLE + ' — League Rules';
document.querySelector('#site-title').textContent = SITE_TITLE;

async function main() {
  await requireAuth(PASSWORD_HASH);

  const container = document.getElementById('doc-content');
  container.innerHTML = '';

  const iframe = document.createElement('iframe');
  iframe.className = 'doc-embed';
  iframe.title = 'League Rules';
  iframe.src = `https://docs.google.com/document/d/${RULES_DOC_ID}/preview`;
  container.appendChild(iframe);

  const link = document.createElement('p');
  link.className = 'doc-fallback-link';
  const a = document.createElement('a');
  a.href = `https://docs.google.com/document/d/${RULES_DOC_ID}/view`;
  a.textContent = 'Open the rules doc directly';
  a.target = '_blank';
  a.rel = 'noopener';
  link.appendChild(a);
  container.appendChild(link);
}

main().catch((err) => {
  const status = document.getElementById('status');
  status.hidden = false;
  status.className = 'status-banner error';
  status.textContent = 'Something went wrong loading the rules: ' + err.message;
  console.error(err);
});
