'use strict';

// Admin service. In production Caddy serves public/ itself and proxies only /admin* here;
// locally (--dev) this one process serves both the site and the admin, without a password.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const { escape } = require('./html');
const { readAuth, verifyPassword, createSession, checkSession, readCookie, sessionCookie } = require('./auth');

const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT) || (DEV ? 8765 : 3100);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const NOT_CONFIGURED = 'Пароль ещё не задан. На сервере выполни: sudo -u lera node /srv/lera/src/set-password.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

const ADMIN_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; frame-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
};

const LOGIN_HEADERS = Object.assign({}, ADMIN_HEADERS, {
  'Content-Type': TYPES['.html'],
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- Who is asking ---

// Behind Caddy every request comes from localhost; the real address and scheme are in X-Forwarded-*.
function fromProxy(req) {
  const remote = req.socket.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return fromProxy(req) && forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
}

const isHttps = req => Boolean(req.socket.encrypted) || (fromProxy(req) && req.headers['x-forwarded-proto'] === 'https');

const signedIn = req => DEV || checkSession(readAuth(store.DATA_DIR), readCookie(req));

// --- Lockout against password guessing ---

const LOCK_ATTEMPTS = 10;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map();

function lockedOut(ip) {
  const entry = failures.get(ip);
  return Boolean(entry && Date.now() - entry.since < LOCK_MS && entry.count >= LOCK_ATTEMPTS);
}

function recordFailure(ip) {
  const now = Date.now();
  if (failures.size > 1000) failures.forEach((entry, key) => now - entry.since > LOCK_MS && failures.delete(key));
  const entry = failures.get(ip);
  const active = entry && now - entry.since < LOCK_MS;
  failures.set(ip, active ? { count: entry.count + 1, since: entry.since } : { count: 1, since: now });
}

// --- Cross-site protection ---

function checkOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host = null;
  try {
    host = new URL(origin).host;
  } catch (error) {
    // "null" or garbage — rejected below
  }
  if (host !== req.headers.host) throw new HttpError(403, 'Запрос с чужого сайта');
}

// API writes also need the admin's own header: a cross-site form or fetch cannot send it
// without a CORS preflight, which this server never allows.
function checkSameOrigin(req) {
  if (req.headers['x-requested-with'] !== 'le-admin') throw new HttpError(403, 'Запрос не из админки');
  checkOrigin(req);
}

// Only paths inside the admin, so the login form cannot send anyone to another site.
const safeNext = value => (/^\/admin\/[^\\\r\n]*$/.test(String(value || '')) ? String(value) : '/admin/');

// --- Request and response helpers ---

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new HttpError(413, 'Слишком большой запрос');
    if (Number(req.headers['content-length']) > limit) {
      req.resume();
      reject(tooLarge());
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', chunk => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => failed || resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new HttpError(400, 'Сломанные данные в запросе');
  }
}

function send(res, status, body, headers) {
  res.writeHead(status, headers);
  res.end(body);
}

const redirect = (res, location, headers) => send(res, 303, '', Object.assign({ Location: location, 'Cache-Control': 'no-store' }, headers));

function sendJson(res, status, data, headers) {
  send(res, status, JSON.stringify(data), Object.assign({ 'Content-Type': TYPES['.json'] }, ADMIN_HEADERS, headers));
}

function serveFile(req, res, root, urlPath, headers) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch (error) {
    throw new HttpError(400, 'Плохой адрес');
  }
  // Never serve dotfiles or the temporary files written during saves.
  if (/(^|\/)\.|[\\\0]/.test(rel) || /\.tmp$/.test(rel)) throw new HttpError(404, 'Не найдено');
  let file = path.join(root, path.normalize(`/${rel}`));
  if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(404, 'Не найдено');
  let stat = fs.statSync(file, { throwIfNoEntry: false });
  if (stat && stat.isDirectory()) {
    file = path.join(file, 'index.html');
    stat = fs.statSync(file, { throwIfNoEntry: false });
  }
  if (!stat || !stat.isFile()) throw new HttpError(404, 'Не найдено');
  res.writeHead(
    200,
    Object.assign(
      { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size },
      headers
    )
  );
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
}

// --- Login ---

function sendLogin(res, { message = '', next = '/admin/', disabled = false } = {}) {
  const page = fs
    .readFileSync(path.join(ADMIN_DIR, 'login.html'), 'utf8')
    .replace('{{message}}', message ? `<p class="login-error" role="alert">${escape(message)}</p>` : '')
    .replace('{{next}}', escape(next))
    .replace(/\{\{disabled\}\}/g, disabled ? 'disabled' : '');
  send(res, 200, page, LOGIN_HEADERS);
}

async function login(req, res) {
  checkOrigin(req);
  const form = new URLSearchParams((await readBody(req, 4096)).toString('utf8'));
  const next = safeNext(form.get('next'));
  const ip = clientIp(req);
  if (lockedOut(ip)) return sendLogin(res, { message: 'Слишком много попыток входа. Подожди 15 минут.', next });
  const auth = readAuth(store.DATA_DIR);
  if (!auth) return sendLogin(res, { message: NOT_CONFIGURED, disabled: true });
  if (!verifyPassword(form.get('password') || '', auth.hash)) {
    recordFailure(ip);
    return sendLogin(res, { message: 'Пароль не подошёл. Попробуй ещё раз.', next });
  }
  failures.delete(ip);
  return redirect(res, next, { 'Set-Cookie': sessionCookie(createSession(auth), isHttps(req)) });
}

