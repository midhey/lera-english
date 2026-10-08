'use strict';

// Admin page. The home screen lists the sections of the site; each section opens its own
// screen with the fields. The draft lives in memory until «Опубликовать»; on wide screens
// a live preview next to the form shows the site with the draft applied.

const PRESETS = {
  portrait: { maxWidth: 1200, maxHeight: 1500 },
  card: { maxWidth: 960, maxHeight: 960 },
  avatar: { square: 256 },
};
const TELEGRAM = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z0-9_]{4,32})\/?$/;
const NOTES = { initial: 'Начальная версия', edit: 'Публикация из админки' };

const state = {
  sections: [],
  content: null,
  published: null, // content as it is on the site, to see what changed
  version: null,
  history: [],
  busy: false,
  invalid: new Set(),
};
const openItems = new Set();
let uid = 0;
let afterRender = null;

const $ = id => document.getElementById(id);
const panel = $('panel');
const statusBox = $('status');
const errorsBox = $('errors');
const publishButton = $('publish');
const previewButton = $('preview');
const discardButton = $('discard');
const homeLink = document.querySelector('.brand');

// --- Small helpers ---

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  Object.keys(props || {}).forEach(key => {
    const value = props[key];
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') node.value = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  });
  children.flat(Infinity).forEach(child => {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  });
  return node;
}

const keyOf = path => path.join('.');
const getIn = (path, from = state.content) => path.reduce((value, key) => (value == null ? undefined : value[key]), from);
const pathOf = dotted => dotted.split('.');
const copy = value => JSON.parse(JSON.stringify(value));

function setIn(path, value) {
  getIn(path.slice(0, -1))[path[path.length - 1]] = value;
  changed();
}

const formatDate = iso =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const timeNow = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function plural(n, forms) {
  const tens = n % 100;
  const ones = n % 10;
  if (ones === 1 && tens !== 11) return forms[0];
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return forms[1];
  return forms[2];
}

function autosize(textarea) {
  if (!textarea.offsetParent) return; // inside a closed item; sized again when it opens
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

async function api(url, options = {}) {
  const headers = Object.assign({ 'X-Requested-With': 'le-admin' }, options.headers);
  if (typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(url, { method: options.method || 'GET', headers, body: options.body, credentials: 'same-origin' });
  } catch (error) {
    throw new Error('Нет связи с сервером. Проверь интернет и попробуй ещё раз.');
  }
  if (response.status === 401) {
    // The login expired. Without unpublished edits just go to the login page; with them,
    // keep this tab and offer to log in next to it.
    const loginUrl = `/admin/login?next=${encodeURIComponent(`/admin/${location.hash}`)}`;
    if (!state.content || !changedSections().length) location.href = loginUrl;
    const error = new Error('Вход закончился. Войди снова в соседней вкладке и повтори действие — правки здесь сохранятся.');
    error.loginUrl = loginUrl;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Ошибка ${response.status}`);
    error.details = data.details;
    throw error;
  }
  return data;
}

// --- What changed, status bar ---

const sectionChanged = section =>
  section.groups.some(group => JSON.stringify(state.content[group.key]) !== JSON.stringify(state.published[group.key]));
const changedSections = () => state.sections.filter(sectionChanged);

function showStatus(text, kind) {
  statusBox.textContent = text;
  statusBox.className = kind ? `status ${kind}` : 'status';
}

function updateBar() {
  const pending = changedSections();
  publishButton.disabled = state.busy || !pending.length;
  previewButton.disabled = state.busy;
  discardButton.hidden = state.busy || !pending.length;
  if (state.busy) return;
  if (pending.length) showStatus(`Не опубликовано: ${pending.map(section => section.title).join(', ')}`, 'warn');
  else if (statusBox.classList.contains('warn')) showStatus('Всё опубликовано', 'ok');
}

function setBusy(busy, message) {
  state.busy = busy;
  updateBar();
  if (message) showStatus(message);
}

// Called after every edit.
function changed() {
  updateBar();
  schedulePreview();
}

function showErrors(problems, title = 'Что поправить перед публикацией:') {
  errorsBox.textContent = '';
  errorsBox.hidden = !(problems && problems.length);
  if (errorsBox.hidden) return;
  errorsBox.append(
    el(
      'div',
      { class: 'errors-head' },
      el('strong', { text: title }),
      el('button', { type: 'button', class: 'link-btn', onclick: () => showErrors(null) }, 'Скрыть')
    ),
    el(
      'ul',
      {},
      problems.map(problem => {
        if (typeof problem === 'string' || problem instanceof Node) return el('li', {}, problem);
        return el('li', {}, el('button', { type: 'button', class: 'problem', onclick: () => goTo(problem) }, problem.message));
      })
    )
  );
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleError(error) {
  showStatus(error.message || 'Что-то пошло не так', 'error');
  if (error.loginUrl) {
    showErrors([el('a', { href: error.loginUrl, target: '_blank', rel: 'noopener', text: 'Открыть вход в новой вкладке ↗' })], 'Нужно войти снова:');
  } else if (error.details && error.details.length) {
    showErrors(error.details);
  }
}

// --- Checks before publishing (the server repeats them; here they point at the field) ---

function check(spec, path, trail, sectionId, problems) {
  const value = getIn(path);
  const add = message => problems.push({ sectionId, path, message: `${trail.join(' → ')}: ${message}` });
  if (spec.type === 'group') {
    spec.fields.forEach(child => check(child, path.concat(child.key), trail.concat(child.label), sectionId, problems));
  } else if (spec.type === 'list') {
    const items = value || [];
    if (items.length < (spec.min || 0)) add(`нужно хотя бы ${spec.min}`);
    items.forEach((item, i) => check(spec.item, path.concat(i), trail.concat(`${spec.itemLabel} ${i + 1}`), sectionId, problems));
  } else if (spec.type === 'image') {
    if (!value && !spec.optional) add('нужно фото');
  } else if (spec.type === 'telegram') {
    if (!TELEGRAM.test(String(value || '').trim())) add('нужен ник вроде @vallex_english или ссылка t.me/…');
  } else {
    const text = String(value || '').trim();
    if (spec.required && !text) add('заполни поле');
    if (spec.max && text.length > spec.max) add(`слишком длинно — ${text.length} из ${spec.max}`);
  }
}

function validate() {
  const problems = [];
  state.sections.forEach(section =>
    section.groups.forEach(group => {
      const trail = section.groups.length > 1 ? [section.title, group.label] : [section.title];
      group.fields.forEach(spec => check(spec, [group.key, spec.key], trail.concat(spec.label), section.id, problems));
    })
  );
  return problems;
}

// Opens the section and every list item on the way to the field, then focuses it.
function goTo(problem) {
  problem.path.forEach((key, i) => {
    if (typeof key === 'number') openItems.add(keyOf(problem.path.slice(0, i + 1)));
  });
  afterRender = () => {
    const node = panel.querySelector(`[data-path="${keyOf(problem.path)}"]`);
    if (!node) return;
    node.scrollIntoView({ block: 'center' });
    const input = node.matches('input, textarea') ? node : node.querySelector('input:not([type=file]), textarea, label');
    if (input && input.focus) input.focus({ preventScroll: true });
  };
  navigate(`#/s/${problem.sectionId}`);
}

// --- Fields ---

function renderField(spec, path) {
  if (spec.type === 'list') return renderList(spec, path);
  if (spec.type === 'image') return renderImage(spec, path);
  if (spec.type === 'telegram') return renderTelegram(spec, path);
  return renderText(spec, path);
}

function fieldWrap(path, ...children) {
  const key = keyOf(path);
  return el('div', { class: state.invalid.has(key) ? 'field invalid' : 'field', 'data-path': key }, children);
}

function clearInvalid(path, node) {
  if (!state.invalid.delete(keyOf(path))) return;
  const wrap = node.closest('.field');
  if (wrap) wrap.classList.remove('invalid');
  if (!state.invalid.size) showErrors(null);
}

function textInput(spec, path, ariaLabel) {
  const multiline = spec.multiline || spec.long;
  const input = el(multiline ? 'textarea' : 'input', {
    class: 'input',
    id: `f${++uid}`,
    type: multiline ? null : 'text',
    rows: multiline ? 2 : null,
    maxlength: spec.max,
    placeholder: spec.placeholder,
    'aria-label': ariaLabel,
    'data-path': keyOf(path),
    value: getIn(path) || '',
  });
  // "Long" fields are one line of text that just needs room to wrap.
  if (spec.long) input.addEventListener('keydown', event => event.key === 'Enter' && event.preventDefault());
  input.addEventListener('input', () => {
    clearInvalid(path, input);
    setIn(path, spec.long ? input.value.replace(/\s*\n\s*/g, ' ') : input.value);
  });
  if (multiline) {
    input.addEventListener('input', () => autosize(input));
    requestAnimationFrame(() => autosize(input));
  }
  return input;
}

// Shows how *accented* words will look, only while there are asterisks in the text.
function accentSample(input) {
  const sample = el('div', { class: 'accent-sample' });
  const draw = () => {
    const value = input.value;
    sample.textContent = '';
    sample.hidden = !/\*[^*\n]+\*/.test(value);
    if (sample.hidden) return;
    sample.append(el('span', { class: 'accent-label', text: 'Так будет: ' }));
    value.split(/(\*[^*\n]+\*)/).forEach(part => {
      if (/^\*[^*\n]+\*$/.test(part)) sample.append(el('em', { text: part.slice(1, -1) }));
      else sample.append(part.replace(/\n/g, ' '));
    });
  };
  input.addEventListener('input', draw);
  draw();
  return sample;
}

function renderText(spec, path) {
  const input = textInput(spec, path);
  const counter = spec.max ? el('span', { class: 'counter' }) : null;
  const count = () => {
    if (!counter) return;
    const length = input.value.length;
    counter.textContent = `${length} / ${spec.max}`;
    counter.hidden = length < spec.max * 0.6;
    counter.classList.toggle('full', length >= spec.max);
  };
  input.addEventListener('input', count);
  count();
  const helpText = [spec.accent && 'Чтобы выделить слова, оберни их звёздочками: *так*.', spec.help].filter(Boolean).join(' ');
  return fieldWrap(
    path,
    el('label', { class: 'label', for: input.id }, spec.label, spec.required && el('span', { class: 'required', text: ' *' })),
    input,
    spec.accent && accentSample(input),
    (helpText || counter) && el('div', { class: 'meta' }, helpText && el('p', { class: 'help', text: helpText }), counter)
  );
}

function renderTelegram(spec, path) {
  const node = renderText(Object.assign({}, spec, { max: 80, placeholder: '@vallex_english' }), path);
  const input = node.querySelector('input');
  const hint = el('div', { class: 'hint' });
  const check = () => {
    const match = TELEGRAM.exec(input.value.trim());
    hint.textContent = '';
    hint.className = match ? 'hint' : 'hint bad';
    if (match) {
      hint.append('Кнопки ведут на ', el('a', { href: `https://t.me/${match[1]}`, target: '_blank', rel: 'noopener', text: `t.me/${match[1]} ↗` }));
    } else {
      hint.textContent = 'Нужен ник вроде @vallex_english или ссылка t.me/…';
    }
  };
  input.addEventListener('input', check);
  check();
  input.after(hint);
  return node;
}

// Photos are resized in the browser: phone pictures are huge, and re-encoding also
// drops the EXIF data with the location where the photo was taken.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не получилось открыть фото. Попробуй JPG или PNG.'));
    };
    img.src = url;
  });
}

