'use strict';

const MarkdownIt = require('markdown-it');
const { classify, group, layerOf, domainKeyOf, LAYER_ORDER } = require('./group');
const { langFor, highlightLine, overlayChanged, HL_CSS } = require('./highlight');

const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function basename(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function isMarkdown(path) {
  return /\.(md|markdown|mdx)$/i.test(path);
}

// Token-level diff between two lines. Returns escaped HTML for each side with
// changed tokens wrapped in <span class="wq">. Uses an LCS over word/space/punct
// tokens — enough to make prose & markdown edits readable without being fancy.
function tokenize(s) {
  return s.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
}

// Per-side change segments from an LCS over tokens: each side is a list of
// { text, changed } runs. Kept separate from rendering so the same diff can be
// emitted plainly (wq spans) or composed with syntax highlighting.
function wordDiffSegs(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  const m = A.length;
  const n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aSegs = [];
  const bSegs = [];
  const push = (arr, text, changed) => {
    const last = arr[arr.length - 1];
    if (last && last.changed === changed) last.text += text;
    else arr.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      push(aSegs, A[i], false);
      push(bSegs, B[j], false);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(aSegs, A[i], true);
      i++;
    } else {
      push(bSegs, B[j], true);
      j++;
    }
  }
  while (i < m) push(aSegs, A[i++], true);
  while (j < n) push(bSegs, B[j++], true);
  return { aSegs, bSegs };
}

function segsHtml(segs) {
  return segs
    .map((s) => (s.changed ? `<span class="wq">${esc(s.text)}</span>` : esc(s.text)))
    .join('');
}

function segsChanged(segs) {
  const flags = [];
  for (const s of segs) for (let k = 0; k < s.text.length; k++) flags.push(s.changed);
  return (idx) => flags[idx] === true;
}

// One code cell: optional word-diff segments composed with optional syntax
// highlighting. `segs` is the per-side segment array (or null for context /
// unpaired lines); `lang`/`hi` enable highlighting.
function codeCell(content, segs, lang, hi) {
  if (hi) {
    const html = highlightLine(content, lang);
    return segs ? overlayChanged(html, segsChanged(segs)) : html;
  }
  return segs ? segsHtml(segs) : esc(content);
}

function fileBadge(file) {
  if (file.type === 'rename') return '<span class="badge rename">renamed</span>';
  if (file.type === 'add' || file.oldPath === '/dev/null')
    return '<span class="badge add">new</span>';
  if (file.type === 'delete' || file.newPath === '/dev/null')
    return '<span class="badge del">deleted</span>';
  if (file.binary) return '<span class="badge bin">binary</span>';
  if (file.noise) return '<span class="badge noise">generated</span>';
  if (file.large) return '<span class="badge large">large</span>';
  return '';
}

function row(cls, sign, num, codeHtml) {
  return `<tr class="${cls}"><td class="ln">${num == null ? '' : num}</td><td class="code"><span class="sign">${sign}</span>${codeHtml}</td></tr>`;
}

function renderHunk(hunk, lang, hi) {
  let rows = `<tr class="hunk-head"><td class="ln"></td><td class="code">${esc(hunk.content)}</td></tr>`;
  const ch = hunk.changes;
  for (let k = 0; k < ch.length; ) {
    if (ch[k].type === 'delete' || ch[k].type === 'insert') {
      // Gather a run of deletes immediately followed by a run of inserts so we
      // can highlight word-level changes between matched line pairs.
      const dels = [];
      const ins = [];
      while (k < ch.length && ch[k].type === 'delete') dels.push(ch[k++]);
      while (k < ch.length && ch[k].type === 'insert') ins.push(ch[k++]);
      const pairs = Math.min(dels.length, ins.length);
      const diffs = [];
      for (let p = 0; p < pairs; p++) diffs.push(wordDiffSegs(dels[p].content, ins[p].content));
      dels.forEach((d, p) =>
        (rows += row('del', '-', d.lineNumber, codeCell(d.content, p < pairs ? diffs[p].aSegs : null, lang, hi)))
      );
      ins.forEach((d, p) =>
        (rows += row('ins', '+', d.lineNumber, codeCell(d.content, p < pairs ? diffs[p].bSegs : null, lang, hi)))
      );
    } else {
      const c = ch[k++];
      rows += row('ctx', ' ', c.newLineNumber, codeCell(c.content, null, lang, hi));
    }
  }
  return rows;
}

