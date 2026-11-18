// Demo server: runs the time tracker on your own computer with NO Cloudflare account.
//
//   npm run demo        (needs Node.js 22 or newer)
//   open http://localhost:8787
//
// It runs the exact same Worker code that you would deploy, but swaps the Cloudflare
// pieces for local stand-ins:
//   - the D1 database      -> an in-memory SQLite database (node:sqlite)
//   - the static assets    -> files read from ../public
// Every start is a fresh database filled with FAKE sample data (see seed.mjs).
// Nothing is saved when you stop it.

import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import worker from '../worker/src/index.js';
import { seedDemo } from './seed.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8787);

// Password checks normally ask the "Have I Been Pwned" service. In demo mode we answer
// locally so the demo works offline.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = String(input && input.url ? input.url : input);
  if (u.startsWith('https://api.pwnedpasswords.com/')) return new Response('', { status: 200 });
  return realFetch(input, init);
};

// ---- D1 stand-in -------------------------------------------------------------------
export function openDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
  for (const f of readdirSync(join(ROOT, 'migrations')).sort()) {
    // Migrations were written to upgrade older databases. On a fresh database some of
    // their statements are already satisfied by schema.sql, so failures here are expected.
    try { db.exec(readFileSync(join(ROOT, 'migrations', f), 'utf8')); } catch { /* already applied */ }
  }
  const DB = {
    prepare(sql) {
      const mk = (params) => ({
        bind: (...a) => mk(a),
        all: async () => ({ results: db.prepare(sql).all(...params) }),
        first: async (col) => {
          const row = db.prepare(sql).get(...params) ?? null;
          return col && row ? row[col] : row;
        },
        raw: async () => db.prepare(sql).all(...params).map((r) => Object.values(r)),
        run: async () => {
          const r = db.prepare(sql).run(...params);
          return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
        },
      });
      return mk([]);
    },
    batch: async (stmts) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    exec: async (sql) => { db.exec(sql); return { count: 1 }; },
  };
  return { db, DB };
}

// ---- static assets stand-in ----------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon' };
const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, 'public', p));
    if (!file.startsWith(join(ROOT, 'public')) || !existsSync(file) || !statSync(file).isFile()) {
      return new Response(readFileSync(join(ROOT, 'public', 'index.html')), { headers: { 'content-type': TYPES['.html'] } });
    }
    return new Response(readFileSync(file), { headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream' } });
  },
};

// ---- start ---------------------------------------------------------------------------
const { DB } = openDatabase();
const env = {
  DB, ASSETS,
  BOOTSTRAP_SECRET: 'demo-bootstrap-only',
  APP_BASE_URL: `http://localhost:${PORT}`,
};

// On Cloudflare, files in ./public are served directly and never pass through the Worker;
// only other paths (/api/*, /health) reach it. The demo does the same.
function isStaticFile(pathname) {
  if (pathname.startsWith('/api/')) return false;
  const p = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  const file = normalize(join(ROOT, 'public', decodeURIComponent(p)));
  return file.startsWith(join(ROOT, 'public')) && existsSync(file) && statSync(file).isFile();
}
async function call(request) {
  if (isStaticFile(new URL(request.url).pathname)) return ASSETS.fetch(request);
  return worker.fetch(request, env, { waitUntil() {} });
}

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v])),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    });
    const r = await call(request);
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('demo server error: ' + e.message);
  }
});

const accounts = await seedDemo({ call, port: PORT, db: DB });
server.listen(PORT, () => {
  console.log(`\nTime tracker demo running at http://localhost:${PORT}\n`);
  console.log('Sign in with one of these FAKE demo accounts:');
  for (const a of accounts) console.log(`  ${a.role.padEnd(9)} ${a.email.padEnd(28)} password: ${a.password}`);
  console.log('\nEverything is sample data and is wiped when you stop the server (Ctrl+C).');
});
