#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const parser = require('gitdiff-parser');
const { render } = require('../src/render');
const { toDiffUrl, classifyInput } = require('../src/input');

const HELP = `pocketdiff — turn a diff into a self-contained HTML file
made for reviewing on the go (phone & tablet).

Usage:
  pocketdiff [options] [input]
  git diff <range> | pocketdiff [options] > review.html

[input] is auto-detected (best effort):
  - a URL        e.g. a GitHub PR/compare/commit page or any raw .diff URL
  - a local file e.g. ./changes.diff
  - a git range  e.g. main...HEAD, HEAD~3 (passed to \`git diff\`)
  - omitted      reads piped stdin, else diffs the working tree

Options:
  -o, --output <file>   Write HTML to <file> (default: stdout)
  -t, --title <text>    Title shown in the header
  --highlight           Syntax-highlight code (opt-in; common languages)
  --light, --dark       Force the colour theme (default: follow the system)
  --group <how>         Group files by: dir (default), layer, or domain
  -h, --help            Show this help

Examples:
  git diff main...HEAD | pocketdiff -o review.html
  pocketdiff -o review.html main...HEAD
  pocketdiff -o review.html changes.diff
  pocketdiff -o review.html https://github.com/owner/repo/pull/42
  pocketdiff                       # diffs the working tree

For private GitHub URLs, set GITHUB_TOKEN (or GH_TOKEN).
`;

function parseArgs(argv) {
  const opts = { output: null, title: null, highlight: false, theme: null, group: 'dir', args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (a === '-o' || a === '--output') {
      opts.output = argv[++i];
    } else if (a === '-t' || a === '--title') {
      opts.title = argv[++i];
    } else if (a === '--highlight') {
      opts.highlight = true;
    } else if (a === '--light' || a === '--dark') {
      opts.theme = a.slice(2);
    } else if (a === '--group') {
      opts.group = argv[++i];
    } else if (a === '--') {
      opts.args.push(...argv.slice(i + 1));
      break;
    } else {
      opts.args.push(a);
    }
  }
  return opts;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

async function fetchDiff(input) {
  const url = toDiffUrl(input);
  const { hostname, pathname } = new URL(url);
  const isGitHub = /(^|\.)github\.com$/.test(hostname);
  const isGitHubApi = hostname === 'api.github.com';
  const isBitbucketApi = hostname === 'api.bitbucket.org';
  // GitLab's diff is served from the project web route, which carries the `/-/`
  // separator — true for gitlab.com and self-managed instances alike.
  const isGitLab = pathname.includes('/-/');
  const headers = {
    'User-Agent': 'pocketdiff',
    // The REST API needs the diff media type explicitly; ask for ONLY it so
    // content negotiation can't fall back to JSON. A raw `.diff` URL just
    // serves text, so there we keep the broad Accept.
    Accept: isGitHubApi
      ? 'application/vnd.github.v3.diff'
      : 'application/vnd.github.v3.diff, text/plain, */*',
  };
  // Provider-specific auth so PRIVATE repos resolve. Each header is attached
  // only when its token env var is set, and is harmless on public resources.
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const glToken = process.env.GITLAB_TOKEN || process.env.GL_TOKEN;
  const bbToken = process.env.BITBUCKET_TOKEN;
  if (isGitHub && ghToken) {
    headers.Authorization = 'token ' + ghToken; // GitHub PAT
  } else if (isGitLab && glToken) {
    headers['PRIVATE-TOKEN'] = glToken; // GitLab personal access token
  } else if (isBitbucketApi && bbToken) {
    headers.Authorization = 'Bearer ' + bbToken; // Bitbucket access token
  }
  // Provider + token info for actionable error messages on failure.
  let provider = null;
  let tokenEnv = null;
  let tokenPresent = false;
  if (isGitHub) {
    [provider, tokenEnv, tokenPresent] = ['GitHub', 'GITHUB_TOKEN (or GH_TOKEN)', !!ghToken];
  } else if (isGitLab) {
    [provider, tokenEnv, tokenPresent] = ['GitLab', 'GITLAB_TOKEN (or GL_TOKEN)', !!glToken];
  } else if (isBitbucketApi) {
    [provider, tokenEnv, tokenPresent] = ['Bitbucket', 'BITBUCKET_TOKEN', !!bbToken];
  }

  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow' });
  } catch (e) {
    throw new Error(
      `could not reach ${url}: ${e.message}. Check your network/proxy, or generate the diff ` +
        'locally (`git diff <range>`) and pipe it in instead.'
    );
  }
  if (!res.ok) {
    throw new Error(`fetch ${url} returned HTTP ${res.status}${recoveryHint(res.status, provider, tokenEnv, tokenPresent)}`);
  }
  return await res.text();
}

