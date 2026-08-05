// Detects the app's deployment base path so internal redirects (login,
// logout, the /owner <-> /staff <-> /admin hop) work unchanged whether this
// is served from a domain root (localhost, Vercel, a custom domain) or from
// a GitHub Pages *project* site, which serves everything under
// /<repo-name>/ instead of /. GitHub Pages is a temporary testing target
// only — Vercel (production) and localhost always serve from root, where
// this resolves to an empty string and every path behaves exactly as
// before. Plain script (not a module) so it can run in the redirect-only
// pages (owner/, staff/) as well as the main admin app.
window.BBK_BASE_PATH = (() => {
  if (location.hostname.endsWith('.github.io')) {
    const repo = location.pathname.split('/').filter(Boolean)[0];
    return repo ? `/${repo}` : '';
  }
  return '';
})();

// Prefixes an absolute in-app path ("/admin/") with the detected base, so
// the same literal path string works unmodified on every host.
window.bbkPath = path => `${window.BBK_BASE_PATH}${path}`;
