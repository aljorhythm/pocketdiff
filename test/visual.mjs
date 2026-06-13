#!/usr/bin/env node
// Visual / browser test harness for pocketdiff (DEV ONLY — Playwright is a
// devDependency and is never part of the published package).
//
// It generates a review HTML from a sample diff via the CLI, then drives it in
// headless Chromium to verify the behaviours that can only be checked in a real
// browser, and writes screenshots to test/screenshots/.
//
//   npm run test:visual
//   (first time on a fresh machine: npx playwright install chromium)
//
// Checks:
//   - JS DISABLED: tapping the top markdown chip opens the rendered preview
//     (the toggle must not depend on JS — iOS Quick Look / in-app previews).
//   - JS ENABLED: the filename filter narrows the file list.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('playwright not installed. Run: npm i -D playwright');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cli = join(root, 'bin', 'cli.js');
const shotDir = join(root, 'test', 'screenshots');

const SAMPLE = `diff --git a/apps/web/src/hooks/useRoom.ts b/apps/web/src/hooks/useRoom.ts
index eee555..fff666 100644
--- a/apps/web/src/hooks/useRoom.ts
+++ b/apps/web/src/hooks/useRoom.ts
@@ -1,3 +1,3 @@
 export function useRoom(id) {
-  return useQuery(['room', id]);
+  return useQuery(['room', id], { live: true });
 }
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 111aaa..222bbb 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1,2 +1,3 @@
   ws@8.16.0:
+  ws@8.18.0:
diff --git a/docs/README.md b/docs/README.md
index 333ccc..444ddd 100644
--- a/docs/README.md
+++ b/docs/README.md
@@ -1,3 +1,5 @@
 # Rooms
-A simple service.
+A **realtime** service.
+
+| table | purpose |
`;

const work = mkdtempSync(join(tmpdir(), 'pocketdiff-visual-'));
const htmlPath = join(work, 'review.html');
execFileSync('node', [cli, '-o', htmlPath, '-t', 'pocketdiff visual test'], {
  input: SAMPLE,
  encoding: 'utf8',
  stdio: ['pipe', 'inherit', 'inherit'],
});
const url = 'file://' + htmlPath;

const results = [];
function check(name, pass) {
  results.push([name, pass]);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
}

const browser = await chromium.launch();
try {
  // 1. JS DISABLED — markdown preview must open via :target alone.
  const noJs = await browser.newContext({
    viewport: { width: 390, height: 900 },
    javaScriptEnabled: false,
  });
  const p1 = await noJs.newPage();
  await p1.goto(url);
  await p1.screenshot({ path: join(shotDir, 'mobile-top.png') });
  await p1.locator('.mdbar .md-chip').first().click();
  const previewShown = await p1.evaluate(
    () => getComputedStyle(document.querySelector('.preview')).display === 'block'
  );
  check('JS off: markdown chip opens preview', previewShown);
  await p1.screenshot({ path: join(shotDir, 'mobile-markdown-preview.png') });
  await noJs.close();

  // 2. JS ENABLED — the filter narrows the file list.
  const withJs = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const p2 = await withJs.newPage();
  await p2.goto(url);
  const before = await p2.locator('details.file:not(.hidden)').count();
  await p2.fill('#filter', 'useRoom');
  const after = await p2.locator('details.file:not(.hidden)').count();
  check('JS on: filter narrows file list', before > after && after >= 1);
  await withJs.close();
} finally {
  await browser.close();
}

const failed = results.filter(([, pass]) => !pass);
console.log(`\nScreenshots in ${shotDir}`);
console.log(failed.length ? 'visual: FAILED' : 'visual: OK');
process.exit(failed.length ? 1 : 0);