// Strip a common whitespace prefix so a changed section lifted from a diff
// renders as real markdown instead of an indented code block. A changed block is
// usually uniformly indented (e.g. tab-indented list items) whose parent — the
// list item it hangs off — lives OUTSIDE the hunk, so markdown-it sees the bare
// indent and treats it as code. We compute the common prefix from the *inserted*
// lines (the actual change) and strip it from every line; context lines at other
// levels are left alone. Relative nesting within the inserts is preserved.
function dedent(changes) {
  const lines = changes.map((c) => c.content);
  const sample = changes.filter((c) => c.type === 'insert' && c.content.trim());
  const pool = (sample.length ? sample : changes.filter((c) => c.content.trim())).map(
    (c) => /^[ \t]*/.exec(c.content)[0]
  );
  if (!pool.length) return lines;
  let common = pool[0];
  for (const ind of pool) {
    let i = 0;
    while (i < common.length && common[i] === ind[i]) i++;
    common = common.slice(0, i);
    if (!common) return lines;
  }
  return lines.map((l) => (l.startsWith(common) ? l.slice(common.length) : l));
}

// Build a rendered-markdown preview from the *new* side of the hunks. A diff only
// carries changed hunks (not the whole file), so this previews changed sections.
function renderMarkdownPreview(file) {
  const blocks = [];
  for (const hunk of file.hunks) {
    const changes = hunk.changes.filter((c) => c.type !== 'delete');
    if (changes.length) blocks.push(dedent(changes).join('\n'));
  }
  if (!blocks.length) return '';
  return md.render(blocks.join('\n\n'));
}

// Like dedent() but preserves the change type per line, for the rendered diff.
function dedentChanges(changes) {
  const sample = changes.filter((c) => c.type === 'insert' && c.content.trim());
  const pool = (sample.length ? sample : changes.filter((c) => c.content.trim())).map(
    (c) => /^[ \t]*/.exec(c.content)[0]
  );
  let common = pool[0] || '';
  for (const ind of pool) {
    let i = 0;
    while (i < common.length && common[i] === ind[i]) i++;
    common = common.slice(0, i);
    if (!common) break;
  }
  if (!common) return changes;
  return changes.map((c) => ({
    type: c.type,
    content: c.content.startsWith(common) ? c.content.slice(common.length) : c.content,
  }));
}

// A *rendered* markdown diff: each contiguous run of inserted / removed / context
// lines is rendered as markdown, with the changed runs tinted (added = green,
// removed = struck-through red). Block-level, so a construct split across a +/-
// boundary can render imperfectly — the trade-off for a rendered (not raw +/-)
// view. Like the preview, it only covers the changed sections a diff carries.
function renderMarkdownRichDiff(file) {
  const out = [];
  for (const hunk of file.hunks) {
    const runs = [];
    for (const c of dedentChanges(hunk.changes)) {
      const kind = c.type === 'insert' ? 'ins' : c.type === 'delete' ? 'del' : 'ctx';
      const last = runs[runs.length - 1];
      if (last && last.kind === kind) last.lines.push(c.content);
      else runs.push({ kind, lines: [c.content] });
    }
    for (const run of runs) {
      const text = run.lines.join('\n');
      if (!text.trim()) continue;
      const html = md.render(text);
      if (run.kind === 'ins') out.push(`<div class="md-ins">${html}</div>`);
      else if (run.kind === 'del') out.push(`<div class="md-del">${html}</div>`);
      else out.push(html);
    }
  }
  return out.join('');
}

// Per-file group keys (dir/layer/domain) + change counts as data-attributes, so
// the in-page "Group by" control can re-bucket files client-side.
function groupAttrs(file) {
  return (
    ` data-dir="${esc(file.dir)}" data-layer="${esc(layerOf(file.path))}"` +
    ` data-domain="${esc(domainKeyOf(file.path))}" data-add="${file.additions}" data-del="${file.deletions}"`
  );
}

