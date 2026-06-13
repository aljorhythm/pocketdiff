#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');
const parser = require('gitdiff-parser');
const { render } = require('../src/render');

const HELP = `pocketdiff — turn a git diff into a self-contained HTML file
made for reviewing on the go (phone & tablet).

Usage:
  git diff <range> | pocketdiff [options] > review.html
  pocketdiff [options] [-- <git diff args>]

Options:
  -o, --output <file>   Write HTML to <file> (default: stdout)
  -t, --title <text>    Title shown in the header
  -h, --help            Show this help

Examples:
  git diff main...HEAD | pocketdiff -o review.html
  pocketdiff -o review.html -- main...HEAD
  pocketdiff                       # diffs the working tree
`;

function parseArgs(argv) {
  const opts = { output: null, title: null, gitArgs: [] };
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
      opts.gitArgs.push(...argv.slice(i + 1));
      break;
    } else {
      opts.gitArgs.push(a);
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

function getDiff(opts) {
  // Piped input takes precedence — this is the primary, documented path.
  if (!process.stdin.isTTY) {
    const piped = readStdin();
    if (piped.trim()) return piped;
  }
  // Otherwise run git ourselves.
  try {
    return execFileSync('git', ['diff', ...opts.gitArgs], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (e) {
    process.stderr.write(
      'pocketdiff: could not read a diff. Pipe one in (git diff | pocketdiff) ' +
        'or run inside a git repo.\n'
    );
    process.exit(1);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const diffText = getDiff(opts);
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