const canvasBlob = (canvas, type, quality) => new Promise(resolve => canvas.toBlob(resolve, type, quality));

async function prepareImage(file, preset) {
  const img = await loadImage(file);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  let crop = { x: 0, y: 0, width, height };
  let size;
  if (preset.square) {
    const side = Math.min(width, height);
    crop = { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side };
    size = { width: Math.min(preset.square, side), height: Math.min(preset.square, side) };
  } else {
    const scale = Math.min(1, preset.maxWidth / width, preset.maxHeight / height);
    size = { width: Math.round(width * scale), height: Math.round(height * scale) };
  }
  const canvas = el('canvas', { width: size.width, height: size.height });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  let blob = await canvasBlob(canvas, 'image/webp', 0.82);
  // Safari cannot encode WebP and quietly returns PNG — use JPEG there.
  if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(canvas, 'image/jpeg', 0.86);
  if (!blob) throw new Error('Не получилось обработать фото');
  return { blob, width: size.width, height: size.height };
}

function renderImage(spec, path) {
  const value = getIn(path);
  const round = spec.preset === 'avatar' ? ' round' : '';
  const fileInput = el('input', { type: 'file', accept: 'image/*', id: `f${++uid}`, class: 'visually-hidden' });
  const node = fieldWrap(
    path,
    el('div', { class: 'label', text: spec.label }),
    el(
      'div',
      { class: 'image-field' },
      value
        ? el('img', { class: `thumb${round}`, src: `/${value.src}`, alt: '' })
        : el('div', { class: `thumb empty${round}`, text: 'Нет фото' }),
      el(
        'div',
        { class: 'image-side' },
        el(
          'div',
          { class: 'image-actions' },
          fileInput,
          el('label', { class: 'btn small', for: fileInput.id }, value ? 'Заменить фото' : 'Загрузить фото'),
          value &&
            spec.optional &&
            el('button', { type: 'button', class: 'btn small danger', onclick: () => (setIn(path, null), refresh()) }, 'Убрать')
        ),
        value && spec.alt && renderText({ label: 'Что на фото', max: 200, help: 'Коротко — для поисковиков и незрячих.' }, path.concat('alt')),
        spec.help && el('p', { class: 'help', text: spec.help })
      )
    )
  );

  function refresh() {
    node.replaceWith(renderImage(spec, path));
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    setBusy(true, 'Загружаю фото…');
    try {
      const image = await prepareImage(file, PRESETS[spec.preset]);
      const uploaded = await api('/admin/api/upload', {
        method: 'POST',
        body: image.blob,
        headers: { 'Content-Type': image.blob.type },
      });
      const next = { src: uploaded.src, width: image.width, height: image.height };
      if (spec.alt) next.alt = (value && value.alt) || '';
      state.invalid.delete(keyOf(path));
      setBusy(false);
      setIn(path, next);
      refresh();
      showStatus('Фото загружено — опубликуй, чтобы оно появилось на сайте', 'warn');
    } catch (error) {
      setBusy(false);
      handleError(error);
    }
  });
  return node;
}

