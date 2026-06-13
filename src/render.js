'use strict';

const MarkdownIt = require('markdown-it');
const { classify, group } = require('./group');

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

function wordDiff(a, b) {
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
  let i = 0;
  let j = 0;
  let oa = '';
  let ob = '';
  const mark = (t) => `<span class="wq">${esc(t)}</span>`;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      oa += esc(A[i]);
      ob += esc(B[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      oa += mark(A[i]);
      i++;
    } else {
      ob += mark(B[j]);
      j++;
    }
  }
  while (i < m) oa += mark(A[i++]);
  while (j < n) ob += mark(B[j++]);
  return { oa, ob };
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

function renderHunk(hunk) {
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
      for (let p = 0; p < pairs; p++) diffs.push(wordDiff(dels[p].content, ins[p].content));
      dels.forEach((d, p) =>
        (rows += row('del', '-', d.lineNumber, p < pairs ? diffs[p].oa : esc(d.content)))
      );
      ins.forEach((d, p) =>
        (rows += row('ins', '+', d.lineNumber, p < pairs ? diffs[p].ob : esc(d.content)))
      );
    } else {
      const c = ch[k++];
      rows += row('ctx', ' ', c.newLineNumber, esc(c.content));
    }
  }
  return rows;
}

// Build a rendered-markdown preview from the *new* side of the hunks. A diff only
// carries changed hunks (not the whole file), so this previews changed sections.
function renderMarkdownPreview(file) {
  const blocks = [];
  for (const hunk of file.hunks) {
    const lines = hunk.changes
      .filter((c) => c.type !== 'delete')
      .map((c) => c.content);
    if (lines.length) blocks.push(lines.join('\n'));
  }
  if (!blocks.length) return '';
  return md.render(blocks.join('\n\n'));
}

function renderFile(file) {
  const name = basename(file.path);
  const dir = file.dir ? file.dir + '/' : '';
  const renameInfo =
    file.type === 'rename'
      ? `<div class="rename-info">${esc(file.oldPath)} → ${esc(file.newPath)}</div>`
      : '';

  let body;
  if (file.binary) {
    body = '<div class="empty">Binary file (no textual diff).</div>';
  } else if (!file.hunks || file.hunks.length === 0) {
    body = '<div class="empty">No textual changes.</div>';
  } else {
    const table =
      '<table class="diff">' + file.hunks.map(renderHunk).join('') + '</table>';
    if (isMarkdown(file.path)) {
      const preview = renderMarkdownPreview(file);
      const id = file.id;
      // Pure anchor/:target tabs — no JS — so the Preview can be opened both by
      // the in-file tab and by a jump link from the top, even in JS-disabled
      // viewers (iOS Quick Look, in-app file previews, etc.). The preview is
      // placed before the table so `:target ~ table.diff` can hide the diff.
      body =
        '<div class="vtabs">' +
        `<a class="vtab" href="#${id}">Diff</a>` +
        `<a class="vtab" href="#prev-${id}">Preview</a>` +
        '</div>' +
        `<div id="prev-${id}" class="preview markdown">${preview}<p class="preview-note">Preview of changed sections (new version).</p></div>` +
        table;
    } else {
      body = table;
    }
  }

  const open = file.collapsed ? '' : ' open';
  const counts = `<span class="add">+${file.additions}</span> <span class="del">−${file.deletions}</span>`;
  return `
<details class="file" id="${file.id}"${open} data-path="${esc(file.path)}">
  <summary>
    <span class="caret"></span>
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
  return `<a class="fl-item" href="${href}" data-path="${esc(file.path)}">
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
        `<div class="fl-group">${esc(g.dir || '(root)')}</div>` +
        g.files.map(fileListEntry).join('')
    )
    .join('');
  return `
<details class="filelist" open>
  <summary><span class="caret"></span><span class="fl-title">Files (${count})</span></summary>
  <div class="fl-body">${body}</div>
</details>`;
}

function renderGroup(g) {
  const label = g.dir || '(root)';
  const counts = `<span class="add">+${g.additions}</span> <span class="del">−${g.deletions}</span>`;
  return `
<details class="group" open data-dir="${esc(label)}">
  <summary>
    <span class="caret"></span>
    <span class="gname">${esc(label)}</span>
    <span class="gmeta">${g.files.length} file${g.files.length === 1 ? '' : 's'} ${counts}</span>
  </summary>
  ${g.files.map(renderFile).join('')}
</details>`;
}

function render(rawFiles, opts = {}) {
  const files = classify(rawFiles);
  files.forEach((f, i) => {
    f.id = 'f' + i;
  });
  const groups = group(files);
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);
  const title = opts.title || 'pocketdiff review';
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<style>${CSS}</style>
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
  </div>
  <div id="nomatch" class="nomatch" hidden>No files match the filter.</div>
