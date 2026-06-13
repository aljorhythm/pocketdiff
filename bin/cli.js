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
  const opts = { output: null, title: null, args: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (a === '-o' || a === '--output') {
      opts.output = argv[++i];
    } else if (a === '-t' || a === '--title') {
      opts.title = argv[++i];
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
  const headers = {
    'User-Agent': 'pocketdiff',
    Accept: 'application/vnd.github.v3.diff, text/plain, */*',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token && /(^|\.)github\.com$/.test(new URL(url).hostname)) {
    headers.Authorization = 'token ' + token;
  }
  let res;
  try {
    res = await fetch(url, { headers, redirect: 'follow' });
  } catch (e) {
    throw new Error(`could not fetch ${url}: ${e.message}`);
  }
  if (!res.ok) throw new Error(`fetch ${url} returned HTTP ${res.status}`);
  return await res.text();
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
    process.stderr.write('pocketdiff: no changes found in the diff.\n');
  }

  const html = render(files || [], { title: opts.title });

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