// --- Lists ---

function blank(spec) {
  if (spec.type === 'group') {
    const out = {};
    spec.fields.forEach(child => {
      out[child.key] = blank(child);
    });
    return out;
  }
  if (spec.type === 'list') return Array.from({ length: spec.min || 0 }, () => blank(spec.item));
  if (spec.type === 'image') return null;
  return '';
}

const itemTitle = (spec, item, index) =>
  (spec.titleKeys || [])
    .map(key => String((item && item[key]) || '').trim())
    .filter(Boolean)
    .join(' · ') || `${spec.itemLabel} ${index + 1}`;

// Open items are remembered by path; moving or deleting shifts the paths.
function remapOpen(listPath, mapIndex) {
  const prefix = `${keyOf(listPath)}.`;
  const moved = [];
  openItems.forEach(key => {
    if (!key.startsWith(prefix)) return;
    openItems.delete(key);
    const rest = key.slice(prefix.length);
    const dot = rest.indexOf('.');
    const next = mapIndex(Number(dot < 0 ? rest : rest.slice(0, dot)));
    if (next >= 0) moved.push(prefix + next + (dot < 0 ? '' : rest.slice(dot)));
  });
  moved.forEach(key => openItems.add(key));
}

function renderList(spec, path) {
  if (!Array.isArray(getIn(path))) getIn(path.slice(0, -1))[path[path.length - 1]] = [];
  const node = el('div', { class: 'list', 'data-path': keyOf(path) });
  const fixed = spec.min !== undefined && spec.min === spec.max;

  const move = (index, delta) => {
    const items = getIn(path);
    const target = index + delta;
    [items[index], items[target]] = [items[target], items[index]];
    remapOpen(path, i => (i === index ? target : i === target ? index : i));
    changed();
    draw();
  };

  const remove = index => {
    const items = getIn(path);
    if (spec.item.type === 'group' && !confirm(`Удалить «${itemTitle(spec, items[index], index)}»?`)) return;
    items.splice(index, 1);
    remapOpen(path, i => (i === index ? -1 : i > index ? i - 1 : i));
    changed();
    draw();
  };

  const add = () => {
    const items = getIn(path);
    items.push(blank(spec.item));
    const index = items.length - 1;
    if (spec.item.type === 'group') openItems.add(keyOf(path.concat(index)));
    changed();
    draw();
    const added = node.querySelectorAll(':scope > .item, :scope > .row')[index];
    const first = added && added.querySelector('input:not([type=file]), textarea');
    if (first) first.focus();
  };

  const controls = (index, count) => {
    const name = `${spec.itemLabel} ${index + 1}`;
    // Buttons sit inside <summary>; without preventDefault a click would also fold the item.
    const action = handler => event => {
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
    return el(
      'div',
      { class: 'controls' },
      el('button', { type: 'button', class: 'icon-btn', title: 'Выше', 'aria-label': `Выше: ${name}`, disabled: index === 0, onclick: action(() => move(index, -1)) }, '↑'),
      el('button', { type: 'button', class: 'icon-btn', title: 'Ниже', 'aria-label': `Ниже: ${name}`, disabled: index === count - 1, onclick: action(() => move(index, 1)) }, '↓'),
      !fixed &&
        el(
          'button',
          { type: 'button', class: 'icon-btn danger', title: 'Удалить', 'aria-label': `Удалить: ${name}`, disabled: count <= (spec.min || 0), onclick: action(() => remove(index)) },
          '✕'
        )
    );
  };

  const card = (index, count) => {
    const itemPath = path.concat(index);
    const key = keyOf(itemPath);
    const title = el('span', { class: 'item-title' });
    const updateTitle = () => {
      title.textContent = itemTitle(spec, getIn(itemPath), index);
    };
    updateTitle();
    const details = el(
      'details',
      { class: 'item', open: openItems.has(key) },
      el('summary', { class: 'item-summary' }, title, controls(index, count)),
      el('div', { class: 'item-body' }, spec.item.fields.map(child => renderField(child, itemPath.concat(child.key))))
    );
    details.addEventListener('toggle', () => {
      if (details.open) openItems.add(key);
      else openItems.delete(key);
      details.querySelectorAll('textarea').forEach(autosize);
    });
    details.addEventListener('input', updateTitle);
    return details;
  };

  const row = (index, count) =>
    el('div', { class: 'row' }, textInput(spec.item, path.concat(index), `${spec.itemLabel} ${index + 1}`), controls(index, count));

  function draw() {
    const items = getIn(path);
    node.textContent = '';
    node.classList.toggle('invalid', state.invalid.has(keyOf(path)));
    node.append(el('div', { class: 'label', text: spec.label }));
    if (spec.help) node.append(el('p', { class: 'help', text: spec.help }));
    if (!items.length && spec.empty) node.append(el('p', { class: 'empty-note', text: spec.empty }));
    items.forEach((item, index) => node.append(spec.item.type === 'group' ? card(index, items.length) : row(index, items.length)));
    if (!fixed && (!spec.max || items.length < spec.max)) {
      node.append(el('button', { type: 'button', class: 'btn add', onclick: add }, `+ ${spec.addLabel || 'Добавить'}`));
    }
  }

  draw();
  return node;
}

// --- Screens ---

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'history') return { screen: 'history', anchor: 'top' };
  const match = /^s\/([\w-]+)$/.exec(hash);
  const section = match && state.sections.find(item => item.id === match[1]);
  if (section) return { screen: 'section', section, anchor: section.anchor };
  return { screen: 'home', anchor: 'top' };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function summarize(section) {
  const spec = section.summary;
  if (spec.count) {
    const n = (getIn(pathOf(spec.count)) || []).length;
    return n ? `${n} ${plural(n, spec.forms)}` : '';
  }
  if (spec.join) {
    return (getIn(pathOf(spec.join)) || [])
      .map(item => item[spec.key])
      .filter(Boolean)
      .join(', ');
  }
  return String(getIn(pathOf(spec.text)) || '')
    .replace(/^https?:\/\//, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderHome() {
  const card = section => {
    const summary = summarize(section);
    const hidden = section.summary.hideable && !summary;
    return el(
      'a',
      { class: 'card', href: `#/s/${section.id}` },
      el(
        'div',
        { class: 'card-head' },
        el('span', { class: 'card-title', text: section.title }),
        sectionChanged(section) && el('span', { class: 'pill changed', text: 'изменено' }),
        hidden && el('span', { class: 'pill hidden-on-site', text: 'скрыт на сайте' })
      ),
      el('div', { class: 'card-where', text: section.where }),
      el('div', {
        class: summary ? 'card-summary' : 'card-summary empty',
        text: summary || (hidden ? 'Пока пусто — добавь первый пункт' : section.summary.empty || 'Не заполнено'),
      })
    );
  };
  return el(
    'div',
    { class: 'screen' },
    el('h1', { class: 'screen-title', text: 'Что поменять?' }),
    el('p', { class: 'lead', text: 'Выбери раздел сайта. Правки видишь только ты, пока не нажмёшь «Опубликовать».' }),
    el('h2', { class: 'kind', text: 'Часто меняют' }),
    el('div', { class: 'cards' }, state.sections.filter(section => section.kind === 'main').map(card)),
    el('h2', { class: 'kind', text: 'Тексты на странице' }),
    el('div', { class: 'cards' }, state.sections.filter(section => section.kind === 'page').map(card)),
    el('h2', { class: 'kind', text: 'Если что-то пошло не так' }),
    el(
      'a',
      { class: 'card', href: '#/history' },
      el('div', { class: 'card-head' }, el('span', { class: 'card-title', text: 'История публикаций' })),
      el('div', { class: 'card-where', text: 'Все прошлые версии сайта — любую можно вернуть' })
    )
  );
}

function renderSeoMockup() {
  const node = el('div', { class: 'group' });
  const draw = () => {
    const seo = state.content.seo;
    node.textContent = '';
    node.append(
      el('h2', { class: 'group-title', text: 'Так это выглядит' }),
      el('p', { class: 'mock-label', text: 'В поиске Яндекса' }),
      el(
        'div',
        { class: 'serp' },
        el('div', { class: 'serp-url', text: location.host }),
        el('div', { class: 'serp-title', text: seo.title }),
        el('div', { class: 'serp-text', text: seo.description })
      ),
      el('p', { class: 'mock-label', text: 'Ссылка в Telegram' }),
      el(
        'div',
        { class: 'share' },
        el('div', { class: 'share-site', text: 'Vallex English' }),
        el('div', { class: 'share-title', text: seo.shareTitle }),
        el('div', { class: 'share-text', text: seo.shareDescription }),
        el('img', { src: '/assets/images/social-preview.jpg', alt: '' })
      )
    );
  };
  draw();
  return { node, draw };
}

function renderSection(section) {
  const screen = el(
    'div',
    { class: 'screen' },
    el(
      'div',
      { class: 'screen-head' },
      el('h1', { class: 'screen-title', text: section.title }),
      section.anchor && el('button', { type: 'button', class: 'btn small', onclick: () => showOnSite(section.anchor) }, 'Показать на сайте')
    ),
    el('p', { class: 'lead', text: section.where })
  );
  section.groups.forEach(group => {
    const main = group.fields.filter(spec => !spec.extra);
    const extras = group.fields.filter(spec => spec.extra);
    const box = el(
      'div',
      { class: 'group' },
      section.groups.length > 1 && el('h2', { class: 'group-title', text: group.label }),
      main.map(spec => renderField(spec, [group.key, spec.key]))
    );
    if (extras.length) {
      const open = extras.some(spec => state.invalid.has(keyOf([group.key, spec.key])));
      box.append(
        el(
          'details',
          { class: 'extras', open },
          el('summary', {}, 'Мелочи оформления', el('span', { class: 'help', text: 'стикеры и рукописные надписи' })),
          extras.map(spec => renderField(spec, [group.key, spec.key]))
        )
      );
    }
    screen.append(box);
  });
  if (section.mockup) {
    const mockup = renderSeoMockup();
    screen.append(mockup.node);
    screen.addEventListener('input', mockup.draw);
  }
  return screen;
}

function renderHistory() {
  const describe = entry =>
    entry.note === 'restore' && entry.from ? `Возврат к версии от ${formatDate(entry.from)}` : NOTES[entry.note] || '';
  return el(
    'div',
    { class: 'screen' },
    el('h1', { class: 'screen-title', text: 'История публикаций' }),
    el('p', { class: 'lead', text: 'Каждая публикация сохраняется. Если что-то пошло не так, верни сайт к прошлой версии — текущая тоже останется в истории.' }),
    el(
      'div',
      { class: 'group' },
      state.history.map(entry =>
        el(
          'div',
          { class: 'history-row' },
          el('div', {}, el('div', { class: 'history-date', text: formatDate(entry.savedAt) }), el('p', { class: 'help', text: describe(entry) })),
          entry.id === state.version
            ? el('span', { class: 'badge', text: 'сейчас на сайте' })
            : el('button', { type: 'button', class: 'btn small', onclick: () => restore(entry) }, 'Вернуть')
        )
      )
    )
  );
}

function render() {
  const current = route();
  panel.textContent = '';
  if (current.screen === 'section') panel.append(renderSection(current.section));
  else if (current.screen === 'history') panel.append(renderHistory());
  else panel.append(renderHome());
  homeLink.textContent = '';
  if (current.screen === 'home') {
    homeLink.className = 'brand';
    homeLink.append(el('span', { class: 'mark', text: 'Ve' }), 'админка сайта');
  } else {
    homeLink.className = 'brand back';
    homeLink.textContent = '‹ Все разделы';
  }
  document.title = current.screen === 'section' ? `${current.section.title} — админка` : 'Админка — Vallex English';
  updateBar();
  focusPreview(current.anchor, current.screen === 'section');
  if (afterRender) {
    const run = afterRender;
    afterRender = null;
    setTimeout(run, 0);
  }
}

// --- Preview ---

const pane = {
  root: document.querySelector('.pane'),
  stage: $('stage'),
  frame: null,
  device: 'desktop',
  anchor: 'top',
  timer: null,
  loading: false,
  queued: false,
};
const wide = window.matchMedia('(min-width: 1100px)');

async function previewUrl() {
  const { url } = await api('/admin/api/preview', { method: 'POST', body: JSON.stringify({ content: state.content }) });
  return url;
}

// The preview page is the real site; hide its own banner and let the admin outline a section.
function prepareFrame(frame) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const banner = doc.querySelector('.preview-banner');
  if (banner) banner.remove();
  doc.documentElement.style.scrollBehavior = 'auto';
  const style = doc.createElement('style');
  style.textContent = '.admin-highlight{outline:3px dashed #E9782F!important;outline-offset:4px}';
  doc.head.append(style);
}

