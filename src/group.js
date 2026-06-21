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

// Git appends a trailing TAB (and an optional timestamp) after a filename that
// contains spaces in the `---`/`+++` diff lines, to delimit where the name ends.
// gitdiff-parser keeps it, which breaks extension checks (`.md`, …) and shows a
// stray tab in the UI — so strip everything from the first tab on.
const cleanPath = (p) => (typeof p === 'string' ? p.split('\t')[0] : p);

function pathOf(file) {
  // newPath is "/dev/null" for deletions; fall back to oldPath.
  const np = cleanPath(file.newPath);
  const op = cleanPath(file.oldPath);
  if (np && np !== '/dev/null') return np;
  return op || np || '(unknown)';
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
    const hasImage = !!file.image;
    return {
      ...file,
      newPath: cleanPath(file.newPath),
      oldPath: cleanPath(file.oldPath),
      path,
      dir: dirOf(path),
      additions,
      deletions,
      noise,
      large,
      binary,
      // collapsed by default when it's noise, very large, or has nothing to show
      // — but an image with a resolved preview IS the content, so keep it open.
      collapsed: !hasImage && (noise || large || binary || (file.hunks || []).length === 0),
    };
  });
}

function baseName(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

// --- Semantic grouping (crude, heuristic — a useful reorg for review) --------

// "Layer" = architectural role, detected from the file name by keyword. Ordered
// by priority: the first match wins (so `user.service.test.ts` is a test, not a
// service). The label order here is also the display order.
const LAYER_RULES = [
  ['tests', /(^|[._-])(test|spec)s?([._-]|$)/i],
  ['migrations', /migration/i],
  ['controllers', /controller/i],
  ['routes', /(^|[._-])(route|router)s?([._-]|$)/i],
  ['handlers', /handler/i],
  ['middleware', /middleware/i],
  ['services', /service/i],
  ['repositories', /(repositor(y|ies)|(^|[._-])repos?([._-]|$))/i],
  ['models', /(model|entit(y|ies))/i],
  ['schemas', /schema/i],
  ['dtos', /(^|[._-])dtos?([._-]|$)/i],
  ['components', /component/i],
  ['hooks', /(^|[._-])use[A-Z]|(^|[._-])hooks?([._-]|$)/],
  ['styles', /\.(css|scss|sass|less)$/i],
  ['docs', /\.(md|mdx|markdown)$/i],
  ['types', /(^|[._-])(types?|interfaces?|d)([._-]|$)/i],
  ['config', /(config|settings)/i],
  ['utils', /(util|helper)/i],
];
const LAYER_ORDER = LAYER_RULES.map((r) => r[0]).concat('other');

function layerOf(path) {
  const base = baseName(path);
  for (const [label, re] of LAYER_RULES) if (re.test(base)) return label;
  return 'other';
}

// Words that describe a layer/role, stripped when guessing a file's domain.
const LAYER_WORDS = new Set([
  'test', 'tests', 'spec', 'specs', 'controller', 'controllers', 'service', 'services',
  'repository', 'repositories', 'repo', 'repos', 'model', 'models', 'entity', 'entities',
  'route', 'routes', 'router', 'handler', 'handlers', 'middleware', 'schema', 'schemas',
  'dto', 'dtos', 'component', 'components', 'hook', 'hooks', 'type', 'types', 'interface',
  'interfaces', 'config', 'settings', 'util', 'utils', 'helper', 'helpers', 'index',
  'main', 'app', 'style', 'styles', 'module', 'impl', 'migration', 'migrations',
]);

// "Domain" = the thing a file is about, guessed from its name by stripping the
// extension and layer words, then taking the first meaningful token (crudely
// singularised). So user.service.ts / users.controller.ts / userRepository.ts
// all key to "user".
function domainKeyOf(path) {
  const base = baseName(path).replace(/\.[^.]+$/, '');
  const tokens = base
    .split(/[._\-\s]+|(?=[A-Z])/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
  const sig = tokens.filter((t) => !LAYER_WORDS.has(t) && !/^\d+$/.test(t));
  let key = sig[0] || tokens[0] || 'misc';
  key = key.replace(/s$/, '') || key; // crude singularise
  return key || 'misc';
}

function bucket(files, keyOf, order, last) {
  const map = new Map();
  for (const f of files) {
    const k = keyOf(f);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  const groups = [...map.entries()].map(([label, gf]) => {
    gf.sort((a, b) => a.path.localeCompare(b.path));
    return {
      label,
      files: gf,
      additions: gf.reduce((s, f) => s + f.additions, 0),
      deletions: gf.reduce((s, f) => s + f.deletions, 0),
    };
  });
  const rank = (l) => {
    if (order) {
      const i = order.indexOf(l);
      return i === -1 ? order.length : i;
    }
    return l === last ? 1 : 0;
  };
  groups.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  return groups;
}

// Group files for display. `mode`:
//   'dir'    — by directory (default; a strong proxy for "related files")
//   'layer'  — by architectural role (controllers/services/repositories/…)
//   'domain' — by the thing they're about (user/order/…), via name similarity
// Returns [{ label, files, additions, deletions }].
function group(files, mode = 'dir') {
  if (mode === 'layer') return bucket(files, (f) => layerOf(f.path), LAYER_ORDER);
  if (mode === 'domain') return bucket(files, (f) => domainKeyOf(f.path), null, 'misc');
  return bucket(files, (f) => f.dir, null);
}

module.exports = {
  classify,
  group,
  pathOf,
  isNoise,
  NOISE_PATTERNS,
  layerOf,
  domainKeyOf,
  LAYER_ORDER,
};
