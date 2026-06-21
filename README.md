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
| `https://…` | a URL to fetch — GitHub PR / commit / compare pages map to the GitHub API diff (works for private repos with a token); any raw diff URL is fetched directly |
| an existing file | a local unified-diff file |
| anything else | arguments for `git diff` (e.g. `main...HEAD`, `HEAD~3`) |
| (omitted) | piped stdin if present, otherwise the working tree |

For private GitHub URLs, set `GITHUB_TOKEN` (or `GH_TOKEN`).

### Options

| Flag | Description |
|------|-------------|
| `-o, --output <file>` | Write HTML to a file (default: stdout) |
| `-t, --title <text>`  | Title shown in the header |
| `-h, --help`          | Show help |

Anything after `--` is passed straight to `git diff`.

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
