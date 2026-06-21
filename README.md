# pocketdiff

Turn a `git diff` into a **single, self-contained HTML file** built for reviewing
code **on the go** — phone or tablet. No server, no build step, no internet needed
to open it. Just pipe a diff in and AirDrop / download the result to your device.

Reviewing agent-generated diffs on GitHub mobile is painful: lines wrap badly,
lockfiles drown out real changes, and there's no way to filter or group. pocketdiff
fixes exactly that.

## Features

- **Mobile- & tablet-friendly** — fluid layout, big tap targets, code scrolls inside
  its own box so the page never overflows. Roomier on tablets/landscape.
- **Noise collapsed by default** — lockfiles (`package-lock.json`, `pnpm-lock.yaml`,
  `go.sum`, `Cargo.lock`, …), minified/generated files, source maps and snapshots
  start collapsed. Real source starts open.
- **Grouped by folder** — files are clustered by directory (a strong proxy for
  "related files") under collapsible group headers.
- **Word-level highlighting** — when a line is edited, the exact words that changed
  are highlighted (great for prose & markdown, helpful everywhere).
- **Markdown preview** — `.md`/`.markdown`/`.mdx` files get a **Diff / Preview**
  toggle that renders the changed sections as real markdown (headings, tables, bold)
  via `markdown-it`, pre-rendered at build time so the output stays offline.
- **Live filename filter** — type to instantly narrow the file list.
- **Word wrap on by default**, plus toggle, expand/collapse all, dark mode.
- **Self-contained** — all CSS/JS inlined, zero external requests. Works offline.

> Note: a unified diff only contains changed hunks (plus a little context), not the
> whole file — so the markdown preview shows the *changed sections*, not the full
> rendered document.

## Usage

```bash
# pipe a diff in (the primary path)
git diff main...HEAD | npx pocketdiff -o review.html

# or pass an input — auto-detected as a git range, a local file, or a URL
npx pocketdiff -o review.html main...HEAD
npx pocketdiff -o review.html changes.diff
npx pocketdiff -o review.html https://github.com/owner/repo/pull/42

# default: diff the working tree
npx pocketdiff -o review.html
```

Then open `review.html` on your phone or tablet.

### Input (auto-detected, best effort)

A single positional argument is classified automatically:

| Input | Treated as |
|-------|-----------|
| `https://…` | a URL to fetch — GitHub, GitLab, and Bitbucket PR/MR, commit, and compare pages are mapped to the diff each host serves; any other raw `.diff`/`.patch` URL is fetched directly |
| an existing file | a local unified-diff file |
| anything else | arguments for `git diff` (e.g. `main...HEAD`, `HEAD~3`) |
| (omitted) | piped stdin if present, otherwise the working tree |

**Private repos** — set the matching token and pocketdiff sends the right auth header:

| Host | Env var | Token needs |
|------|---------|-------------|
| GitHub | `GITHUB_TOKEN` / `GH_TOKEN` | `repo` scope |
| GitLab (gitlab.com + self-managed) | `GITLAB_TOKEN` / `GL_TOKEN` | `read_api` / `read_repository` |
| Bitbucket | `BITBUCKET_TOKEN` | `repository:read` |

If a fetch fails, the error says how to recover — e.g. a `404`/`403` on a private
repo tells you exactly which token to set.

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <file>` | Write HTML to a file (default: stdout) |
| `-t, --title <text>`  | Title shown in the header |
| `-h, --help`          | Show help |

Anything after `--` is passed straight to `git diff`.

## Examples

All of these write a self-contained `review.html` you can open on any device.
The URLs below are real, public references you can run as-is — and each one
edits a markdown file, so the **Diff / Preview** toggle is worth a look.

**GitHub** — paste a PR, commit, or compare *page* URL; pocketdiff maps it to the
GitHub API diff (works for private repos when `GITHUB_TOKEN`/`GH_TOKEN` is set):

```bash
# a public commit that edits readme.md (shows the markdown preview)
npx pocketdiff -o review.html \
  https://github.com/sindresorhus/awesome/commit/24da1c60ba400087006af9ff02accdb4a53472b6

# a pull request / a compare range
npx pocketdiff -o review.html https://github.com/owner/repo/pull/42
npx pocketdiff -o review.html https://github.com/owner/repo/compare/v1.0.0...v1.1.0
```

**GitLab** — same idea; commit, merge-request, and compare *page* URLs are mapped
to GitLab's raw `.diff` (gitlab.com **and** self-managed instances, via the `/-/`
path):

```bash
# a public commit that edits README.md (shows the markdown preview)
npx pocketdiff -o review.html \
  https://gitlab.com/gitlab-org/gitlab-runner/-/commit/9962b4022534a1272a3c610b9fee1c4833aa340c

# a merge request
npx pocketdiff -o review.html https://gitlab.com/group/project/-/merge_requests/42
```

**Bitbucket** — commit and pull-request *page* URLs are mapped to the Bitbucket
Cloud REST API diff:

```bash
# a public commit that edits a markdown file (shows the markdown preview)
npx pocketdiff -o review.html \
  https://bitbucket.org/bitbucketpipelines/pipelines-guide-node/commits/54ccc700920973b83b67717a9859be4ab70eb240

# a pull request
npx pocketdiff -o review.html https://bitbucket.org/workspace/repo/pull-requests/42
```

Any other raw `.diff`/`.patch` URL is fetched directly, so hosts pocketdiff
doesn't special-case still work if you link straight to the diff.

**Local repo** — no network needed; pocketdiff runs `git` for you (or pipe a diff):

```bash
# current branch vs main
git diff main...HEAD | npx pocketdiff -o review.html

# a commit range (passed straight to `git diff`)
npx pocketdiff -o review.html HEAD~3...HEAD

# a single commit — no pipe (`^!` expands to its parent..commit)
npx pocketdiff -o review.html <sha>^!

# a single commit, piped in (use -m/--first-parent for merge commits)
git show <sha> | npx pocketdiff -o review.html

# uncommitted working-tree changes (no input at all)
npx pocketdiff -o review.html
```


## Claude Code skill

This repo ships a [Claude Code](https://code.claude.com) skill (`pocketdiff`)
so you can generate a review straight from a Claude session. Install it from this
repo with the [skills.sh](https://www.skills.sh) CLI:

```bash
npx -y skills add -g aljorhythm/pocketdiff
```

This copies `.claude/skills/pocketdiff/` into your global `~/.claude/skills/`
so it's available in every project. (`-y` skips the npx download prompt; `-g`
installs globally — drop it to install into the current project's
`.claude/skills/` instead.) Then invoke it in Claude Code with `/pocketdiff`.

> The skill installs straight from this GitHub repo — it does not require the npm
> package. (There is no `npx skill install`; `npx skills add <owner>/<repo>` is the
> ecosystem-standard installer.)

## How it works

1. Parse the unified diff with [`gitdiff-parser`](https://www.npmjs.com/package/gitdiff-parser)
   (handles renames, new/deleted, binary, modes).
2. Classify each file (noise / large / binary) and group by directory.
3. Render to a self-contained HTML string — native `<details>` for zero-JS collapse,
   ~40 lines of vanilla JS for the filter and toggles.

## Develop

```bash
npm install
npm test            # unit tests (renderer, grouping, input detection)
npm run test:visual # browser harness (Playwright, dev-only); needs:
                    #   npx playwright install chromium
```

Playwright is a `devDependency` used only for the browser test harness — it is
**not** part of the published package (which ships just `bin/` and `src/`).

## License

MIT
