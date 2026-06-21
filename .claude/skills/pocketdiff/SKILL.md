---
name: pocketdiff
description: Run, build, smoke-test, and use pocketdiff — the CLI that turns a git diff (working tree, range, local .diff file, or a GitHub PR/commit URL) into one self-contained, mobile/tablet-friendly HTML review file. Use when asked to run pocketdiff, generate a diff review HTML, render a PR/diff for reading on a phone, or smoke-test the tool.
---

# Run pocketdiff

pocketdiff is a **CLI** that reads a unified diff and writes **one self-contained
HTML file** (all CSS/JS inlined, no network) designed for reviewing code on a
phone or tablet. There is no server and no GUI — the deliverable is the HTML file,
which you open in any browser.

## Self-contained — only Node is required

This skill ships its own bundled CLI at **`cli.cjs`** (next to this file), with
all dependencies inlined. **No package manager, no `npm install`, no
`node_modules`** — just a Node runtime (>= 16). Run it directly:

```bash
# from anywhere — works on the globally-installed skill
node "$HOME/.claude/skills/pocketdiff/cli.cjs" -o review.html <input>
```

`git` is only needed if you generate from the working tree / a range. The
`bin/cli.js` and `npm install` shown below are the **repo-development** path; the
installed skill needs neither.

## Run (agent path): smoke-test the whole flow

The driver finds the CLI automatically (live `bin/cli.js` in the repo, else the
bundled `cli.cjs`), renders a sample multi-file diff, and asserts the output is
self-contained with the key review features. No browser, no install needed.

```bash
node "$HOME/.claude/skills/pocketdiff/driver.mjs"   # installed skill
# or, inside the repo:  node .claude/skills/pocketdiff/driver.mjs
```

Expected: a list of `PASS` lines and `pocketdiff: OK` (exit 0). It prints the path
of the generated HTML so you can open it.

## Repo development (only if you cloned the source)

The commands in the rest of this file use `node bin/cli.js` and assume the repo +
`npm install`. To regenerate the bundled `cli.cjs` after changing `src/`, run
`npm run bundle`.

## Arguments (read this first)

```
pocketdiff [options] [input]      # installed skill: node "$HOME/.claude/skills/pocketdiff/cli.cjs" …
```

**`input`** — ONE positional, auto-detected. Pick exactly one source:

| input | what it is |
|-------|-----------|
| _(omitted, with a pipe)_ | reads the diff from **stdin** — `git diff … \| pocketdiff` (stdin always wins) |
| _(omitted, no pipe)_ | diffs the **working tree** (`git diff`) |
| `main...HEAD`, `HEAD~3`, `<sha>^!` | a **git range/ref** — passed to `git diff` |
| `./changes.diff` | a local **.diff file** |
| `https://…` | a **URL** — GitHub/GitLab/Bitbucket PR·MR/commit/compare page, or any raw `.diff` |

**Options** (all optional):

| option | default | meaning |
|--------|---------|---------|
| `-o, --output <file>` | stdout | write the HTML to `<file>` |
| `-t, --title <text>` | "pocketdiff review" | header title |
| `--group <dir\|layer\|domain>` | `dir` | group files by folder / architectural role / subject |
| `--highlight` | off | syntax-highlight code (common languages) |
| `--light` \| `--dark` | follow system | force the colour theme |
| `-h, --help` | | show help |

Notes: anything after `--` is passed straight to `git diff`. **Private** repos need
a token in the env — GitHub `GITHUB_TOKEN`/`GH_TOKEN`, GitLab `GITLAB_TOKEN`/`GL_TOKEN`,
Bitbucket `BITBUCKET_TOKEN`. The toolbar buttons (filter/wrap/group switch) need
JavaScript; in a no-JS viewer the diff, grouped jump-index (HTML anchors), native
collapse, and markdown preview all still work.

## Generate a review — examples

```bash
# pipe a diff (primary path)
git diff main...HEAD | node bin/cli.js -o review.html

# git range (pocketdiff runs git for you)
node bin/cli.js -o review.html origin/main...HEAD

# a single local commit (`^!` expands to its parent..commit; or `git show <sha> |`)
node bin/cli.js -o review.html <sha>^!

# a local .diff file
node bin/cli.js -o review.html changes.diff

# a GitHub PR / commit / compare URL (-> GitHub API diff; private repos work with a token)
node bin/cli.js -o review.html https://github.com/sindresorhus/awesome/commit/24da1c60ba400087006af9ff02accdb4a53472b6

# a GitLab commit / merge-request / compare URL (gitlab.com + self-managed -> raw .diff)
node bin/cli.js -o review.html https://gitlab.com/gitlab-org/gitlab-runner/-/commit/9962b4022534a1272a3c610b9fee1c4833aa340c

# a Bitbucket commit / pull-request URL (-> Bitbucket Cloud API diff)
node bin/cli.js -o review.html https://bitbucket.org/bitbucketpipelines/pipelines-guide-node/commits/54ccc700920973b83b67717a9859be4ab70eb240

# opt-in syntax highlighting (off by default; common languages)
node bin/cli.js --highlight -o review.html main...HEAD

# force a theme, and/or group by semantics (dir [default] | layer | domain)
node bin/cli.js --dark --group layer -o review.html main...HEAD

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
- **URL input needs network.** Private repos need a token in the environment,
  per host: GitHub `GITHUB_TOKEN`/`GH_TOKEN`, GitLab `GITLAB_TOKEN`/`GL_TOKEN`,
  Bitbucket `BITBUCKET_TOKEN`. pocketdiff attaches the right auth header for the
  detected host. On failure the error names the token to set.
- **Piped stdin always wins** over a positional input.

## Troubleshooting

- `pocketdiff: no changes found in the diff …` — the diff/range was empty. Check
  the range (e.g. `origin/main...HEAD`) or that the file/URL has content.
- `pocketdiff: could not read a git diff...` — not in a git repo, or a bad range.
  Pass a `.diff` file, a URL, or pipe a diff instead.
- `fetch ... returned HTTP 404/403` — wrong URL, or a private repo without a
  token. The message names the env var to set for that host (e.g. `GITHUB_TOKEN`,
  `GITLAB_TOKEN`, `BITBUCKET_TOKEN`).