function scrollFrame(frame, anchor, highlight) {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return;
  const target = anchor && anchor !== 'top' ? doc.getElementById(anchor) : null;
  win.scrollTo(0, target ? Math.max(0, target.getBoundingClientRect().top + win.scrollY - 16) : 0);
  if (highlight && target) {
    target.classList.add('admin-highlight');
    setTimeout(() => target.classList.remove('admin-highlight'), 1600);
  }
}

function layoutFrame(frame = pane.frame) {
  if (!frame) return;
  const width = pane.stage.clientWidth;
  const height = pane.stage.clientHeight;
  if (pane.device === 'phone') {
    frame.style.width = '390px';
    frame.style.height = `${height - 32}px`;
    frame.style.top = '16px';
    frame.style.left = `${Math.max(0, (width - 390) / 2)}px`;
    frame.style.transform = '';
  } else {
    // The desktop layout is drawn at 1280px and scaled down to the panel.
    const scale = Math.min(1, width / 1280);
    frame.style.width = '1280px';
    frame.style.height = `${height / scale}px`;
    frame.style.top = '0';
    frame.style.left = '0';
    frame.style.transform = `scale(${scale})`;
  }
}

// Loads the new draft into a hidden frame and swaps it in, so the picture never flickers.
function swapFrame(url) {
  return new Promise(resolve => {
    const old = pane.frame;
    const sameSpot = old && old.dataset.anchor === pane.anchor && old.contentWindow;
    const scrollY = sameSpot ? old.contentWindow.scrollY : null;
    const frame = el('iframe', { class: 'pane-frame loading', src: url, title: 'Предпросмотр сайта', tabindex: '-1' });
    frame.dataset.anchor = pane.anchor;
    frame.addEventListener(
      'load',
      () => {
        prepareFrame(frame);
        if (scrollY !== null) frame.contentWindow.scrollTo(0, scrollY);
        else scrollFrame(frame, pane.anchor, false);
        frame.classList.remove('loading');
        if (old) old.remove();
        pane.frame = frame;
        resolve();
      },
      { once: true }
    );
    pane.stage.append(frame);
    layoutFrame(frame);
  });
}

