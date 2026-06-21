'use strict';

// Opt-in syntax highlighting (`--highlight`). highlight.js *core* plus a curated
// set of common languages — registering only these keeps the self-contained
// bundle small (full highlight.js is ~1 MB; this subset is a fraction). Unknown
// languages fall back to plain escaped text.
const hljs = require('highlight.js/lib/core');

const LANGS = {
  javascript: require('highlight.js/lib/languages/javascript'),
  typescript: require('highlight.js/lib/languages/typescript'),
  python: require('highlight.js/lib/languages/python'),
  json: require('highlight.js/lib/languages/json'),
  bash: require('highlight.js/lib/languages/bash'),
  go: require('highlight.js/lib/languages/go'),
  rust: require('highlight.js/lib/languages/rust'),
  xml: require('highlight.js/lib/languages/xml'),
  css: require('highlight.js/lib/languages/css'),
  yaml: require('highlight.js/lib/languages/yaml'),
};
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

// File extension -> registered language.
const EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', json: 'json',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  go: 'go', rs: 'rust',
  html: 'xml', xml: 'xml', vue: 'xml', svg: 'xml',
  css: 'css', scss: 'css',
  yml: 'yaml', yaml: 'yaml',
};

function langFor(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path || '');
  return m ? EXT[m[1].toLowerCase()] || null : null;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Highlight one line; returns escaped HTML with hljs token spans, or plain
// escaped text if the language is unknown or highlighting throws.
function highlightLine(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* fall through to plain */
    }
  }
  return esc(code);
}

// Overlay word-level "changed" spans onto already-highlighted HTML. `isChanged`
// is a predicate over raw character offsets. We close the `.wq` wrapper before
// every tag and reopen it on the next changed char, so the highlight spans and
// the change spans stay validly nested even when a changed run crosses a token.
function overlayChanged(html, isChanged) {
  let out = '';
  let i = 0;
  let raw = 0;
  let open = false;
  const openWq = () => {
    if (!open) {
      out += '<span class="wq">';
      open = true;
    }
  };
  const closeWq = () => {
    if (open) {
      out += '</span>';
      open = false;
    }
  };
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      closeWq();
      out += html.slice(i, end + 1);
      i = end + 1;
    } else if (ch === '&') {
      const end = html.indexOf(';', i);
      if (isChanged(raw)) openWq();
      else closeWq();
      out += html.slice(i, end + 1);
      raw++;
      i = end + 1;
    } else {
      if (isChanged(raw)) openWq();
      else closeWq();
      out += ch;
      raw++;
      i++;
    }
  }
  closeWq();
  return out;
}

// Compact dual-scheme theme (GitHub light/dark token colours), scoped to hljs
// classes, with its own CSS variables so it's self-contained.
const HL_DARK =
  '--hl-comment:#8a877e;--hl-kw:#c9a0f0;--hl-str:#5cc08a;--hl-num:#d6a060;' +
  '--hl-title:#9aa0e8;--hl-type:#62c3bd;--hl-attr:#62c3bd;--hl-meta:#8a877e';
const HL_CSS = `
:root{--hl-comment:#9a978c;--hl-kw:#8a5cc0;--hl-str:#2f7d52;--hl-num:#a96b2e;--hl-title:#565d99;--hl-type:#3f8a86;--hl-attr:#3f8a86;--hl-meta:#8b887d}
@media (prefers-color-scheme:dark){:root:not([data-theme]){${HL_DARK}}}
:root[data-theme="dark"]{${HL_DARK}}
.hljs-comment,.hljs-quote{color:var(--hl-comment);font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-section,.hljs-doctag{color:var(--hl-kw)}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-meta-string{color:var(--hl-str)}
.hljs-number,.hljs-symbol,.hljs-bullet{color:var(--hl-num)}
.hljs-title,.hljs-title.function_,.hljs-name,.hljs-selector-id,.hljs-selector-class{color:var(--hl-title)}
.hljs-type,.hljs-class .hljs-title,.hljs-built_in,.hljs-builtin-name{color:var(--hl-type)}
.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable,.hljs-property,.hljs-params{color:var(--hl-attr)}
.hljs-meta,.hljs-tag{color:var(--hl-meta)}
.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:600}
`;

module.exports = { langFor, highlightLine, overlayChanged, HL_CSS };
