'use strict';

const fs = require('fs');

// Drop a trailing slash and any existing `.diff`/`.patch` suffix from a path tail.
const strip = (s) => s.replace(/\/$/, '').replace(/\.(diff|patch)$/, '');

// Map a GitHub web URL (PR, commit, compare) to the REST API endpoint that
// serves its diff. We use api.github.com rather than the web `<url>.diff`
// shortcut because the latter 404s for PRs/commits in PRIVATE repos even with a
// token, whereas the API honors the token and returns the diff via the
// `application/vnd.github.v3.diff` media type (see fetchDiff). Returns null if
// the URL isn't a recognised GitHub page.
function githubDiffUrl(url) {
  if (url.hostname.replace(/^www\./, '') !== 'github.com') return null;
  const api = (a, b, rest) => `https://api.github.com/repos/${a}/${b}/${rest}`;
  let m;
  if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)))
    return api(m[1], m[2], `pulls/${m[3]}`);
  if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/compare\/(.+)/)))
    return api(m[1], m[2], `compare/${strip(m[3])}`);
  if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/commit\/([0-9a-fA-F]+)/)))
    return api(m[1], m[2], `commits/${m[3]}`);
  return null;
}

// Map a GitLab web URL (commit, merge request, compare) to its raw `.diff`.
// GitLab — gitlab.com AND self-managed instances — uses the `/-/` separator
// between the (possibly nested) project path and the resource, and serves a
// unified diff when the URL is suffixed with `.diff`. Host-agnostic by design,
// so self-hosted GitLab works too. Returns null if it isn't a GitLab page.
function gitlabDiffUrl(url) {
  const project = url.pathname.match(/^(.+?)\/-\//);
  if (!project) return null;
  const at = (kind, id) => `${url.origin}${project[1]}/-/${kind}/${id}.diff`;
  let m;
  if ((m = url.pathname.match(/\/-\/commit\/([0-9a-fA-F]+)/))) return at('commit', m[1]);
  if ((m = url.pathname.match(/\/-\/merge_requests\/(\d+)/))) return at('merge_requests', m[1]);
  if ((m = url.pathname.match(/\/-\/compare\/(.+)/))) return at('compare', strip(m[1]));
  return null;
}

// Map a Bitbucket Cloud web URL (commit, pull request) to the REST API endpoint
// that serves its raw unified diff. Public works without auth; private needs a
// Bitbucket access token (see fetchDiff). Returns null if it isn't a Bitbucket
// page.
function bitbucketDiffUrl(url) {
  if (url.hostname.replace(/^www\./, '') !== 'bitbucket.org') return null;
  const api = (ws, repo, rest) =>
    `https://api.bitbucket.org/2.0/repositories/${ws}/${repo}/${rest}`;
  let m;
  if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/commits?\/([0-9a-fA-F]+)/)))
    return api(m[1], m[2], `diff/${m[3]}`);
  if ((m = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)/)))
    return api(m[1], m[2], `pullrequests/${m[3]}/diff`);
  return null;
}

// Best-effort: turn a code-host web URL (GitHub / GitLab / Bitbucket PR/MR,
// commit, compare) into a URL that serves its raw unified diff. Anything else —
// already a raw `.diff` URL, an unknown host — is returned unchanged and fetched
// as-is.
function toDiffUrl(u) {
  let url;
  try {
    url = new URL(u);
  } catch {
    return u;
  }
  return githubDiffUrl(url) || gitlabDiffUrl(url) || bitbucketDiffUrl(url) || u;
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