function renderFile(file, hi) {
  const lang = hi ? langFor(file.path) : null;
  const name = basename(file.path);
  const dir = file.dir ? file.dir + '/' : '';
  const renameInfo =
    file.type === 'rename'
      ? `<div class="rename-info">${esc(file.oldPath)} → ${esc(file.newPath)}</div>`
      : '';

  let body;
  if (file.binary) {
    // An inlined image thumbnail when the bytes were resolved (local diffs),
    // otherwise the plain note (a diff carries no binary content).
    body = file.image
      ? `<div class="imgpreview"><img src="${file.image}" alt="${esc(basename(file.path))}" loading="lazy"></div>`
      : '<div class="empty">Binary file (no textual diff).</div>';
  } else if (!file.hunks || file.hunks.length === 0) {
    body = '<div class="empty">No textual changes.</div>';
  } else {
    // Interleave a "skipped context" marker between hunks: a unified diff only
    // carries changed sections, so this makes the gaps (and why they can't be
    // expanded) explicit rather than silent.
    const skip =
      '<tr class="skip" title="Only changed sections are in a diff — the full file isn\'t included">' +
      '<td class="ln" aria-hidden="true">⋯</td><td class="code">unchanged lines not shown</td></tr>';
    const rows = file.hunks.map((h) => renderHunk(h, lang, hi)).join(skip);
    const table = '<table class="diff">' + rows + '</table>';
    if (isMarkdown(file.path)) {
      const preview = renderMarkdownPreview(file);
      const rich = renderMarkdownRichDiff(file);
      const id = file.id;
      // Three views via pure anchor/:target tabs (no JS, works in JS-disabled
      // viewers): Markdown (rendered new version, the default), Markdown diff
      // (rendered with inline ins/del), and Diff (raw +/-). DOM order is
      // mddiff → diffview → preview so each :target can hide the following
      // default-shown preview; "Diff" targets the file element itself (#id).
      body =
        '<div class="vtabs">' +
        `<a class="vtab" href="#prev-${id}">Markdown</a>` +
        `<a class="vtab" href="#md-${id}">Markdown diff</a>` +
        `<a class="vtab" href="#${id}">Diff</a>` +
        '</div>' +
        `<div id="md-${id}" class="mddiff markdown">${rich}<p class="preview-note">Rendered diff of the changed sections.</p></div>` +
        `<div class="diffview">${table}</div>` +
        `<div id="prev-${id}" class="preview markdown">${preview}<p class="preview-note">Rendered new version of the changed sections.</p></div>`;
    } else {
      body = table;
    }
  }

  const open = file.collapsed ? '' : ' open';
  const noiseAttr = file.noise ? ' data-noise="1"' : '';
  const counts = `<span class="add">+${file.additions}</span> <span class="del">−${file.deletions}</span>`;
  return `
<details class="file" id="${file.id}"${open} data-path="${esc(file.path)}"${noiseAttr}${groupAttrs(file)}>
  <summary>
    <span class="caret" aria-hidden="true"></span>
    <span class="fname"><span class="dir">${esc(dir)}</span>${esc(name)}</span>
    ${fileBadge(file)}
    <span class="counts">${counts}</span>
  </summary>
  ${renameInfo}
  ${body}
</details>`;
}

function fileListEntry(file) {
  const name = basename(file.path);
  const dir = file.dir ? file.dir + '/' : '';
  const markdown = isMarkdown(file.path);
  const md = markdown ? '<span class="badge md">md</span>' : '';
  // markdown jumps straight to its rendered preview; others to the file section
  const href = markdown ? `#prev-${file.id}` : `#${file.id}`;
  const noiseAttr = file.noise ? ' data-noise="1"' : '';
  return `<a class="fl-item" href="${href}" data-path="${esc(file.path)}"${noiseAttr}${groupAttrs(file)}>
    <span class="fl-name"><span class="dir">${esc(dir)}</span>${esc(name)}</span>
    ${md}${fileBadge(file)}
    <span class="counts"><span class="add">+${file.additions}</span> <span class="del">−${file.deletions}</span></span>
  </a>`;
}

// A prominent bar of markdown files at the very top — they're infrequent and
// easy to miss. Tapping one opens its rendered preview directly (pure :target).
function renderMarkdownBar(files) {
  const mds = files.filter((f) => isMarkdown(f.path));
  if (!mds.length) return '';
  const chips = mds
    .map(
      (f) =>
        `<a class="md-chip" href="#prev-${f.id}" data-path="${esc(f.path)}">${esc(basename(f.path))}</a>`
    )
    .join('');
  return `<div class="mdbar"><span class="mdbar-label">Markdown</span><div class="md-chips">${chips}</div></div>`;
}

// A jump-list at the top so infrequent files (e.g. markdown) aren't buried.
function renderFileList(groups, count) {
  const body = groups
    .map(
      (g) =>
        `<div class="fl-group">${esc(g.label || '(root)')}</div>` +
        g.files.map(fileListEntry).join('')
    )
    .join('');
  // Open by default so the grouped, anchor-linked jump index is usable WITHOUT
  // JS (a phone in-app preview). JS collapses it on load, since JS users have the
  // filename filter instead.
  return `
<details class="filelist" open>
  <summary><span class="caret"></span><span class="fl-title">Files (${count})</span></summary>
  <div class="fl-body">${body}</div>
</details>`;
}