async function refreshPreview() {
  if (!wide.matches) return;
  if (pane.loading) {
    pane.queued = true;
    return;
  }
  pane.loading = true;
  try {
    await swapFrame(await previewUrl());
  } catch (error) {
    // The old picture stays; publishing reports problems on its own.
  }
  pane.loading = false;
  if (pane.queued) {
    pane.queued = false;
    refreshPreview();
  }
}

function schedulePreview() {
  if (!wide.matches) return;
  clearTimeout(pane.timer);
  pane.timer = setTimeout(refreshPreview, 600);
}

// Scrolls the side preview to the section being edited.
function focusPreview(anchor, highlight) {
  pane.anchor = anchor || 'top';
  if (!wide.matches || !pane.frame) return;
  pane.frame.dataset.anchor = pane.anchor;
  scrollFrame(pane.frame, pane.anchor, highlight);
}

// On phones the preview opens over the admin, scrolled to the section.
async function openPreview(anchor) {
  setBusy(true, 'Готовлю предпросмотр…');
  let url;
  try {
    url = await previewUrl();
  } catch (error) {
    setBusy(false);
    handleError(error);
    return;
  }
  setBusy(false);
  const close = () => {
    layer.remove();
    document.body.classList.remove('previewing');
    document.removeEventListener('keydown', onKey);
    previewButton.focus();
  };
  const onKey = event => event.key === 'Escape' && close();
  const closeButton = el('button', { type: 'button', class: 'btn small primary', onclick: close }, 'Закрыть');
  const frame = el('iframe', { src: url, title: 'Предпросмотр сайта', class: 'preview-frame' });
  frame.addEventListener('load', () => {
    prepareFrame(frame);
    scrollFrame(frame, anchor, true);
  });
  const layer = el(
    'div',
    { class: 'preview-layer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Предпросмотр сайта' },
    el(
      'div',
      { class: 'preview-bar' },
      el('strong', { text: 'Предпросмотр' }),
      el('a', { href: url, target: '_blank', rel: 'noopener', class: 'preview-link', text: 'В новой вкладке ↗' }),
      closeButton
    ),
    frame
  );
  document.body.append(layer);
  document.body.classList.add('previewing');
  document.addEventListener('keydown', onKey);
  closeButton.focus();
}