// Turn an HTTP failure into a sentence that tells the user how to recover —
// most importantly, which token to set (and with what access) for a private repo.
function recoveryHint(status, provider, tokenEnv, tokenPresent) {
  const scopes = {
    GitHub: "a 'repo'-scoped token",
    GitLab: "a token with 'read_api' (or 'read_repository') scope",
    Bitbucket: "a token/app password with 'repository:read'",
  };
  if (status === 401 || status === 403) {
    if (!provider) return ' — authentication required. The host refused the request.';
    return tokenPresent
      ? ` — ${provider} rejected the token. It may be expired or lack access; use ${scopes[provider]} that can read this repo.`
      : ` — looks private/forbidden. Set ${tokenEnv} to ${scopes[provider]} and retry.`;
  }
  if (status === 404) {
    if (!provider) return ' — not found. Check the URL, or pass a raw .diff URL / pipe a diff instead.';
    return tokenPresent
      ? ' — not found. Double-check the URL; the token may also lack access to a private repo.'
      : ` — not found, or the repo is private. Verify the URL; if private, set ${tokenEnv} and retry.`;
  }
  if (status === 406 || status === 422) {
    return ' — the diff may be too large for the host to serve. Generate it locally with `git diff` and pipe it in.';
  }
  if (status === 429) {
    return ' — rate limited. Wait and retry' + (provider && !tokenPresent ? `, or set ${tokenEnv} to raise the limit.` : '.');
  }
  if (status >= 500) return ' — the host had a server error. Retry shortly.';
  return '';
}

function runGit(args) {
  try {
    return execFileSync('git', ['diff', ...args], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(
      'could not read a git diff. Pass a diff file, a URL, a git range, or pipe one in.'
    );
  }
}

async function getDiff(opts) {
  // Piped input always wins — the original, primary path.
  if (!process.stdin.isTTY) {
    const piped = readStdin();
    if (piped.trim()) return piped;
  }
  // A single positional is auto-detected: URL, local file, or git range.
  if (opts.args.length === 1) {
    const { kind, value } = classifyInput(opts.args[0]);
    if (kind === 'url') return fetchDiff(value);
    if (kind === 'file') return fs.readFileSync(value, 'utf8');
  }
  // Otherwise hand everything to `git diff` (empty = working tree).
  return runGit(opts.args);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let diffText;
  try {
    diffText = await getDiff(opts);
  } catch (e) {
    process.stderr.write('pocketdiff: ' + e.message + '\n');
    process.exit(1);
  }

  const files = parser.parse(diffText);
  if (!files || files.length === 0) {
    process.stderr.write(
      'pocketdiff: no changes found in the diff — the range/URL may be empty, or it was a ' +
        'merge commit shown without a diff. Check the range, or use `git show -m`/`--first-parent`.\n'
    );
  }

  const html = render(files || [], {
    title: opts.title,
    highlight: opts.highlight,
    theme: opts.theme,
    group: opts.group,
  });

  if (opts.output) {
    fs.writeFileSync(opts.output, html);
    process.stderr.write(
      `pocketdiff: wrote ${files ? files.length : 0} file(s) → ${opts.output}\n`
    );
  } else {
    process.stdout.write(html);
  }
}

main();
