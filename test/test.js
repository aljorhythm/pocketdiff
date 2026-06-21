'use strict';

const assert = require('assert');
const parser = require('gitdiff-parser');
const { render } = require('../src/render');
const { classify, group } = require('../src/group');
const { toDiffUrl, classifyInput } = require('../src/input');

const SAMPLE = `diff --git a/src/app.js b/src/app.js
index 1234567..89abcde 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,4 +1,5 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 console.log(x);
diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt
diff --git a/package-lock.json b/package-lock.json
index aaa..bbb 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,2 +1,2 @@
-  "version": "1.0.0"
+  "version": "1.0.1"
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/logo.png differ
diff --git a/docs/README.md b/docs/README.md
index 333ccc..444ddd 100644
--- a/docs/README.md
+++ b/docs/README.md
@@ -1,3 +1,3 @@
 # Title
-A simple service.
+A **realtime** service.
`;

const files = classify(parser.parse(SAMPLE));
files.forEach((f, i) => {
  f.id = 'f' + i; // mirror the id assignment render() does internally
});
const html = render(parser.parse(SAMPLE), { title: 'Test review' });

// classification
const lock = files.find((f) => f.path === 'package-lock.json');
const app = files.find((f) => f.path === 'src/app.js');
assert(lock.noise === true, 'lockfile flagged as noise');
assert(lock.collapsed === true, 'lockfile collapsed by default');
assert(app.collapsed === false, 'source file expanded by default');
assert(app.additions === 2 && app.deletions === 1, 'counts correct');

// grouping — by directory (default)
const groups = group(files);
const dirs = groups.map((g) => g.label);
assert(dirs.includes('src'), 'src group exists');

// grouping — by layer and by domain (crude semantic heuristics)
const semFiles = classify(
  parser.parse(
    'diff --git a/src/user.service.ts b/src/user.service.ts\nindex 1..2 100644\n--- a/src/user.service.ts\n+++ b/src/user.service.ts\n@@ -1 +1 @@\n-a\n+b\n' +
      'diff --git a/api/users.controller.ts b/api/users.controller.ts\nindex 1..2 100644\n--- a/api/users.controller.ts\n+++ b/api/users.controller.ts\n@@ -1 +1 @@\n-a\n+b\n' +
      'diff --git a/db/orderRepository.ts b/db/orderRepository.ts\nindex 1..2 100644\n--- a/db/orderRepository.ts\n+++ b/db/orderRepository.ts\n@@ -1 +1 @@\n-a\n+b\n' +
      'diff --git a/x/user.test.ts b/x/user.test.ts\nindex 1..2 100644\n--- a/x/user.test.ts\n+++ b/x/user.test.ts\n@@ -1 +1 @@\n-a\n+b\n'
  )
);
const byLayer = group(semFiles, 'layer').map((g) => g.label);
assert(byLayer.includes('services') && byLayer.includes('controllers'), 'layer groups by role');
assert(byLayer.includes('repositories') && byLayer.includes('tests'), 'repo + test layers detected');
const byDomain = group(semFiles, 'domain');
const userGroup = byDomain.find((g) => g.label === 'user');
// user.service.ts, users.controller.ts and user.test.ts all key to "user"
assert(userGroup && userGroup.files.length === 3, 'domain clusters user.* across folders');
assert(byDomain.some((g) => g.label === 'order'), 'orderRepository keys to order domain');

// in-page group switcher: control + per-file group keys + client data
const semHtml = render(parser.parse(SAMPLE), {});
assert(semHtml.includes('class="groupby"'), 'group-by control present');
assert(/data-group="dir"[^>]*class="active"/.test(semHtml), 'dir is the default active grouping');
assert(semHtml.includes('data-group="layer"') && semHtml.includes('data-group="domain"'), 'layer+domain options');
assert(semHtml.includes('id="groups"'), 'groups container for client re-bucketing');
assert(/data-layer="/.test(semHtml) && /data-domain="/.test(semHtml), 'files carry layer+domain keys');
assert(semHtml.includes('window.__pd'), 'client gets the layer order');

// image preview: a binary image with resolved bytes renders inline, file open
const imgHtml = render(
  [{ type: 'add', oldPath: '/dev/null', newPath: 'assets/logo.png', hunks: [], image: 'data:image/png;base64,AAAA' }],
  {}
);
assert(imgHtml.includes('class="imgpreview"'), 'image preview block present');
assert(imgHtml.includes('src="data:image/png;base64,AAAA"'), 'image inlined as data URI');
assert(/id="f\d+" open /.test(imgHtml), 'image file is open by default (it is the content)');
// no bytes -> the plain binary note (a diff carries no image data)
const noImg = render([{ type: 'add', oldPath: '/dev/null', newPath: 'logo.png', hunks: [] }], {});
assert(noImg.includes('Binary file'), 'binary note when bytes were not resolved');

