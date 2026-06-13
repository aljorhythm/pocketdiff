'use strict';

const assert = require('assert');
const parser = require('gitdiff-parser');
const { render } = require('../src/render');
const { classify, group } = require('../src/group');

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

console.log('All tests passed.');