</header>
<main>
${renderMarkdownBar(files)}
${renderFileList(groups, files.length)}
${groups.map(renderGroup).join('')}
</main>
<footer>Generated by pocketdiff · ${generated}</footer>
<script>${JS}</script>
</body>
</html>`;
}

const CSS = `
:root{
  /* off-white canvas, off-black ink, one locked accent */
  --bg:#fcfcfb; --fg:#1f2328; --muted:#656d76; --border:#d8dde3; --panel:#f3f4f6;
  --add-bg:#e6ffec; --add-fg:#1a7f37; --del-bg:#ffebe9; --del-fg:#cf222e;
  --add-num:#2da44e22; --del-num:#cf222e22; --code:#1f2328; --accent:#0969da;
  --add-word:#aceebb; --del-word:#ffc1b8;
  /* one corner-radius system: cards / controls / pills */
  --r-card:12px; --r-ctl:8px; --r-pill:999px;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --border:#30363d; --panel:#161b22;
    --add-bg:#12261e; --add-fg:#3fb950; --del-bg:#25171c; --del-fg:#f85149;
    --add-num:#3fb95022; --del-num:#f8514922; --code:#e6edf3; --accent:#58a6ff;
    --add-word:#2ea04366; --del-word:#f8514966;
  }
}
@media (prefers-reduced-motion: reduce){
  *{transition:none !important;animation:none !important;scroll-behavior:auto !important}
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.topbar{position:sticky;top:0;z-index:10;background:var(--bg);
  border-bottom:1px solid var(--border);padding:10px 12px;
  padding-top:max(10px,env(safe-area-inset-top))}
.title{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
.title strong{font-size:15px}
.summary{color:var(--muted);font-size:13px}
.controls{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
#filter{flex:1 1 160px;min-width:140px;font-size:16px;padding:8px 10px;
  border:1px solid var(--border);border-radius:var(--r-ctl);background:var(--bg);color:var(--fg)}
.controls button{font-size:13px;padding:8px 10px;border:1px solid var(--border);
  border-radius:var(--r-ctl);background:var(--panel);color:var(--fg);cursor:pointer;white-space:nowrap;
  transition:transform .08s ease}
.controls button:active{background:var(--border);transform:scale(.97)}
.controls button.active{background:var(--accent);color:#f7fbff;border-color:var(--accent)}
.nomatch{color:var(--muted);padding:8px 2px;font-size:13px}
main{padding:8px}
details{border:1px solid var(--border);border-radius:var(--r-card);margin:8px 0;overflow:hidden;background:var(--bg)}
details.group{background:var(--panel)}
details.group>summary{font-weight:600}
details.group>details.file{margin:8px}
summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;
  padding:10px 12px;user-select:none}
summary::-webkit-details-marker{display:none}
.caret{flex:none;width:8px;height:8px;border-right:2px solid var(--muted);
  border-bottom:2px solid var(--muted);transform:rotate(-45deg);transition:transform .15s}
details[open]>summary .caret{transform:rotate(45deg)}
.gname{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gmeta{margin-left:auto;color:var(--muted);font-size:12px;white-space:nowrap}
.fname{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.fname .dir{color:var(--muted)}
.counts{margin-left:auto;white-space:nowrap;font-size:12px}
.add{color:var(--add-fg);font-weight:600}
.del{color:var(--del-fg);font-weight:600}
.badge{font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:2px 6px;
  border-radius:var(--r-pill);border:1px solid var(--border);color:var(--muted);flex:none}
.badge.add{color:var(--add-fg)} .badge.del{color:var(--del-fg)}
.badge.rename,.badge.bin,.badge.noise,.badge.large{color:var(--accent)}
.rename-info{padding:6px 12px;color:var(--muted);font-family:ui-monospace,monospace;
  font-size:12px;border-top:1px solid var(--border)}
.empty{padding:12px;color:var(--muted);border-top:1px solid var(--border)}
table.diff{width:100%;border-collapse:collapse;border-top:1px solid var(--border);
  display:block;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:12.5px;line-height:1.45;-webkit-overflow-scrolling:touch}
table.diff tr{display:flex}
td.ln{flex:none;width:44px;text-align:right;padding:0 8px;color:var(--muted);
  user-select:none;background:var(--panel);position:sticky;left:0}
td.code{flex:1 1 auto;padding:0 8px;white-space:pre;color:var(--code);min-width:0}
.sign{display:inline-block;width:1ch;color:var(--muted)}
tr.ins td.code{background:var(--add-bg)} tr.ins td.ln{background:var(--add-num)}
tr.ins .sign{color:var(--add-fg)}
tr.del td.code{background:var(--del-bg)} tr.del td.ln{background:var(--del-num)}
tr.del .sign{color:var(--del-fg)}
.wq{border-radius:3px}
tr.ins .wq{background:var(--add-word)}
tr.del .wq{background:var(--del-word)}
tr.hunk-head td{color:var(--accent);background:var(--panel);font-size:12px}
body.wrap table.diff{display:table;table-layout:fixed;width:100%;overflow-x:visible}
body.wrap table.diff tr{display:table-row}
body.wrap td.ln{display:table-cell;position:static;vertical-align:top}
body.wrap td.code{display:table-cell;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
footer{color:var(--muted);text-align:center;font-size:12px;padding:16px;
  padding-bottom:max(16px,env(safe-area-inset-bottom))}
.hidden{display:none !important}
details.file{scroll-margin-top:128px}
/* top file list / jump index */
details.filelist{background:var(--panel)}
.fl-title{font-weight:600}
.fl-body{padding:4px 6px 8px}
.fl-group{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;
  color:var(--muted);padding:8px 8px 2px;text-transform:none}
.fl-item{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--fg);
  padding:8px;border-radius:var(--r-ctl)}
.fl-item:active{background:var(--border)}
.fl-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;min-width:0}
.fl-name .dir{color:var(--muted)}
.fl-item .counts{margin-left:auto}
.badge.md{color:#f7fbff;background:var(--accent);border-color:var(--accent)}
/* markdown bar at the top */
.mdbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;background:var(--panel);
  border:1px solid var(--border);border-radius:var(--r-card);padding:10px 12px;margin:8px 0}
.mdbar-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.md-chips{display:flex;flex-wrap:wrap;gap:6px}
.md-chip{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  text-decoration:none;color:var(--accent);background:var(--bg);border:1px solid var(--accent);
  border-radius:var(--r-pill);padding:4px 10px;transition:transform .08s ease}
.md-chip:active{background:var(--accent);color:var(--bg);transform:scale(.97)}
/* markdown diff/preview toggle — pure anchor/:target (no JS needed) */
.vtabs{display:flex;gap:4px;padding:8px 10px 0;border-top:1px solid var(--border)}
.vtab{font-size:12px;padding:5px 12px;border:1px solid var(--border);border-radius:var(--r-pill);
  background:var(--panel);color:var(--muted);text-decoration:none;cursor:pointer}
.vtab:active{background:var(--border)}
.preview{display:none;padding:4px 16px 12px;border-top:1px solid var(--border);scroll-margin-top:128px}
.preview:target{display:block}
.preview:target ~ table.diff{display:none}
.preview-note{color:var(--muted);font-size:12px;border-top:1px solid var(--border);
  padding-top:8px;margin:12px 0 0}
.markdown{line-height:1.6;word-wrap:break-word}
.markdown h1,.markdown h2,.markdown h3{line-height:1.3;margin:.8em 0 .4em}
.markdown h1{font-size:1.5em} .markdown h2{font-size:1.3em} .markdown h3{font-size:1.1em}
.markdown pre{background:var(--panel);padding:10px;border-radius:8px;overflow-x:auto}
.markdown code{background:var(--panel);padding:1px 5px;border-radius:5px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
.markdown pre code{padding:0;background:none}
.markdown blockquote{margin:.5em 0;padding-left:12px;border-left:3px solid var(--border);color:var(--muted)}
.markdown table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}
.markdown th,.markdown td{border:1px solid var(--border);padding:5px 9px}
.markdown img{max-width:100%}
.markdown a{color:var(--accent)}
/* tablet / landscape: roomier code, wider gutter */
@media (min-width:768px){
  main{max-width:980px;margin:0 auto}
  table.diff{font-size:13.5px}
  td.ln{width:56px}
}
`;

const JS = `
(function(){
  var filter=document.getElementById('filter');
  var nomatch=document.getElementById('nomatch');
  var files=Array.prototype.slice.call(document.querySelectorAll('details.file'));
  var groups=Array.prototype.slice.call(document.querySelectorAll('details.group'));
  var flItems=Array.prototype.slice.call(document.querySelectorAll('.fl-item'));
  function matches(path,q){return !q||path.toLowerCase().indexOf(q)!==-1;}
  function apply(){
    var q=filter.value.trim().toLowerCase();
    var any=false;
    files.forEach(function(f){
      var ok=matches(f.getAttribute('data-path'),q);
      f.classList.toggle('hidden',!ok);
      if(ok)any=true;
    });
    groups.forEach(function(g){
      g.classList.toggle('hidden',g.querySelectorAll('details.file:not(.hidden)').length===0);
    });
    flItems.forEach(function(a){
      a.classList.toggle('hidden',!matches(a.getAttribute('data-path'),q));
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
    groups.forEach(function(g){g.open=true;});
  });
  document.getElementById('collapse').addEventListener('click',function(){
    files.forEach(function(f){f.open=false;});
  });
})();
`;

module.exports = { render, esc };