// spaced filenames: git appends a trailing tab in the +++ line — strip it so the
// extension is still detected (markdown preview) and the path renders cleanly
const spaced = render(
  [
    {
      type: 'add',
      oldPath: '/dev/null',
      newPath: 'docs/Naming brief.md\t',
      hunks: [{ content: '@@ -0,0 +1 @@', changes: [{ type: 'insert', content: '# Title', lineNumber: 1 }] }],
    },
  ],
  {}
);
assert(spaced.includes('class="preview markdown"'), 'markdown detected despite trailing tab');
assert(spaced.includes('class="mdbar"'), 'spaced-name markdown surfaced in the bar');
assert(!/Naming brief\.md\t/.test(spaced), 'trailing tab stripped from the path');

// progressive enhancement: JS-only controls hidden unless JS runs; the grouped
// jump-index is open by default so a no-JS viewer can navigate via anchors
assert(html.includes("className+=' js'"), 'early script marks JS availability');
assert(html.includes('.controls,.groupby{display:none}'), 'JS-only controls hidden by default');
assert(html.includes('html.js .controls{display:flex'), 'controls revealed only with JS');
assert(/class="filelist" open/.test(html), 'jump index open by default (no-JS nav)');

// rendered HTML
assert(html.startsWith('<!DOCTYPE html>'), 'has doctype');
assert(html.includes('width=device-width'), 'has viewport meta');
assert(html.includes('id="filter"'), 'has filter input');
assert(/id="f\d+" open data-path="src\/app\.js"/.test(html), 'app.js open');
assert(/class="file" id="f\d+" data-path="package-lock\.json"/.test(html), 'lockfile not open');
assert(html.includes('renamed'), 'rename badge present');
assert(html.includes('Binary file'), 'binary handled');
assert(!/https?:\/\/[^"']+\.(?:js|css)/.test(html), 'no external CDN assets');

// UX features
assert(html.includes('content-visibility:auto'), 'lazy render via content-visibility');
assert(html.includes('id="totop"'), 'back-to-top control present');
// SAMPLE has package-lock.json (noise) -> hide-noise toggle + data-noise marks
assert(html.includes('id="hidenoise"'), 'hide-noise toggle present when noise exists');
assert(/data-path="package-lock\.json" data-noise="1"/.test(html), 'noise file marked');
// no hide-noise button when there's nothing noisy
const cleanHtml = render(
  parser.parse('diff --git a/a.js b/a.js\nindex 1..2 100644\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n'),
  {}
);
assert(!cleanHtml.includes('id="hidenoise"'), 'no hide-noise button without noise');
// skipped-context marker appears between hunks of a multi-hunk file
const twoHunk = render(
  parser.parse(
    'diff --git a/x.js b/x.js\nindex 1..2 100644\n--- a/x.js\n+++ b/x.js\n' +
      '@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -20,2 +20,2 @@\n-y\n+Y\n z\n'
  ),
  {}
);
assert(twoHunk.includes('class="skip"'), 'skip marker between hunks');
assert(!cleanHtml.includes('class="skip"'), 'no skip marker for a single-hunk file');
// removed words get a non-colour cue (strike-through) in CSS
assert(html.includes('tr.del .wq{text-decoration:line-through'), 'removed words struck through');

// word-level highlighting on the edited markdown line
assert(html.includes('class="wq"'), 'word-level highlight present');
// markdown gets a pure anchor/:target Preview tab + rendered preview
const mdFile = files.find((f) => f.path === 'docs/README.md');
// three markdown views: Markdown (rendered new, default), Markdown diff, raw Diff
assert(html.includes(`<a class="vtab" href="#prev-${mdFile.id}">Markdown</a>`), 'markdown tab present');
assert(html.includes(`<a class="vtab" href="#md-${mdFile.id}">Markdown diff</a>`), 'markdown-diff tab present');
assert(html.includes(`id="prev-${mdFile.id}" class="preview markdown"`), 'rendered (markdown) block present');
assert(html.includes(`id="md-${mdFile.id}" class="mddiff markdown"`), 'rendered-diff block present');
assert(html.includes('<strong>realtime</strong>'), 'markdown rendered');
// the rendered diff tints the removed and added lines (block-level)
assert(html.includes('class="md-del"') && html.includes('class="md-ins"'), 'rendered diff marks del + ins');
// rendered (Markdown) shown by default; the others hidden until :target
assert(html.includes('<div class="diffview">'), 'raw diff wrapped for toggling');
assert(/\.preview\{display:block[^}]*\}/.test(html), 'rendered markdown shown by default');
assert(html.includes('.mddiff,.diffview{display:none}'), 'markdown-diff + raw hidden by default');
// tab/indented changed sections are dedented so they render as real markdown
// (a list) instead of an indented code block (markdown-it's 4-space/tab rule)
const indented = render(
  parser.parse(
    'diff --git a/d.md b/d.md\nindex 1..2 100644\n--- a/d.md\n+++ b/d.md\n' +
      '@@ -1,2 +1,3 @@\n\t- [Old](u)\n+\t- [New](u) - desc\n\t- [Keep](u)\n'
  ),
  {}
);
assert(indented.includes('<li>'), 'indented list renders as a list in the preview');
assert(!/<pre>/.test(indented), 'indented changed section is not a code block');

// opt-in syntax highlighting (default OFF, no behaviour change)
assert(!html.includes('hljs-'), 'no syntax highlighting by default');
assert(!html.includes('--hl-kw'), 'no highlight theme injected by default');
const hl = render(parser.parse(SAMPLE), { highlight: true });
assert(hl.includes('hljs-'), 'syntax highlighting applied with highlight:true');
assert(hl.includes('--hl-kw'), 'highlight theme injected only when enabled');
// the word-level diff still composes with highlighting (both span types present)
assert(hl.includes('class="wq"'), 'word-diff preserved alongside highlighting');

// theme: default follows the system (no attribute); --light/--dark force it
assert(/<html lang="en">/.test(html), 'default theme follows the system (no data-theme)');
const dark = render(parser.parse(SAMPLE), { theme: 'dark' });
assert(dark.includes('<html lang="en" data-theme="dark">'), 'forced dark sets data-theme');
assert(dark.includes(':root[data-theme="dark"]{'), 'forced-dark vars present');
const light = render(parser.parse(SAMPLE), { theme: 'light' });
assert(light.includes('<html lang="en" data-theme="light">'), 'forced light sets data-theme');
// a bogus theme value is ignored (stays auto)
assert(/<html lang="en">/.test(render(parser.parse(SAMPLE), { theme: 'x' })), 'unknown theme ignored');
// markdown files surfaced in a top bar, linking to the preview
assert(html.includes('class="mdbar"'), 'markdown bar present');
assert(html.includes(`class="md-chip" href="#prev-${mdFile.id}"`), 'md chip links to preview');
// the file-list entry for markdown also opens the preview
assert(html.includes(`class="fl-item" href="#prev-${mdFile.id}"`), 'md list entry opens preview');
// no markdown bar when there are no markdown files
const { render: render2 } = require('../src/render');
const noMd = render2(
  require('gitdiff-parser').parse(
    'diff --git a/a.js b/a.js\nindex 1..2 100644\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n'
  ),
  {}
);
assert(!noMd.includes('class="mdbar"'), 'no markdown bar without markdown files');

// top file list / jump index
assert(html.includes('class="filelist"'), 'file list present');
assert(
  (html.match(/class="fl-item"/g) || []).length === parser.parse(SAMPLE).length,
  'one list entry per file'
);
assert(/class="badge md"/.test(html), 'markdown flagged in the list');

// input auto-detection
assert.equal(
  toDiffUrl('https://github.com/owner/repo/pull/42'),
  'https://api.github.com/repos/owner/repo/pulls/42',
  'PR url -> REST API pulls endpoint'
);
assert.equal(
  toDiffUrl('https://github.com/o/r/pull/42/files'),
  'https://api.github.com/repos/o/r/pulls/42',
  'PR /files url -> REST API pulls endpoint'
);
assert.equal(
  toDiffUrl('https://github.com/o/r/compare/a...b'),
  'https://api.github.com/repos/o/r/compare/a...b',
  'compare url -> REST API compare endpoint'
);
assert.equal(
  toDiffUrl('https://github.com/o/r/commit/abc123'),
  'https://api.github.com/repos/o/r/commits/abc123',
  'commit url -> REST API commits endpoint'
);
// GitLab — commit / merge request / compare pages map to the raw `.diff`.
assert.equal(
  toDiffUrl('https://gitlab.com/group/proj/-/commit/abcdef0'),
  'https://gitlab.com/group/proj/-/commit/abcdef0.diff',
  'GitLab commit url -> .diff'
);
assert.equal(
  toDiffUrl('https://gitlab.com/group/sub/proj/-/merge_requests/7/diffs'),
  'https://gitlab.com/group/sub/proj/-/merge_requests/7.diff',
  'GitLab nested-group MR url (with /diffs) -> .diff'
);
assert.equal(
  toDiffUrl('https://gitlab.com/g/p/-/compare/a...b'),
  'https://gitlab.com/g/p/-/compare/a...b.diff',
  'GitLab compare url -> .diff'
);
assert.equal(
  toDiffUrl('https://gitlab.example.com/g/p/-/commit/deadbeef'),
  'https://gitlab.example.com/g/p/-/commit/deadbeef.diff',
  'self-managed GitLab commit url -> .diff'
);
// Bitbucket — commit / pull request pages map to the REST API diff endpoint.
assert.equal(
  toDiffUrl('https://bitbucket.org/ws/repo/commits/abcdef0'),
  'https://api.bitbucket.org/2.0/repositories/ws/repo/diff/abcdef0',
  'Bitbucket commit url -> API diff'
);
assert.equal(
  toDiffUrl('https://bitbucket.org/ws/repo/pull-requests/42'),
  'https://api.bitbucket.org/2.0/repositories/ws/repo/pullrequests/42/diff',
  'Bitbucket PR url -> API diff'
);
assert.equal(
  toDiffUrl('https://example.com/x.diff'),
  'https://example.com/x.diff',
  'unknown-host url left as-is'
);
assert.equal(classifyInput('https://example.com/x.diff').kind, 'url', 'url detected');
assert.equal(classifyInput('main...HEAD').kind, 'git', 'git range detected');
assert.equal(classifyInput(__filename).kind, 'file', 'existing file detected');

console.log('All tests passed.');
