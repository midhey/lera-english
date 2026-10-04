'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { render, renderNotFound } = require('./render');
const { sections, cleanContent, isPlainObject } = require('./schema');

const ROOT = path.join(__dirname, '..');
// On the server the content and uploads live outside the deployed code and survive redeploys.
const SITE_DIR = path.resolve(process.env.SITE_DIR || path.join(ROOT, 'public'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const SITE_URL = (process.env.SITE_URL || 'https://lera.midhey.ru').replace(/\/+$/, '');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const CURRENT_FILE = path.join(DATA_DIR, 'content.json');
const HISTORY_LIMIT = 100;
const VERSION_ID = /^\d{8}T\d{9}Z(?:-\d+)?$/;

const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'content.default.json'), 'utf8'));

class ValidationError extends Error {
  constructor(details, message = 'Не получилось опубликовать — проверь поля') {
    super(message);
    this.details = details;
  }
}

class ConflictError extends Error {}

// Content saved before a field existed gets that field's default value.
function withDefaults(value, defaults) {
  if (!isPlainObject(defaults)) return value === undefined ? defaults : value;
  const source = isPlainObject(value) ? value : {};
  const out = {};
  Object.keys(defaults).forEach(key => {
    out[key] = withDefaults(source[key], defaults[key]);
  });
  return out;
}

const normalize = content => cleanContent(withDefaults(content, DEFAULTS), { siteDir: SITE_DIR }).content;

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function newVersionId() {
  const base = new Date().toISOString().replace(/[-:.]/g, '');
  let id = base;
  for (let n = 1; fs.existsSync(path.join(HISTORY_DIR, `${id}.json`)); n++) id = `${base}-${n}`;
  return id;
}

function historyFiles() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs
    .readdirSync(HISTORY_DIR)
    .filter(name => VERSION_ID.test(name.replace(/\.json$/, '')))
    .sort()
    .reverse();
}

function persist(record) {
  const json = `${JSON.stringify(record, null, 2)}\n`;
  writeAtomic(path.join(HISTORY_DIR, `${record.version}.json`), json);
  writeAtomic(CURRENT_FILE, json);
  historyFiles()
    .slice(HISTORY_LIMIT)
    .forEach(name => fs.unlinkSync(path.join(HISTORY_DIR, name)));
}

/** The published version: { version, savedAt, note, content }. */
function current() {
  if (!fs.existsSync(CURRENT_FILE)) {
    persist({ version: newVersionId(), savedAt: new Date().toISOString(), note: 'initial', content: DEFAULTS });
  }
  const record = readJson(CURRENT_FILE);
  record.content = normalize(record.content);
  return record;
}

function history() {
  return historyFiles().map(name => {
    const record = readJson(path.join(HISTORY_DIR, name));
    return { id: record.version, savedAt: record.savedAt, note: record.note, from: record.from };
  });
}

// Versioned links make browsers pick up new CSS/JS right after a deploy.
function asset(rel) {
  const file = path.join(SITE_DIR, rel);
  if (!fs.existsSync(file)) return rel;
  const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
  return `${rel}?v=${hash}`;
}

const renderPage = (content, preview = false) => render(content, { siteUrl: SITE_URL, asset, preview });

function writeSite(page, content, savedAt) {
  writeAtomic(path.join(SITE_DIR, 'index.html'), page);
  writeAtomic(path.join(SITE_DIR, '404.html'), renderNotFound(content, { asset }));
  writeAtomic(path.join(SITE_DIR, 'robots.txt'), `User-agent: *\nDisallow: /admin\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  writeAtomic(
    path.join(SITE_DIR, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      `  <url><loc>${SITE_URL}/</loc><lastmod>${savedAt.slice(0, 10)}</lastmod></url>\n` +
      '</urlset>\n'
  );
}

/** Rebuilds the site from the published content (on start and after a deploy). */
function build() {
  const record = current();
  writeSite(renderPage(record.content), record.content, record.savedAt);
  return record;
}

/** Validates, records a new version and republishes the page. */
function save(input, { baseVersion, note = 'edit', from } = {}) {
  const now = current();
  if (baseVersion && baseVersion !== now.version) {
    throw new ConflictError('Сайт уже изменили в другой вкладке или на другом устройстве. Обнови страницу.');
  }
  const { content, errors } = cleanContent(input, { siteDir: SITE_DIR });
  if (errors.length) throw new ValidationError(errors);
  // Render before writing anything, so a template error never leaves a half-saved state.
  const page = renderPage(content);
  const record = { version: newVersionId(), savedAt: new Date().toISOString(), note, from, content };
  persist(record);
  writeSite(page, content, record.savedAt);
  return record;
}

function restore(id, { baseVersion } = {}) {
  const file = path.join(HISTORY_DIR, `${id}.json`);
  if (!VERSION_ID.test(String(id)) || !fs.existsSync(file)) throw new ConflictError('Такой версии уже нет в истории.');
  const record = readJson(file);
  return save(normalize(record.content), { baseVersion, note: 'restore', from: record.savedAt });
}

/** Page for the preview button: the draft is cleaned the same way, errors are ignored. */
const preview = input => renderPage(normalize(input), true);

const UPLOAD_TYPES = [
  { ext: 'webp', test: b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { ext: 'jpg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

/** Stores an image the admin already resized; returns its path relative to the site root. */
function saveUpload(buffer) {
  const type = UPLOAD_TYPES.find(candidate => candidate.test(buffer));
  if (!type) throw new ValidationError([], 'Можно загрузить только фото (JPG или WebP)');
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const rel = `uploads/${hash}.${type.ext}`;
  const file = path.join(SITE_DIR, rel);
  if (!fs.existsSync(file)) writeAtomic(file, buffer);
  return rel;
}

module.exports = {
  sections,
  current,
  history,
  build,
  save,
  restore,
  preview,
  saveUpload,
  ValidationError,
  ConflictError,
  SITE_DIR,
  SITE_URL,
  DATA_DIR,
};
