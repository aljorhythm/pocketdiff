#!/usr/bin/env node
// Smoke-driver for pocketdiff. pocketdiff is a CLI: it reads a unified diff and
// writes one self-contained HTML review file. This driver runs that real flow on
// a sample multi-file diff and asserts the output has the key review features.
//
//   node .claude/skills/run-pocketdiff/driver.mjs
//
// Exits 0 on success, non-zero (and prints which check failed) otherwise.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));

// Locate the pocketdiff CLI robustly. This skill runs both ways: nested inside
// the repo (`<repo>/.claude/skills/run-pocketdiff/`) AND installed globally into
// `~/.claude/skills/run-pocketdiff/`, where a fixed `../../../bin/cli.js` points
// at the wrong place. Resolution order: explicit override, then walk up for
// `bin/cli.js`, then a resolved `pocketdiff` package install.
function findCli() {
  if (process.env.POCKETDIFF_CLI) return process.env.POCKETDIFF_CLI;
  let dir = here;
  for (;;) {
    const cand = join(dir, 'bin', 'cli.js');
    if (existsSync(cand)) return cand;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  try {
    return createRequire(import.meta.url).resolve('pocketdiff/bin/cli.js');
  } catch {
    /* pocketdiff not installed as a package */
  }
  throw new Error(
    'could not locate pocketdiff bin/cli.js — run from inside the pocketdiff repo,\n' +
      'install pocketdiff (npm i -g pocketdiff), or set POCKETDIFF_CLI to its path.'
  );
}

const cli = findCli();

const SAMPLE = `diff --git a/apps/server/drizzle/0007_room_members.sql b/apps/server/drizzle/0007_room_members.sql
new file mode 100644
index 0000000..aaa1111
--- /dev/null
+++ b/apps/server/drizzle/0007_room_members.sql
@@ -0,0 +1,4 @@
+CREATE TABLE "room_members" (
+  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
+  "room_id" uuid NOT NULL
+);
diff --git a/apps/web/src/hooks/useRoom.ts b/apps/web/src/hooks/useRoom.ts
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

const work = mkdtempSync(join(tmpdir(), 'pocketdiff-driver-'));
const htmlPath = join(work, 'review.html');

// Run the real CLI: sample diff on stdin -> self-contained HTML file.
execFileSync('node', [cli, '-o', htmlPath, '-t', 'pocketdiff driver demo'], {
  input: SAMPLE,
  encoding: 'utf8',
  stdio: ['pipe', 'inherit', 'inherit'],
});

const html = readFileSync(htmlPath, 'utf8');
const checks = {
  'valid html document': html.startsWith('<!DOCTYPE html>'),
  'self-contained (no external js/css)': !/https?:\/\/[^"']+\.(?:js|css)/.test(html),
  'top file index': html.includes('class="filelist"'),
  'markdown bar at top': html.includes('class="mdbar"'),
  'word-level diff highlighting': html.includes('class="wq"'),
  'rendered markdown preview': html.includes('class="preview markdown"'),
  'lockfile collapsed by default': /class="file" id="f\d+" data-path="pnpm-lock\.yaml"/.test(html),
};

let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) ok = false;
}
console.log(`\nGenerated: ${htmlPath}`);
console.log(ok ? 'pocketdiff: OK' : 'pocketdiff: FAILED');
process.exit(ok ? 0 : 1);
