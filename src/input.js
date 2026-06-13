'use strict';

const fs = require('fs');

// Best-effort: turn a GitHub web URL (PR, compare, commit) into its raw .diff
// URL. Anything else is returned unchanged and fetched as-is.
function toDiffUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return u;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'github.com') {
    const base = (a, b, rest) => `https://github.com/${a}/${b}/${rest}`;
    const strip = (s) => s.replace(/\/$/, '').replace(/\.(diff|patch)$/, '');
    let m;
    if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)))
      return base(m[1], m[2], `pull/${m[3]}.diff`);
    if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/compare\/(.+)/)))
      return base(m[1], m[2], `compare/${strip(m[3])}.diff`);
    if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/commit\/([0-9a-fA-F]+)/)))
      return base(m[1], m[2], `commit/${m[3]}.diff`);
  }
  return u;
}

// Decide what a single positional input token is: a URL, an existing local
// file, or otherwise something to hand to `git diff` (a range/ref/path).
function classifyInput(token) {
  if (/^https?:\/\//i.test(token)) return { kind: 'url', value: token };
  try {
    if (fs.existsSync(token) && fs.statSync(token).isFile())
      return { kind: 'file', value: token };
  } catch {
    /* ignore */
  }
  return { kind: 'git', value: token };
}

module.exports = { toDiffUrl, classifyInput };
