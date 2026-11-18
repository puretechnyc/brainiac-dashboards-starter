// Password gate for Cloudflare Pages ("advanced mode").
// The deploy script copies this file into public/ as _worker.js, so EVERY file of the
// dashboard (including data.json) needs the password.
//
// Set the password in Cloudflare: Pages project > Settings > Variables and secrets >
// add DASHBOARD_PASSWORD (type: Secret). Optional: DASHBOARD_USER (default "team").
// If DASHBOARD_PASSWORD is not set, the site stays locked (it never opens by default).

function unauthorized() {
  return new Response('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Ads dashboard", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const password = env.DASHBOARD_PASSWORD;
    if (!password) return new Response('Dashboard locked: set DASHBOARD_PASSWORD in Cloudflare.', { status: 503 });
    const user = env.DASHBOARD_USER || 'team';
    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Basic ')) return unauthorized();
    let decoded = '';
    try { decoded = atob(auth.slice(6)); } catch { return unauthorized(); }
    const i = decoded.indexOf(':');
    if (i < 0 || !safeEqual(decoded.slice(0, i), user) || !safeEqual(decoded.slice(i + 1), password)) return unauthorized();
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set('X-Robots-Tag', 'noindex');
    return out;
  },
};
