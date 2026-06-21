---
name: test-pocketdiff
description: Test pocketdiff end-to-end — unit tests, the smoke driver, real public URL fetches (GitHub / GitLab / Bitbucket), every local-diff input form, error-recovery messages, the self-contained output guarantee, and the visual screenshot harness. Use after changing pocketdiff (parsing, rendering, the URL entry layer, fetch/auth, or the CLI) to verify nothing regressed.
---

# Test pocketdiff

pocketdiff is a CLI (`bin/cli.js`) that reads a unified diff and writes one
self-contained HTML review file. There's no server — every check below is either a
local command or a single HTTP fetch. Run from the repo root.

```bash
npm install   # Node >= 16
```

A green run is: **unit tests pass, the driver says `pocketdiff: OK`, every input
form writes the expected file(s), the output has zero external assets, and the
error paths print a recovery hint.**

## 1. Unit tests (fast, no network)

```bash
node test/test.js     # -> "All tests passed."
```

Covers the renderer, file classification/grouping, markdown preview, and URL
auto-detection (`toDiffUrl`: GitHub → api.github.com, GitLab `/-/…` → raw `.diff`,
Bitbucket → api.bitbucket.org). Add a case here whenever you touch `src/`.

## 2. Smoke driver (renders a sample multi-file diff, asserts features)

```bash
node .claude/skills/pocketdiff/driver.mjs    # -> PASS lines + "pocketdiff: OK"
```

Asserts the output is a valid, self-contained document with the file index,
markdown bar, word-level highlighting, rendered markdown preview, and a
collapsed-by-default lockfile. The driver locates the CLI robustly (walk-up,
`POCKETDIFF_CLI`, or a resolved `pocketdiff` package), so it runs from inside the
repo or a global skill install.

## 3. Local-diff inputs (no network)

```bash
# uncommitted working tree (no input at all)
node bin/cli.js -o /tmp/r.html

# a commit range (passed straight to `git diff`)
node bin/cli.js -o /tmp/r.html HEAD~3...HEAD

# a single commit — `^!` expands to parent..commit
node bin/cli.js -o /tmp/r.html HEAD^!

# a single commit, piped in (merge commits need -m/--first-parent)
git show <sha> | node bin/cli.js -o /tmp/r.html

# a local .diff file, and stdin (stdin always wins over a positional)
node bin/cli.js -o /tmp/r.html changes.diff
git diff main...HEAD | node bin/cli.js -o /tmp/r.html
```

Each prints `pocketdiff: wrote N file(s) → …`.

## 4. Remote URL inputs (network; token optional for public repos)

Public references that each edit a markdown file (so the preview is exercised):

```bash
# GitHub commit  (page URL -> api.github.com REST diff)
node bin/cli.js -o /tmp/gh.html \
  https://github.com/sindresorhus/awesome/commit/24da1c60ba400087006af9ff02accdb4a53472b6

# GitLab commit  (page URL -> raw .diff; gitlab.com + self-managed via `/-/`)
node bin/cli.js -o /tmp/gl.html \
  https://gitlab.com/gitlab-org/gitlab-runner/-/commit/9962b4022534a1272a3c610b9fee1c4833aa340c

# Bitbucket commit  (page URL -> api.bitbucket.org 2.0 REST diff)
node bin/cli.js -o /tmp/bb.html \
  https://bitbucket.org/bitbucketpipelines/pipelines-guide-node/commits/54ccc700920973b83b67717a9859be4ab70eb240
```

Each should print `wrote N file(s)`. For **private** repos set the matching token —
GitHub `GITHUB_TOKEN`/`GH_TOKEN`, GitLab `GITLAB_TOKEN`/`GL_TOKEN`, Bitbucket
`BITBUCKET_TOKEN` — and pocketdiff attaches the right auth header.

## 5. Error-recovery messages (the failure UX matters)

```bash
# 404 / private without access -> hint names the token to set
node bin/cli.js -o /tmp/x.html https://github.com/octocat/does-not-exist-xyz/pull/1
#   expect: "...HTTP 404 — not found, or the repo is private. ... set GITHUB_TOKEN ..."

# empty range / merge commit shown without -m -> actionable "no changes" message
git show <merge-sha> | node bin/cli.js -o /tmp/x.html
#   expect: "no changes found ... use `git show -m`/`--first-parent`."
```

## 6. Self-contained output guarantee

```bash
# must be 0 — no external .js/.css the page would fetch over the network
grep -Eo 'https?://[^"'"'"' ]+\.(js|css)' /tmp/r.html | wc -l
```

(Expect `0`.) Also handy: `grep -c 'class="preview markdown"' /tmp/gh.html` to
confirm the markdown preview rendered for a markdown-touching diff.

## 7. Visual / interactive checks

- **Browser harness** (dev-only; Playwright is a devDependency):
  ```bash
  npx playwright install chromium   # first run only
  npm run test:visual               # verifies preview opens with JS off, filter works with JS on
  ```
- **Screenshots** (mobile + desktop): render a diff to HTML, then drive the
  bundled Chromium against the `file://` URL with `playwright-core`
  (`setViewportSize` for mobile, `colorScheme: 'dark'`, click `a.vtab:has-text("Preview")`
  for the markdown tab). See the parent project's `/gather-evidence` for the exact
  `playwright-core` + `/opt/pw-browsers/chromium-*/chrome-linux/chrome` pattern.

## Troubleshooting

- `no changes found` — empty range/URL, or a merge commit without `-m`.
- `could not read a git diff` — not a git repo or a bad range; pass a file/URL or pipe a diff.
- `fetch … HTTP 404/403` — wrong URL or a private repo; the message names the env var to set.