// --- Previews: a rendered draft gets a short-lived link the admin shows in a frame ---

const PREVIEW_LIMIT = 10;
const PREVIEW_MS = 30 * 60 * 1000;
const previews = new Map();

function rememberPreview(page) {
  const token = crypto.randomBytes(12).toString('hex');
  previews.set(token, { page, at: Date.now() });
  while (previews.size > PREVIEW_LIMIT) previews.delete(previews.keys().next().value);
  return token;
}

function servePreview(res, token) {
  const entry = previews.get(token);
  if (!entry || Date.now() - entry.at > PREVIEW_MS) {
    throw new HttpError(404, 'Предпросмотр устарел — нажми «Предпросмотр» в админке ещё раз.');
  }
  send(res, 200, entry.page, {
    'Content-Type': TYPES['.html'],
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "frame-ancestors 'self'",
  });
}

// --- Routes ---

function adminState() {
  const record = store.current();
  return { sections: store.sections, content: record.content, version: record.version, history: store.history(), dev: DEV };
}

async function api(req, route) {
  if (route === '/state' && req.method === 'GET') return adminState();
  if (route === '/content' && req.method === 'PUT') {
    const body = parseJson((await readBody(req, 1e6)).toString('utf8'));
    store.save(body.content, { baseVersion: body.version });
    return adminState();
  }
  if (route === '/restore' && req.method === 'POST') {
    const body = parseJson((await readBody(req, 1e4)).toString('utf8'));
    store.restore(body.id, { baseVersion: body.version });
    return adminState();
  }
  if (route === '/upload' && req.method === 'POST') {
    return { src: store.saveUpload(await readBody(req, 8e6)) };
  }
  if (route === '/preview' && req.method === 'POST') {
    const body = parseJson((await readBody(req, 1e6)).toString('utf8'));
    return { url: `/admin/preview/${rememberPreview(store.preview(body.content))}` };
  }
  throw new HttpError(404, 'Не найдено');
}

async function handleAdmin(req, res, route) {
  if (route === '/' || route === '/admin.js') return serveFile(req, res, ADMIN_DIR, route, ADMIN_HEADERS);
  const preview = /^\/preview\/([a-f0-9]{24})$/.exec(route);
  if (preview && req.method === 'GET') return servePreview(res, preview[1]);
  if (route === '/api/logout' && req.method === 'POST') {
    checkSameOrigin(req);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(null, isHttps(req)) });
  }
  if (route.startsWith('/api/')) {
    if (req.method !== 'GET') checkSameOrigin(req);
    return sendJson(res, 200, await api(req, route.slice('/api'.length)));
  }
  throw new HttpError(404, 'Не найдено');
}

async function handle(req, res) {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  if (pathname === '/admin') return redirect(res, '/admin/');
  if (pathname.startsWith('/admin/')) {
    const route = pathname.slice('/admin'.length);
    // The stylesheet is shared with the login page, so it is open to everyone.
    if (route === '/admin.css') return serveFile(req, res, ADMIN_DIR, route, ADMIN_HEADERS);
    if (route === '/login') {
      if (req.method === 'POST') return login(req, res);
      if (signedIn(req)) return redirect(res, '/admin/');
      if (!readAuth(store.DATA_DIR)) return sendLogin(res, { message: NOT_CONFIGURED, disabled: true });
      return sendLogin(res, { next: safeNext(searchParams.get('next')) });
    }
    if (!signedIn(req)) {
      if (route.startsWith('/api/')) throw new HttpError(401, 'Нужно войти заново');
      return redirect(res, `/admin/login?next=${encodeURIComponent(pathname)}`);
    }
    return handleAdmin(req, res, route);
  }
  const immutable = pathname.startsWith('/uploads/');
  return serveFile(req, res, store.SITE_DIR, pathname, {
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
}

function fail(req, res, error) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  let status = 500;
  if (error instanceof HttpError) status = error.status;
  else if (error instanceof store.ValidationError) status = 400;
  else if (error instanceof store.ConflictError) status = 409;
  if (status === 500) console.error(error);
  const message = status === 500 ? 'Ошибка на сервере' : error.message;
  if (req.url.startsWith('/admin/api/')) {
    sendJson(res, status, { error: message, details: error.details });
    return;
  }
  // Locally the site's own "page not found" (Caddy serves the same file in production).
  const notFound = path.join(store.SITE_DIR, '404.html');
  if (status === 404 && !req.url.startsWith('/admin') && fs.existsSync(notFound)) {
    send(res, 404, fs.readFileSync(notFound), { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
    return;
  }
  send(res, status, message, { 'Content-Type': TYPES['.txt'] });
}

store.build();

http
  .createServer((req, res) => {
    handle(req, res).catch(error => fail(req, res, error));
  })
  .listen(PORT, HOST, () => {
    const base = `http://${HOST}:${PORT}`;
    console.log(`Сайт: ${base}/  Админка: ${base}/admin/${DEV ? '  (dev, без пароля)' : ''}`);
    if (!DEV && !readAuth(store.DATA_DIR)) console.warn(NOT_CONFIGURED);
  });
