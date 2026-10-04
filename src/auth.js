'use strict';

// Admin login: one password, kept only as a scrypt hash in data/auth.json, and a signed
// session cookie. Setting a new password also replaces the signing secret, so every
// device that was logged in has to log in again.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;
const COOKIE = 'le_admin';
const MIN_LENGTH = 10;

const authFile = dataDir => path.join(dataDir, 'auth.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, key] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/** The stored login, or null while no password has been set. Read on every use, so a new password works without a restart. */
function readAuth(dataDir) {
  try {
    const record = JSON.parse(fs.readFileSync(authFile(dataDir), 'utf8'));
    return record && record.hash && record.secret ? record : null;
  } catch (error) {
    return null;
  }
}

function writeAuth(dataDir, password) {
  const record = { hash: hashPassword(password), secret: crypto.randomBytes(32).toString('hex'), updatedAt: new Date().toISOString() };
  const file = authFile(dataDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return record;
}

const sign = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

/** Token "<expires>.<nonce>.<signature>"; nothing about the session is stored on the server. */
function createSession(auth) {
  const payload = `${Date.now() + SESSION_DAYS * 864e5}.${crypto.randomBytes(9).toString('base64url')}`;
  return `${payload}.${sign(auth.secret, payload)}`;
}

function checkSession(auth, token) {
  if (!auth || !token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const expected = Buffer.from(sign(auth.secret, `${parts[0]}.${parts[1]}`));
  const actual = Buffer.from(parts[2]);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) && Number(parts[0]) > Date.now();
}

function readCookie(req) {
  const found = String(req.headers.cookie || '')
    .split(/;\s*/)
    .find(part => part.startsWith(`${COOKIE}=`));
  return found ? found.slice(COOKIE.length + 1) : null;
}

// Lax still sends the cookie when the admin link is opened from Telegram,
// and keeps it off cross-site form posts and requests.
function sessionCookie(token, secure) {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return [`${COOKIE}=${token || ''}`, 'Path=/admin', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, secure && 'Secure']
    .filter(Boolean)
    .join('; ');
}

module.exports = { MIN_LENGTH, readAuth, writeAuth, verifyPassword, createSession, checkSession, readCookie, sessionCookie };