function renderGroup(g, hi) {
  const label = g.label || '(root)';
  const counts = `<span class="add">+${g.additions}</span> <span class="del">−${g.deletions}</span>`;
  return `
<details class="group" open data-dir="${esc(label)}">
  <summary>
    <span class="caret"></span>
    <span class="gname">${esc(label)}</span>
    <span class="gmeta">${g.files.length} file${g.files.length === 1 ? '' : 's'} ${counts}</span>
  </summary>
  ${g.files.map((f) => renderFile(f, hi)).join('')}
</details>`;
}

function render(rawFiles, opts = {}) {
  const files = classify(rawFiles);
  files.forEach((f, i) => {
    f.id = 'f' + i;
  });
  const hi = !!opts.highlight;
  const groups = group(files, opts.group);
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const title = opts.title || 'pocketdiff review';
  const hasNoise = files.some((f) => f.noise);
  const hideNoiseBtn = hasNoise
    ? '<button id="hidenoise" type="button" title="Hide generated/lockfile noise">Hide noise</button>'
    : '';
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  // Force a theme with --light / --dark; default (no attribute) follows the system.
  const themeAttr = opts.theme === 'dark' || opts.theme === 'light' ? ` data-theme="${opts.theme}"` : '';
  // Active grouping (also the in-page default); the control re-buckets client-side.
  const gmode = opts.group === 'layer' || opts.group === 'domain' ? opts.group : 'dir';
  const gbtn = (m, label) =>
    `<button type="button" data-group="${m}"${gmode === m ? ' class="active" aria-pressed="true"' : ' aria-pressed="false"'}>${label}</button>`;

  return `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<script>document.documentElement.className+=' js'</script>
<style>${CSS}${hi ? HL_CSS : ''}</style>
</head>
<body class="wrap">
<header class="topbar">
  <div class="title">
    <strong>${esc(title)}</strong>
    <span class="summary">${files.length} file${files.length === 1 ? '' : 's'}
      <span class="add">+${totalAdd}</span> <span class="del">−${totalDel}</span></span>
  </div>
  <div class="controls">
    <input id="filter" type="search" placeholder="Filter by filename…" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button id="wrap" type="button" class="active" aria-pressed="true" title="Toggle line wrap">Wrap</button>
    <button id="expand" type="button">Expand all</button>
    <button id="collapse" type="button">Collapse all</button>
    ${hideNoiseBtn}
  </div>
  <div class="groupby" role="group" aria-label="Group files by">
    <span class="gb-label">Group</span>${gbtn('dir', 'Dir')}${gbtn('layer', 'Layer')}${gbtn('domain', 'Domain')}
  </div>
  <div id="nomatch" class="nomatch" hidden>No files match the filter.</div>
</header>
<main>
${renderMarkdownBar(files)}
${renderFileList(groups, files.length)}
<div id="groups">
${groups.map((g) => renderGroup(g, hi)).join('')}
</div>
</main>
<a id="totop" href="#" class="totop" title="Back to top" aria-label="Back to top" hidden>↑</a>
<footer>Generated by pocketdiff · ${generated}</footer>
<script>window.__pd={layerOrder:${JSON.stringify(LAYER_ORDER)}};</script>
<script>${JS}</script>
</body>
</html>`;
}

// Dark palette values, shared by the auto (media-query) and forced (--dark) rules.
const DARK_VARS =
  '--bg:#15161a;--fg:#e7e4dd;--muted:#8a877e;--border:#292a31;--panel:#1c1d22;' +
  '--add-bg:#112019;--add-fg:#5cc08a;--del-bg:#241317;--del-fg:#e07585;' +
  '--add-num:#5cc08a1f;--del-num:#e075851f;--code:#e7e4dd;--accent:#9096e0;' +
  '--add-word:#2f9c6a4d;--del-word:#cf5a6a4d';

