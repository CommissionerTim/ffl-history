// rules.js — fetches the League Rules Google Doc's own exported HTML and
// reformats its actual text in the site's own type/theme (Space
// Grotesk/Manrope, dark), instead of embedding the doc's own styling via
// iframe. The doc stays the live source of truth: edit it, reload this
// page, done — no site change needed for rules text changes.
//
// The parser below is driven entirely by structure Google Docs' export
// already encodes, not by any rule text specific to this league:
//   - Blank <p> elements are spacer paragraphs Docs pads the export with;
//     they're skipped.
//   - The first non-blank <p> is the doc title; every non-blank <p> before
//     the first list is front-matter (kept, de-emphasized) below it.
//   - Once at least one list has been rendered, a <p> whose text ends in
//     ':' is a section heading (this doc's own convention — every section
//     name, whether typed in Title Case or ALL CAPS, ends with a colon);
//     any other <p> is a plain body paragraph.
//   - <ul> is Docs' list export: each <ul> carries a class token shaped
//     "lst-kix_<listId>-<depth>". A run of consecutive <ul> siblings
//     sharing the same listId is one logical (possibly multi-level) list —
//     Docs emits each nesting level as its own flat sibling <ul> rather
//     than actually-nested markup, so buildList() below reconstructs the
//     real tree from the depth numbers.
// Confirmed against the live doc: no semantic heading tags, no inline
// bold/italic runs to preserve, so this only ever needs to move text and
// list structure — never formatting — into the site's own markup.

import { PASSWORD_HASH, SITE_TITLE, RULES_DOC_ID } from '../config.js';
import { requireAuth } from './auth.js';

document.title = SITE_TITLE + ' — League Rules';
document.querySelector('#site-title').textContent = SITE_TITLE;

/**
 * @param {Element} ul
 * @returns {{id: string, depth: number}|null}
 */
function listIdAndDepth(ul) {
  const token = (ul.getAttribute('class') || '').split(/\s+/).find((c) => c.startsWith('lst-kix_'));
  if (!token) return null;
  const match = token.match(/^lst-kix_(.+)-(\d+)$/);
  if (!match) return null;
  return { id: match[1], depth: Number(match[2]) };
}

/**
 * Renders one logical list from a run of same-listId flat sibling <ul>s
 * (see file header). For each item, the item's parent at the next
 * shallower depth is "whichever <li> was most recently added at that
 * depth" — so a new <ul> one level deeper attaches under that <li>, and a
 * later run at the same depth under the same still-current parent <li>
 * reuses that same nested <ul> rather than starting a new one (this is
 * what lets a list resume after a deeper sub-list closes, e.g. Playoffs'
 * "Week 15 / Week 16 / Week 17" items each carrying their own matchup
 * sub-list).
 * @param {Array<{depth: number, liEl: Element}>} items
 */
function buildList(items) {
  const root = document.createElement('ul');
  root.className = 'rules-list';
  const ROOT = Symbol('root');
  const listForParent = new Map([[ROOT, root]]);
  const lastLiAtDepth = [];

  for (const { depth, liEl } of items) {
    const parentKey = depth === 0 ? ROOT : lastLiAtDepth[depth - 1] || ROOT;
    let ul = listForParent.get(parentKey);
    if (!ul) {
      ul = document.createElement('ul');
      ul.className = 'rules-list rules-list--nested';
      parentKey.appendChild(ul);
      listForParent.set(parentKey, ul);
    }
    const li = document.createElement('li');
    li.textContent = liEl.textContent.trim();
    ul.appendChild(li);
    lastLiAtDepth[depth] = li;
  }

  // Any <li> that itself introduces a nested sub-list (whether or not it
  // has sibling bullets at its own level — e.g. "The winner receives the
  // following prizes:" is followed by 5 sibling bullets *and* later by a
  // continuation bullet at the same depth) reads as a lead-in sentence,
  // not a bullet point.
  root.querySelectorAll('li').forEach((li) => {
    if (li.querySelector(':scope > ul')) {
      li.classList.add('rules-list-lead');
    }
  });

  return root;
}

/**
 * Walks the exported doc body's direct children in order and appends the
 * reformatted result into `container`.
 * @param {HTMLElement} container
 * @param {HTMLElement} bodyEl - the parsed export's <body>
 */
function renderRulesDoc(container, bodyEl) {
  container.innerHTML = '';

  let seenAnyParagraph = false;
  // Front matter is the title/date/intro block before the doc's first
  // section — this doc never ends a front-matter line in ':', so the
  // first ':'-ending <p> is what closes it out, not the first list (the
  // very first section's intro line, e.g. "Rule Changes:", is itself the
  // thing that ends front matter, and it precedes its own list).
  let inFrontMatter = true;
  let pendingGroup = null; // { id, items: [{depth, liEl}] }

  function flushGroup() {
    if (pendingGroup && pendingGroup.items.length) {
      container.appendChild(buildList(pendingGroup.items));
    }
    pendingGroup = null;
  }

  for (const el of bodyEl.children) {
    if (el.tagName === 'UL') {
      const info = listIdAndDepth(el);
      const id = info ? info.id : '__unknown__';
      const depth = info ? info.depth : 0;
      if (!pendingGroup || pendingGroup.id !== id) {
        flushGroup();
        pendingGroup = { id, items: [] };
      }
      for (const liEl of el.children) {
        if (liEl.tagName === 'LI') pendingGroup.items.push({ depth, liEl });
      }
      continue;
    }

    if (el.tagName !== 'P') continue;
    const text = el.textContent.trim();
    if (!text) continue; // blank spacer paragraph

    flushGroup();

    const p = document.createElement('p');
    p.textContent = text;

    if (!seenAnyParagraph) {
      p.className = 'rules-title';
    } else if (text.endsWith(':')) {
      p.className = 'rules-subheading';
      inFrontMatter = false;
    } else if (inFrontMatter) {
      p.className = 'rules-intro';
    } else {
      p.className = 'rules-body';
    }
    seenAnyParagraph = true;
    container.appendChild(p);
  }

  flushGroup();
}

async function main() {
  await requireAuth(PASSWORD_HASH);

  const status = document.getElementById('status');
  const container = document.getElementById('doc-content');
  container.innerHTML = '';
  status.textContent = 'Loading the rules doc…';
  status.className = 'status-banner loading';
  status.hidden = false;

  const res = await fetch(`https://docs.google.com/document/d/${RULES_DOC_ID}/export?format=html`);
  if (!res.ok) throw new Error(`Doc fetch failed (${res.status})`);
  const html = await res.text();
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  renderRulesDoc(container, parsed.body);
  status.hidden = true;

  const link = document.createElement('p');
  link.className = 'doc-fallback-link';
  const a = document.createElement('a');
  a.href = `https://docs.google.com/document/d/${RULES_DOC_ID}/view`;
  a.textContent = 'View the source doc';
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
