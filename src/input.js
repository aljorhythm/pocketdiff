'use strict';

const fs = require('fs');

// Best-effort: turn a GitHub web URL (PR, compare, commit) into the REST API
// endpoint that serves its diff. We use api.github.com rather than the web
// `<url>.diff` shortcut because the latter 404s for PRs/commits in PRIVATE
// repos even with a token, whereas the API honors the token and returns the
// diff via the `application/vnd.github.v3.diff` media type (see fetchDiff).
// Anything else is returned unchanged and fetched as-is.
function toDiffUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return u;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'github.com') {
    const api = (a, b, rest) => `https://api.github.com/repos/${a}/${b}/${rest}`;
    const strip = (s) => s.replace(/\/$/, '').replace(/\.(diff|patch)$/, '');
    let m;
    if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)))
      return api(m[1], m[2], `pulls/${m[3]}`);
    if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/compare\/(.+)/)))
      return api(m[1], m[2], `compare/${strip(m[3])}`);
    if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/commit\/([0-9a-fA-F]+)/)))
      return api(m[1], m[2], `commits/${m[3]}`);
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
