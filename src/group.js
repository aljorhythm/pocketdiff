'use strict';

// Files whose diffs are noise during review and should start collapsed.
const NOISE_PATTERNS = [
  // dependency lockfiles
  /(^|\/)package-lock\.json$/,
  /(^|\/)npm-shrinkwrap\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)bun\.lockb$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)Pipfile\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)go\.sum$/,
  /(^|\/)flake\.lock$/,
  /(^|\/)pubspec\.lock$/,
  // generated / minified / maps / snapshots
  /\.min\.(js|css)$/,
  /\.map$/,
  /\.snap$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)vendor\//,
  /\.generated\./,
  /(^|\/)__generated__\//,
];

// A file with more than this many changed lines also starts collapsed.
const LARGE_CHANGE_THRESHOLD = 600;

function pathOf(file) {
  // newPath is "/dev/null" for deletions; fall back to oldPath.
  if (file.newPath && file.newPath !== '/dev/null') return file.newPath;
  return file.oldPath || file.newPath || '(unknown)';
}

function countChanges(file) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks || []) {
    for (const change of hunk.changes) {
      if (change.type === 'insert') additions++;
      else if (change.type === 'delete') deletions++;
    }
  }
  return { additions, deletions };
}

function isNoise(path) {
  return NOISE_PATTERNS.some((re) => re.test(path));
}

function dirOf(path) {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

// Decorate each parsed file with the metadata the renderer needs.
function classify(files) {
  return files.map((file) => {
    const path = pathOf(file);
    const { additions, deletions } = countChanges(file);
    const changed = additions + deletions;
    const noise = isNoise(path);
    const large = changed > LARGE_CHANGE_THRESHOLD;
    const binary = (file.hunks || []).length === 0 && file.type !== 'rename';
    return {
      ...file,
      path,
      dir: dirOf(path),
      additions,
      deletions,
      noise,
      large,
      binary,
      // collapsed by default when it's noise, very large, or has nothing to show
      collapsed: noise || large || binary || (file.hunks || []).length === 0,
    };
  });
}

// Best-effort grouping by directory (a strong proxy for "similar files").
// Returns [{ dir, files, additions, deletions }] sorted by path.
function group(files) {
  const byDir = new Map();
  for (const file of files) {
    if (!byDir.has(file.dir)) byDir.set(file.dir, []);
    byDir.get(file.dir).push(file);
  }
  const groups = [...byDir.entries()].map(([dir, groupFiles]) => {
    groupFiles.sort((a, b) => a.path.localeCompare(b.path));
    const additions = groupFiles.reduce((s, f) => s + f.additions, 0);
    const deletions = groupFiles.reduce((s, f) => s + f.deletions, 0);
    return { dir, files: groupFiles, additions, deletions };
  });
  groups.sort((a, b) => a.dir.localeCompare(b.dir));
  return groups;
}

module.exports = { classify, group, pathOf, isNoise, NOISE_PATTERNS };
