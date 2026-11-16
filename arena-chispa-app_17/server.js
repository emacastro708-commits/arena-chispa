// Servidor de clasificación de Arena Chispa. Sin dependencias: solo Node 18+.
// Sirve el juego (index.html, íconos…) y la API /api/* desde el mismo lugar.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'leaderboard.json');
const MAX = { c: 25000, w: 1000, m: 20000 };          // topes razonables (copas, oleada, monedas por partida)
const NAME_RE = /^[\p{L}\p{N}_ ]{3,12}$/u;
const CATS = ['c', 'w', 'm'];

fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); if (!db.users) db.users = {}; } catch (e) {}

let dirty = false, writing = false;
function flush() {
  if (!dirty || writing) return;
  dirty = false; writing = true;
  const tmp = DB_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (!err) fs.rename(tmp, DB_FILE, () => { writing = false; flush(); }); else writing = false;
  });
}
const save = () => { dirty = true; setTimeout(flush, 500); };
process.on('SIGTERM', () => { try { fs.writeFileSync(DB_FILE, JSON.stringify(db)); } catch (e) {} process.exit(0); });

const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const key = n => n.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const cleanName = n => String(n || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const validToken = t => typeof t === 'string' && /^[a-f0-9]{16,64}$/i.test(t);

// Límite de peticiones por IP (en memoria)
const hits = new Map();
function limited(ip, kind, max, ms) {
  const k = kind + ip, now = Date.now(); let h = hits.get(k);
  if (!h || now > h.r) h = { n: 0, r: now + ms }; h.n++; hits.set(k, h); return h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now > h.r) hits.delete(k); }, 60000).unref();

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((ok, no) => {
    let s = ''; req.on('data', d => { s += d; if (s.length > 2048) { no(new Error('big')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { no(e); } });
    req.on('error', no);
  });
}

async function api(req, res, url, ip) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (limited(ip, 'g', 120, 60000)) return send(res, 429, { error: 'demasiadas peticiones' });

  if (req.method === 'GET' && url.pathname === '/api/top') {
    const cat = url.searchParams.get('cat'); if (!CATS.includes(cat)) return send(res, 400, { error: 'categoría' });
    const rows = Object.values(db.users).filter(u => u[cat] > 0).sort((a, b) => b[cat] - a[cat] || a.t - b.t);
    const top = rows.slice(0, 10).map(u => ({ n: u.name, v: u[cat] }));
    let me = null; const q = cleanName(url.searchParams.get('name'));
    if (q) { const i = rows.findIndex(u => key(u.name) === key(q)); if (i >= 0) me = { n: rows[i].name, v: rows[i][cat], r: i + 1 }; }
    return send(res, 200, { top, me, total: rows.length });
  }

  if (req.method !== 'POST') return send(res, 404, { error: 'no existe' });
  let b; try { b = await body(req); } catch (e) { return send(res, 400, { error: 'petición inválida' }); }
  const name = cleanName(b.name);
  if (!NAME_RE.test(name)) return send(res, 400, { error: 'nombre' });
  if (!validToken(b.token)) return send(res, 400, { error: 'token' });
  const th = hash(b.token), k = key(name);

  if (url.pathname === '/api/claim') {            // reservar o cambiar de username
    if (limited(ip, 'c', 15, 3600000)) return send(res, 429, { error: 'demasiados cambios de nombre' });
    const cur = db.users[k];
    if (cur && cur.th !== th) return send(res, 409, { error: 'taken' });
    if (!cur) {
      for (const kk of Object.keys(db.users)) if (db.users[kk].th === th) delete db.users[kk]; // una cuenta por dispositivo
      db.users[k] = { name, th, c: 0, w: 0, m: 0, t: Date.now() };
    } else cur.name = name;                        // mismo dueño: puede cambiar mayúsculas
    save(); return send(res, 200, { ok: true, name });
  }

  if (url.pathname === '/api/score') {
    const u = db.users[k];
    if (!u || u.th !== th) return send(res, 403, { error: 'no es tu nombre' });
    for (const c of CATS) {
      const v = Math.floor(+b[c]);
      if (Number.isFinite(v) && v > 0) u[c] = Math.max(u[c], Math.min(v, MAX[c]));
    }
    save(); return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'no existe' });
}

// Archivos estáticos permitidos (el juego)
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serve(req, res, url) {
  let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
  if (!/^\/(index\.html|sw\.js|manifest\.webmanifest|icons\/[\w.-]+\.png)$/.test(p)) { res.writeHead(404); return res.end('No encontrado'); }
  fs.readFile(path.join(__dirname, p), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream',
      'Cache-Control': p === '/sw.js' || p === '/index.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
  if (url.pathname.startsWith('/api/')) api(req, res, url, ip).catch(() => send(res, 500, { error: 'error interno' }));
  else serve(req, res, url);
}).listen(PORT, () => console.log('Arena Chispa en http://localhost:' + PORT + '  (datos: ' + DB_FILE + ')'));