const CSS = `
:root{
  /* pocketdiff's own palette — deliberately not a brand's. Warm paper canvas,
     soft ink, ONE restrained muted-indigo accent kept distinct from the diff
     colours, and gentle green/red tints. Tuned to be calm and legible on a
     small screen — the whole point of the tool. */
  --bg:#faf9f5; --fg:#262528; --muted:#8b887d; --border:#eae6dc; --panel:#f2eee7;
  --add-bg:#e9f2ec; --add-fg:#2f7d52; --del-bg:#f8eaed; --del-fg:#b6495a;
  --add-num:#2f7d5214; --del-num:#b6495a14; --code:#262528; --accent:#565d99;
  --add-word:#bfe0cb; --del-word:#eec6cd;
  /* one corner-radius system: cards / controls / pills */
  --r-card:12px; --r-ctl:8px; --r-pill:999px;
}
/* Dark palette applies (a) automatically with the system, but only when no theme
   is forced, and (b) explicitly when forced with --dark (data-theme="dark").
   --light forces light by setting data-theme="light", which the media query
   below intentionally excludes. */
@media (prefers-color-scheme: dark){:root:not([data-theme]){${DARK_VARS}}}
:root[data-theme="dark"]{${DARK_VARS}}
@media (prefers-reduced-motion: reduce){
  *{transition:none !important;animation:none !important;scroll-behavior:auto !important}
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
/* Header: calm, ghost actions */
.topbar{position:sticky;top:0;z-index:10;background:var(--bg);
  border-bottom:1px solid var(--border);padding:12px 16px;
  padding-top:max(12px,env(safe-area-inset-top))}
.title{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
.title strong{font-size:16px;font-weight:650;letter-spacing:-.01em}
.summary{color:var(--muted);font-size:13px}
/* JS-only controls: hidden unless JS ran (html.js), so a no-JS viewer (e.g. a
   phone in-app preview) never shows dead toggles. */
.controls,.groupby{display:none}
html.js .controls{display:flex;gap:14px;margin-top:10px;flex-wrap:wrap;align-items:center}
#filter{flex:1 1 100%;font-size:16px;padding:9px 12px;
  border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--bg);color:var(--fg)}
#filter:focus{outline:none;border-color:var(--accent)}
.controls button{font-size:13px;padding:2px 0;border:none;background:none;color:var(--muted);
  cursor:pointer;white-space:nowrap;transition:color .12s ease}
.controls button:active{color:var(--fg)}
.controls button.active{color:var(--accent);font-weight:600}
.nomatch{color:var(--muted);padding:10px 16px;font-size:13px}
main{padding:0}
/* Flat, full-width sections separated by hairlines (no nested cards) */
details{background:transparent}
summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;
  padding:11px 16px;user-select:none}
summary::-webkit-details-marker{display:none}
.caret{flex:none;width:7px;height:7px;border-right:1.5px solid var(--muted);
  border-bottom:1.5px solid var(--muted);transform:rotate(-45deg);transition:transform .15s;opacity:.8}
details[open]>summary .caret{transform:rotate(45deg)}
/* group = quiet section label */
details.group>summary{padding:18px 16px 6px}
.gname{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.04em;
  text-transform:uppercase;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gmeta{margin-left:auto;color:var(--muted);font-size:11px;white-space:nowrap}
/* file = flat row with a hairline divider above */
/* content-visibility lets the browser skip rendering off-screen files until
   you scroll near them — big perf win on huge diffs, no JS, no effect on
   find-in-page or JS-disabled viewers. */
details.file{border-top:1px solid var(--border);scroll-margin-top:140px;
  content-visibility:auto;contain-intrinsic-size:auto 480px}
.fname{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.fname .dir{color:var(--muted)}
.counts{margin-left:auto;white-space:nowrap;font-size:12px}
.add{color:var(--add-fg);font-weight:600}
.del{color:var(--del-fg);font-weight:600}
.badge{font-size:10px;text-transform:uppercase;letter-spacing:.03em;padding:1px 6px;
  border-radius:var(--r-pill);border:none;background:var(--panel);color:var(--muted);flex:none}
.badge.add{color:var(--add-fg);background:transparent}
.badge.del{color:var(--del-fg);background:transparent}
.badge.rename,.badge.bin,.badge.noise,.badge.large{color:var(--muted)}
.rename-info{padding:4px 16px 10px;color:var(--muted);font-family:ui-monospace,monospace;font-size:12px}
.empty{padding:4px 16px 14px;color:var(--muted)}
.imgpreview{padding:8px 16px 16px}
.imgpreview img{max-width:100%;height:auto;border:1px solid var(--border);border-radius:var(--r-ctl);
  background:repeating-conic-gradient(var(--panel) 0% 25%,transparent 0% 50%) 50%/16px 16px}
table.diff{width:100%;border-collapse:collapse;
  display:block;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:12.5px;line-height:1.5;-webkit-overflow-scrolling:touch}
table.diff tr{display:flex}
td.ln{flex:none;width:38px;text-align:right;padding:0 8px;color:var(--muted);
  user-select:none;position:sticky;left:0;background:var(--bg);opacity:.75}
td.code{flex:1 1 auto;padding:0 12px 0 4px;white-space:pre;color:var(--code);min-width:0}
.sign{display:inline-block;width:1ch;color:var(--muted)}
tr.ins td.code{background:var(--add-bg)} tr.ins td.ln{background:var(--add-num)}
tr.ins .sign{color:var(--add-fg)}
tr.del td.code{background:var(--del-bg)} tr.del td.ln{background:var(--del-num)}
tr.del .sign{color:var(--del-fg)}
.wq{border-radius:3px;padding:0 1px}
tr.ins .wq{background:var(--add-word)}
tr.del .wq{background:var(--del-word)}
tr.hunk-head td{color:var(--muted);font-size:11px;padding-top:6px;padding-bottom:2px}
tr.hunk-head td.code{background:transparent}
body.wrap table.diff{display:table;table-layout:fixed;width:100%;overflow-x:visible}
body.wrap table.diff tr{display:table-row}
body.wrap td.ln{display:table-cell;position:static;vertical-align:top}
body.wrap td.code{display:table-cell;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
footer{color:var(--muted);text-align:center;font-size:12px;padding:20px;
  padding-bottom:max(20px,env(safe-area-inset-bottom))}
.hidden{display:none !important}
/* top jump index */
details.filelist{border-bottom:1px solid var(--border)}
.fl-title{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.fl-body{padding:0 8px 10px}
.fl-group{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.04em;
  text-transform:uppercase;color:var(--muted);padding:10px 8px 2px}
.fl-item{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--fg);
  padding:9px 8px;border-radius:var(--r-ctl)}
.fl-item:active{background:var(--panel)}
.fl-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.fl-name .dir{color:var(--muted)}
.fl-item .counts{margin-left:auto}
.badge.md{color:var(--accent);background:transparent;border:1px solid var(--accent)}
/* markdown bar at the top */
.mdbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:14px 16px;
  border-bottom:1px solid var(--border)}
.mdbar-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.md-chips{display:flex;flex-wrap:wrap;gap:6px}
.md-chip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  text-decoration:none;color:var(--accent);background:transparent;border:1px solid var(--accent);
  border-radius:var(--r-pill);padding:4px 11px;transition:transform .08s ease}
.md-chip:active{background:var(--accent);color:var(--bg);transform:scale(.97)}
/* markdown diff/preview toggle — pure anchor/:target (no JS needed).
   Markdown files default to the rendered Preview; the diff is one tap away.
   Initial load (no target) and the Preview tab (prev-id) both show the preview;
   only targeting the file element itself (the Diff tab) flips to the diff. */
.vtabs{display:flex;gap:6px;padding:10px 16px 2px}
.vtab{font-size:12px;padding:5px 13px;border:1px solid var(--border);border-radius:var(--r-pill);
  background:transparent;color:var(--muted);text-decoration:none;cursor:pointer}
.vtab:active{background:var(--panel)}
/* three markdown views via pure :target — default Markdown (.preview), Markdown
   diff (.mddiff), raw Diff (.diffview, shown when the file element is targeted).
   DOM order is mddiff → diffview → preview, so each :target hides the trailing
   default-shown preview. */
.preview,.mddiff{padding:2px 16px 14px;scroll-margin-top:140px}
.preview{display:block}
.mddiff,.diffview{display:none}
.mddiff:target{display:block}
.mddiff:target ~ .preview,.mddiff:target ~ .diffview{display:none}
details.file:target .mddiff,details.file:target .preview{display:none}
details.file:target .diffview{display:block}
.preview:target{display:block}
/* rendered-diff tints: added green, removed struck-through red */
.md-ins,.md-del{padding:1px 10px;margin:6px 0;border-radius:6px;border-left:3px solid}
.md-ins{background:var(--add-bg);border-left-color:var(--add-fg)}
.md-del{background:var(--del-bg);border-left-color:var(--del-fg);text-decoration:line-through;opacity:.8}
.md-ins>:first-child,.md-del>:first-child{margin-top:0}
.md-ins>:last-child,.md-del>:last-child{margin-bottom:0}
.preview-note{color:var(--muted);font-size:12px;border-top:1px solid var(--border);
  padding-top:8px;margin:14px 0 0}
.markdown{line-height:1.65;word-wrap:break-word}
.markdown h1,.markdown h2,.markdown h3{line-height:1.25;margin:.9em 0 .4em;letter-spacing:-.01em}
.markdown h1{font-size:1.5em} .markdown h2{font-size:1.25em} .markdown h3{font-size:1.05em}
.markdown pre{background:var(--panel);padding:12px;border-radius:var(--r-ctl);overflow-x:auto}
.markdown code{background:var(--panel);padding:1px 5px;border-radius:6px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
.markdown pre code{padding:0;background:none}
.markdown blockquote{margin:.6em 0;padding-left:14px;border-left:2px solid var(--border);color:var(--muted)}
.markdown table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}
.markdown th,.markdown td{border:1px solid var(--border);padding:6px 10px}
.markdown img{max-width:100%}
.markdown a{color:var(--accent)}
/* skipped-context marker between hunks (a diff has no full file to expand into) */
tr.skip td{color:var(--muted);font-size:11px;padding:5px 12px;background:transparent;
  border-top:1px dashed var(--border);border-bottom:1px dashed var(--border);user-select:none}
tr.skip td.ln{font-size:13px;opacity:.6}
/* accessibility: don't rely on colour alone — strike removed words, and give
   keyboard users a visible focus ring everywhere */
tr.del .wq{text-decoration:line-through;text-decoration-thickness:1px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
.controls button.active{text-decoration:underline;text-underline-offset:3px}
/* in-page "Group by" segmented control (JS-only; revealed by html.js) */
html.js .groupby{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
.gb-label{font-size:12px;color:var(--muted);margin-right:2px}
.groupby button{font-size:12px;padding:3px 11px;border:1px solid var(--border);border-radius:var(--r-pill);
  background:transparent;color:var(--muted);cursor:pointer}
.groupby button.active{color:var(--accent);border-color:var(--accent);font-weight:600}
body.scrolled .groupby{display:none}
/* compact the header once you've scrolled — keep title + filter, drop the
   secondary buttons so more of the diff is visible (JS adds .scrolled) */
body.scrolled .topbar{padding-top:max(8px,env(safe-area-inset-top));padding-bottom:8px}
body.scrolled .topbar .title strong{font-size:14px}
body.scrolled #wrap,body.scrolled #expand,body.scrolled #collapse,body.scrolled #hidenoise{display:none}
body.scrolled .controls{margin-top:8px}
/* back-to-top: appears once scrolled */
.totop{position:fixed;right:16px;bottom:max(16px,env(safe-area-inset-bottom));z-index:20;
  width:42px;height:42px;display:flex;align-items:center;justify-content:center;
  text-decoration:none;font-size:20px;color:var(--fg);background:var(--panel);
  border:1px solid var(--border);border-radius:var(--r-pill);
  box-shadow:0 2px 10px #0003;opacity:.92}
.totop[hidden]{display:none}
.totop:active{transform:scale(.94)}
/* tablet / landscape: roomier code, centered column */
@media (min-width:768px){
  main{max-width:1000px;margin:0 auto}
  table.diff{font-size:13.5px}
  td.ln{width:48px}
}
`;