function showOnSite(anchor) {
  if (wide.matches && pane.frame) focusPreview(anchor, true);
  else openPreview(anchor);
}

function setDevice(device) {
  pane.device = device;
  pane.root.dataset.device = device;
  pane.root.querySelectorAll('[data-device]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.device === device)));
  layoutFrame();
}

// --- Actions ---

function applyState(data) {
  state.dev = Boolean(data.dev);
  state.sections = data.sections;
  state.content = data.content;
  state.published = copy(data.content);
  state.version = data.version;
  state.history = data.history;
}

async function publish() {
  if (state.busy || !changedSections().length) return;
  const problems = validate();
  state.invalid = new Set(problems.map(problem => keyOf(problem.path)));
  if (problems.length) {
    render();
    showErrors(problems);
    showStatus('Не опубликовано — поправь отмеченные поля', 'error');
    return;
  }
  showErrors(null);
  setBusy(true, 'Публикую…');
  const sent = JSON.stringify(state.content);
  try {
    const data = await api('/admin/api/content', { method: 'PUT', body: JSON.stringify({ content: state.content, version: state.version }) });
    state.version = data.version;
    state.history = data.history;
    state.published = copy(data.content);
    // Edits typed while the request was in flight stay as a new draft.
    if (JSON.stringify(state.content) === sent) state.content = data.content;
    setBusy(false);
    render();
    showStatus(`Опубликовано ✓ ${timeNow()}`, 'ok');
  } catch (error) {
    setBusy(false);
    handleError(error);
  }
}

function discard() {
  if (!confirm('Отменить все неопубликованные изменения? Вернётся то, что сейчас на сайте.')) return;
  state.content = copy(state.published);
  state.invalid.clear();
  showErrors(null);
  render();
  showStatus('Изменения отменены', 'ok');
  schedulePreview();
}

async function restore(entry) {
  const when = formatDate(entry.savedAt);
  const warning = changedSections().length ? '\n\nНеопубликованные изменения пропадут.' : '';
  if (!confirm(`Вернуть сайт к версии от ${when}?${warning}`)) return;
  setBusy(true, 'Возвращаю версию…');
  showErrors(null);
  try {
    applyState(await api('/admin/api/restore', { method: 'POST', body: JSON.stringify({ id: entry.id, version: state.version }) }));
    setBusy(false);
    render();
    showStatus(`Сайт вернулся к версии от ${when} ✓`, 'ok');
    schedulePreview();
  } catch (error) {
    setBusy(false);
    handleError(error);
  }
}

async function init() {
  try {
    applyState(await api('/admin/api/state'));
  } catch (error) {
    panel.textContent = '';
    panel.append(el('p', { class: 'lead', text: `Не удалось загрузить админку: ${error.message}` }));
    return;
  }
  // Locally the admin runs without a password, so there is nothing to log out of.
  $('logout').hidden = state.dev;
  render();
  showStatus('Всё опубликовано', 'ok');
  startPreview();
}

async function logout() {
  if (changedSections().length && !confirm('Неопубликованные изменения пропадут. Всё равно выйти?')) return;
  try {
    await api('/admin/api/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    // already signed out
  }
  state.content = null; // no "leave the page?" question
  location.href = '/admin/login';
}

function startPreview() {
  if (!wide.matches) return;
  setDevice(pane.stage.clientWidth >= 640 ? 'desktop' : 'phone');
  refreshPreview();
}

publishButton.addEventListener('click', publish);
previewButton.addEventListener('click', () => openPreview(route().anchor));
discardButton.addEventListener('click', discard);
$('logout').addEventListener('click', logout);
pane.root.querySelectorAll('[data-device]').forEach(button => button.addEventListener('click', () => setDevice(button.dataset.device)));
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});
wide.addEventListener('change', startPreview);
window.addEventListener('resize', () => {
  layoutFrame();
  document.querySelectorAll('textarea').forEach(autosize);
});
// Ctrl+S / Cmd+S publishes; e.code keeps it working on the Russian layout too.
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
    event.preventDefault();
    publish();
  }
});
window.addEventListener('beforeunload', event => {
  if (!state.content || !changedSections().length) return;
  event.preventDefault();
  event.returnValue = '';
});
init();
