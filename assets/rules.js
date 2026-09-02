import { PASSWORD_HASH, SITE_TITLE } from '../config.js';
import { requireAuth } from './auth.js';

document.title = SITE_TITLE + ' — League Rules';
document.querySelector('#site-title').textContent = SITE_TITLE;

// Placeholder until RULES_DOC_ID is wired up in config.js — the password
// gate is fully live already, just the doc content isn't yet.
requireAuth(PASSWORD_HASH);