const JS = `
(function(){
  var filter=document.getElementById('filter');
  var nomatch=document.getElementById('nomatch');
  var files=Array.prototype.slice.call(document.querySelectorAll('details.file'));
  var flItems=Array.prototype.slice.call(document.querySelectorAll('.fl-item'));
  var hidenoise=document.getElementById('hidenoise');
  // The jump index is open by default for no-JS viewers; with JS the filter is
  // the primary nav, so collapse it to save space.
  var fl=document.querySelector('details.filelist'); if(fl)fl.open=false;
  function liveGroups(){return Array.prototype.slice.call(document.querySelectorAll('details.group'));}
  function matches(path,q){return !q||path.toLowerCase().indexOf(q)!==-1;}
  function shown(el,q,hide){
    return matches(el.getAttribute('data-path'),q) && !(hide&&el.hasAttribute('data-noise'));
  }
  function apply(){
    var q=filter.value.trim().toLowerCase();
    var hide=!!(hidenoise&&hidenoise.classList.contains('active'));
    var any=false;
    files.forEach(function(f){
      var ok=shown(f,q,hide);
      f.classList.toggle('hidden',!ok);
      if(ok)any=true;
    });
    liveGroups().forEach(function(g){
      g.classList.toggle('hidden',g.querySelectorAll('details.file:not(.hidden)').length===0);
    });
    flItems.forEach(function(a){
      a.classList.toggle('hidden',!shown(a,q,hide));
    });
    document.querySelectorAll('.fl-group').forEach(function(h){
      var sib=h.nextElementSibling,vis=false;
      while(sib&&sib.classList.contains('fl-item')){
        if(!sib.classList.contains('hidden'))vis=true;
        sib=sib.nextElementSibling;
      }
      h.classList.toggle('hidden',!vis);
    });
    nomatch.hidden=any;
  }
  filter.addEventListener('input',apply);
  // jump from the file list to a (possibly collapsed) file section.
  // markdown preview links (#prev-*) are left to native :target/anchor behavior.
  document.addEventListener('click',function(e){
    var link=e.target.closest&&e.target.closest('a.fl-item,a.md-chip');
    if(!link)return;
    var href=link.getAttribute('href');
    if(href.indexOf('#prev-')===0){
      // ensure the file is expanded, then let the browser handle :target + scroll
      var prev=document.getElementById(href.slice(1));
      var d=prev&&prev.closest('details');
      while(d){d.open=true;d=d.parentElement&&d.parentElement.closest('details');}
      return;
    }
    e.preventDefault();
    var el=document.getElementById(href.slice(1));
    if(!el)return;
    var grp=el.closest('details.group');
    if(grp)grp.open=true;
    el.open=true;
    el.scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.getElementById('wrap').addEventListener('click',function(){
    var on=document.body.classList.toggle('wrap');
    this.classList.toggle('active',on);
    this.setAttribute('aria-pressed',String(on));
  });
  document.getElementById('expand').addEventListener('click',function(){
    files.forEach(function(f){if(!f.classList.contains('hidden'))f.open=true;});
    liveGroups().forEach(function(g){g.open=true;});
  });
  document.getElementById('collapse').addEventListener('click',function(){
    files.forEach(function(f){f.open=false;});
  });
  if(hidenoise){
    hidenoise.addEventListener('click',function(){
      var on=this.classList.toggle('active');
      this.setAttribute('aria-pressed',String(on));
      this.textContent=on?'Show noise':'Hide noise';
      apply();
    });
  }
  // Compact the header + reveal back-to-top once scrolled (rAF-throttled).
  var totop=document.getElementById('totop');
  var ticking=false;
  function onScroll(){
    if(ticking)return;ticking=true;
    requestAnimationFrame(function(){
      var y=window.pageYOffset||document.documentElement.scrollTop;
      document.body.classList.toggle('scrolled',y>120);
      if(totop)totop.hidden=y<400;
      ticking=false;
    });
  }
  window.addEventListener('scroll',onScroll,{passive:true});
  if(totop)totop.addEventListener('click',function(e){
    e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});
  });

  // --- in-page "Group by" switcher: re-bucket the SAME file elements ---------
  function gesc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function num(e,a){return parseInt(e.getAttribute(a),10)||0;}
  function byPath(a,b){return (a.getAttribute('data-path')||'').localeCompare(b.getAttribute('data-path')||'');}
  function bucket(els,mode){
    var map={},labels=[];
    els.forEach(function(e){var k=e.getAttribute('data-'+mode)||'';if(!map[k]){map[k]=[];labels.push(k);}map[k].push(e);});
    if(mode==='layer'){
      var LO=(window.__pd&&window.__pd.layerOrder)||[];
      labels.sort(function(a,b){var ia=LO.indexOf(a),ib=LO.indexOf(b);ia=ia<0?99:ia;ib=ib<0?99:ib;return ia-ib||a.localeCompare(b);});
    } else { labels.sort(function(a,b){return a.localeCompare(b);}); }
    labels.forEach(function(l){map[l].sort(byPath);});
    return {map:map,labels:labels};
  }
  function rebuildMain(mode){
    var root=document.getElementById('groups');if(!root)return;
    var b=bucket(Array.prototype.slice.call(root.querySelectorAll('details.file')),mode);
    root.innerHTML='';
    b.labels.forEach(function(label){
      var items=b.map[label],add=0,del=0;
      items.forEach(function(f){add+=num(f,'data-add');del+=num(f,'data-del');});
      var det=document.createElement('details');
      det.className='group';det.open=true;det.setAttribute('data-dir',label);
      var sum=document.createElement('summary');
      sum.innerHTML='<span class="caret"></span><span class="gname">'+gesc(label||'(root)')+
        '</span><span class="gmeta">'+items.length+' file'+(items.length===1?'':'s')+
        ' <span class="add">+'+add+'</span> <span class="del">−'+del+'</span></span>';
      det.appendChild(sum);
      items.forEach(function(f){det.appendChild(f);});
      root.appendChild(det);
    });
  }
  function rebuildList(mode){
    var body=document.querySelector('.fl-body');if(!body)return;
    var b=bucket(Array.prototype.slice.call(body.querySelectorAll('.fl-item')),mode);
    body.innerHTML='';
    b.labels.forEach(function(label){
      var h=document.createElement('div');h.className='fl-group';h.textContent=label||'(root)';
      body.appendChild(h);
      b.map[label].forEach(function(a){body.appendChild(a);});
    });
  }
  var groupby=document.querySelector('.groupby');
  if(groupby){
    groupby.addEventListener('click',function(e){
      var btn=e.target.closest&&e.target.closest('button[data-group]');if(!btn)return;
      var mode=btn.getAttribute('data-group');
      rebuildMain(mode);rebuildList(mode);
      Array.prototype.slice.call(groupby.querySelectorAll('button')).forEach(function(x){
        var on=x.getAttribute('data-group')===mode;
        x.classList.toggle('active',on);x.setAttribute('aria-pressed',String(on));
      });
      apply();
    });
  }
})();
`;

module.exports = { render, esc };
