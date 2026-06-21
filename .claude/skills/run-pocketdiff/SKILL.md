---
name: run-pocketdiff
description: Run, build, smoke-test, and use pocketdiff — the CLI that turns a git diff (working tree, range, local .diff file, or a GitHub PR/commit URL) into one self-contained, mobile/tablet-friendly HTML review file. Use when asked to run pocketdiff, generate a diff review HTML, render a PR/diff for reading on a phone, or smoke-test the tool.
---

# Run pocketdiff

pocketdiff is a **CLI** (`bin/cli.js`, published bin name `pocketdiff`). It reads a
unified diff and writes **one self-contained HTML file** (all CSS/JS inlined, no
network) designed for reviewing code on a phone or tablet. There is no server and
no GUI — the deliverable is the HTML file, which you open in any browser.

Paths below are relative to the repo root (`<unit>`).

## Prerequisites

- Node.js >= 16 (developed on Node 22).
- `git` only if you generate from the working tree / a range.

```bash
npm install
```

## Run (agent path): smoke-test the whole flow

The driver generates an HTML review from a sample multi-file diff and asserts the
output is self-contained and has the key review features. No browser needed.

```bash
node .claude/skills/run-pocketdiff/driver.mjs
```

Expected: a list of `PASS` lines and `pocketdiff: OK` (exit 0). It prints the path
of the generated HTML so you can open it.

## Generate a review (the actual user command)

A single positional `input` is auto-detected as a URL, a local file, or a git
range; with no input it reads piped stdin, else diffs the working tree.

```bash
# pipe a diff (primary path)
git diff main...HEAD | node bin/cli.js -o review.html

# git range (pocketdiff runs git for you)
node bin/cli.js -o review.html origin/main...HEAD

# a local .diff file
node bin/cli.js -o review.html changes.diff

# a GitHub PR / commit / compare URL (-> GitHub API diff; works for private repos with a token)
node bin/cli.js -o review.html https://github.com/octocat/Hello-World/commit/7fd1a60b01f91b314f59955a4e4d4e80d8edf11d

# help
node bin/cli.js -h
```

Installed/published, the same commands use `pocketdiff` (or `npx pocketdiff`)
instead of `node bin/cli.js`.

## Test

```bash
node test/test.js
```

Unit-level checks of the renderer, grouping, markdown preview, and input
auto-detection. Prints `All tests passed.`

Optional browser harness (dev only — Playwright is a devDependency, never part of
the published package; first run needs `npx playwright install chromium`):

```bash
npm run test:visual
```

It renders the generated HTML in headless Chromium and verifies the markdown
preview opens with JS disabled and the filter works with JS on; screenshots land
in `test/screenshots/`.

## Gotchas

- **The output is built to work with JavaScript disabled.** Mobile preview
  sandboxes (iOS Quick Look, in-app file previews) run downloaded HTML without
  JS. The filter/expand/collapse use JS, but collapsing (`<details>`) and the
  markdown Diff/Preview toggle (anchor `:target`) work with JS off.
- **Markdown preview shows changed sections, not the whole document.** A unified
  diff only carries changed hunks plus a little context, so a full-file render
  isn't possible from a diff alone.
- **URL input needs network.** Private GitHub URLs need `GITHUB_TOKEN` (or
  `GH_TOKEN`) in the environment; pocketdiff adds it as an auth header for
  `github.com` hosts.
- **Piped stdin always wins** over a positional input.

## Troubleshooting

- `pocketdiff: no changes found in the diff.` — the diff/range was empty. Check
  the range (e.g. `origin/main...HEAD`) or that the file/URL has content.
- `pocketdiff: could not read a git diff...` — not in a git repo, or a bad range.
  Pass a `.diff` file, a URL, or pipe a diff instead.
- `fetch ... returned HTTP 404/403` — wrong URL, or a private repo without a
  token. Set `GITHUB_TOKEN`.
