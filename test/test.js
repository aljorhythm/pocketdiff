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

// grouping
const groups = group(files);
const dirs = groups.map((g) => g.dir);
assert(dirs.includes('src'), 'src group exists');

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
assert(html.includes(`<a class="vtab" href="#prev-${mdFile.id}">Preview</a>`), 'preview tab present');
assert(html.includes(`id="prev-${mdFile.id}" class="preview markdown"`), 'preview block present');
assert(html.includes('<strong>realtime</strong>'), 'markdown rendered in preview');
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
