#!/usr/bin/env node
// Doc screenshot generator for pocketdiff (DEV ONLY — Playwright is a
// devDependency and is never part of the published package).
//
// Renders a representative diff via the CLI, drives it in headless Chromium,
// and writes the marketing screenshots used in README.md to docs/.
//
//   npm run docs:screenshots
//   (first time on a fresh machine: npx playwright install chromium)
//
// The sample below is chosen to show the things the README claims: grouped
// files, a collapsed lockfile, word-level highlights, and — front and centre —
// the markdown preview (rendered Markdown + the inline-diff "Markdown diff").

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
const docs = join(root, 'docs');

const SAMPLE = `diff --git a/apps/web/src/hooks/useRoom.ts b/apps/web/src/hooks/useRoom.ts
index eee555..fff666 100644
--- a/apps/web/src/hooks/useRoom.ts
+++ b/apps/web/src/hooks/useRoom.ts
@@ -1,6 +1,6 @@
 export function useRoom(id) {
-  return useQuery(['room', id]);
+  return useQuery(['room', id], { refetchInterval: 1000, live: true });
 }
diff --git a/apps/web/src/components/RoomList.tsx b/apps/web/src/components/RoomList.tsx
index aaa111..bbb222 100644
--- a/apps/web/src/components/RoomList.tsx
+++ b/apps/web/src/components/RoomList.tsx
@@ -3,7 +3,8 @@ export function RoomList() {
   const rooms = useRooms();
-  return <ul>{rooms.map(r => <li>{r.name}</li>)}</ul>;
+  const sorted = rooms.sort(byActivity);
+  return <ul className="rooms">{sorted.map(r => <Room key={r.id} room={r} />)}</ul>;
 }
diff --git a/apps/server/src/ws.ts b/apps/server/src/ws.ts
index ccc333..ddd444 100644
--- a/apps/server/src/ws.ts
+++ b/apps/server/src/ws.ts
@@ -10,6 +10,7 @@ export function attach(server) {
   const wss = new WebSocketServer({ server });
+  wss.on('connection', trackPresence);
   return wss;
 }
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 111aaa..222bbb 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -120,9 +120,12 @@ packages:
   ws@8.16.0:
+  ws@8.18.0:
+    resolution: {integrity: sha512-aaaa}
   zod@3.22.0:
+  zod@3.23.8:
+    resolution: {integrity: sha512-bbbb}
diff --git a/README.md b/README.md
index 333ccc..444ddd 100644
--- a/README.md
+++ b/README.md
@@ -1,11 +1,16 @@
 # Rooms service

-A simple service for chat rooms.
+A **realtime** chat-room service, backed by WebSockets.

-## Setup
+## Quick start

-Run the server and connect.
+Run \`pnpm dev\` and open <http://localhost:3000>.
+
+### Features
+
+| Feature  | Status        |
+|----------|---------------|
+| Presence | shipping      |
+| History  | in&nbsp;progress |
+| Search   | planned       |
`;

const work = mkdtempSync(join(tmpdir(), 'pocketdiff-shots-'));
const htmlPath = join(work, 'review.html');
execFileSync('node', [cli, '-o', htmlPath, '-t', 'Add realtime rooms'], {
  input: SAMPLE,
  encoding: 'utf8',
  stdio: ['pipe', 'inherit', 'inherit'],
});
const url = 'file://' + htmlPath;

const browser = await chromium.launch();
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 };

// Resolve the README file's id so the markdown-tab anchors are stable.
const probe = await browser.newContext({ viewport: PHONE });
const pp = await probe.newPage();
await pp.goto(url);
const mdId = await pp.evaluate(() => {
  const el = [...document.querySelectorAll('details.file')].find((d) =>
    (d.getAttribute('data-path') || '').endsWith('README.md')
  );
  return el && el.id;
});
await probe.close();
if (!mdId) {
  console.error('could not locate README file in output');
  process.exit(1);
}

async function shot(name, { dark = false, hash = '', viewport = PHONE, prep } = {}) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.deviceScaleFactor || 2,
    colorScheme: dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  await page.goto(url + hash);
  if (prep) await prep(page);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(docs, name) });
  await ctx.close();
  console.log('wrote docs/' + name);
}

// 1. Hero — top of the page: title, filter, grouped file index, source open.
await shot('mobile-hero.png', {
  prep: async (page) => {
    // Collapse the README file so the hero focuses on the file index + code.
    await page.evaluate((id) => {
      const md = document.getElementById(id);
      if (md) md.open = false;
    }, mdId);
  },
});

// 2. Markdown preview — README rendered as real markdown (headings, bold, table).
await shot('mobile-markdown.png', {
  hash: '#prev-' + mdId,
  prep: async (page) => {
    await page.evaluate((id) => {
      document
        .querySelectorAll('details.file')
        .forEach((d) => (d.open = d.id === id));
      document.getElementById(id)?.scrollIntoView();
    }, mdId);
  },
});

// 3. Markdown diff — the same, rendered WITH inline ins/del marks.
await shot('mobile-mddiff.png', {
  hash: '#md-' + mdId,
  prep: async (page) => {
    await page.evaluate((id) => {
      document
        .querySelectorAll('details.file')
        .forEach((d) => (d.open = d.id === id));
      document.getElementById(id)?.scrollIntoView();
    }, mdId);
  },
});

// 4. Dark mode — the markdown diff again, dark.
await shot('mobile-dark.png', {
  dark: true,
  hash: '#md-' + mdId,
  prep: async (page) => {
    await page.evaluate((id) => {
      document
        .querySelectorAll('details.file')
        .forEach((d) => (d.open = d.id === id));
      document.getElementById(id)?.scrollIntoView();
    }, mdId);
  },
});

// 5. Desktop — wider screen from the top: title, filter, file index + groups,
//    with the markdown preview rendered just below.
await shot('desktop.png', {
  viewport: { width: 1280, height: 820, deviceScaleFactor: 2 },
  hash: '#prev-' + mdId,
  prep: async (page) => {
    await page.evaluate(() => window.scrollTo(0, 0));
  },
});

await browser.close();
console.log('\nScreenshots written to', docs);
