'use strict';

const fs = require('fs');
const path = require('path');

// What the admin can edit, as Lera sees it: sections of the site with the fields she fills in.
// The admin builds its screens from this, and the server checks every save against it.
const field = type => (key, label, max, ...options) => Object.assign({ type, key, label, max }, ...options);
const text = field('text');
const area = (key, label, max, ...options) => text(key, label, max, { multiline: true }, ...options);
const image = (key, label, preset, ...options) => Object.assign({ type: 'image', key, label, preset }, ...options);
const list = (key, label, item, ...options) => Object.assign({ type: 'list', key, label, item }, ...options);
const group = (key, label, fields) => ({ type: 'group', key, label, fields });

const REQUIRED = { required: true };
// Words in *asterisks* become the accented part of a heading; the admin shows how it will look.
const ACCENT = { accent: true };
// Stickers and handwritten notes are tucked away under «Мелочи оформления».
const EXTRA = { extra: true };
const point = (label, max) => text(null, label, max, REQUIRED);
const help = value => ({ help: value });
const example = value => ({ placeholder: value });

const PARAGRAPHS = help('Чтобы начать новый абзац, оставь пустую строку.');
const NEW_LINE = help('Enter — перенос на новую строку.');

const sections = [
  {
    id: 'contacts',
    title: 'Контакты',
    where: 'Куда ведут все кнопки «Записаться» на сайте',
    kind: 'main',
    anchor: 'signup',
    summary: { text: 'contacts.telegram' },
    groups: [
      group('contacts', 'Контакты', [
        { type: 'telegram', key: 'telegram', label: 'Ник или ссылка в Telegram', help: 'Например, @vallex_english или t.me/vallex_english.' },
      ]),
    ],
  },
  {
    id: 'prices',
    title: 'Цены',
    where: 'Карточки с тарифами — после отзывов',
    kind: 'main',
    anchor: 'prices',
    summary: { count: 'prices.items', forms: ['тариф', 'тарифа', 'тарифов'], hideable: true },
    groups: [
      group('prices', 'Цены', [
        list(
          'items',
          'Тарифы',
          group(null, 'Тариф', [
            text('price', 'Цена', 24, REQUIRED, example('1 500 ₽'), help('Как напишешь, так и будет: «1 500 ₽», «бесплатно», «от 1 200 ₽».')),
            text('title', 'Название', 40, REQUIRED, example('Разовое занятие')),
            area('note', 'Подробности', 160, example('60 минут, индивидуально')),
            text('badge', 'Наклейка на углу', 20, example('выгодно'), help('Необязательно — розовая наклейка, чтобы выделить тариф.')),
          ]),
          {
            max: 6,
            itemLabel: 'Тариф',
            titleKeys: ['title', 'price'],
            addLabel: 'Добавить тариф',
            empty: 'Тарифов пока нет, поэтому блока «Цены» на сайте не видно. Он появится, когда добавишь первый.',
          }
        ),
        text('title', 'Заголовок блока', 60, REQUIRED, ACCENT),
        area('note', 'Примечание под ценами', 300, example('Оплата переводом после урока. Перенос — бесплатно, если предупредить за 12 часов.')),
        area('aside', 'Рукописная надпись справа от заголовка', 60, EXTRA, NEW_LINE),
      ]),
    ],
  },
  {
    id: 'reviews',
    title: 'Отзывы',
    where: 'Сообщения учеников на зелёном фоне',
    kind: 'main',
    anchor: 'reviews',
    summary: { count: 'reviews.items', forms: ['отзыв', 'отзыва', 'отзывов'], hideable: true },
    groups: [
      group('reviews', 'Отзывы', [
        list(
          'items',
          'Отзывы',
          group(null, 'Отзыв', [
            text('name', 'Имя', 40, REQUIRED, example('Аня')),
            text('topic', 'Чем занимается', 60, example('английский для работы'), help('Пишется рядом с именем: «Аня · английский для работы».')),
            area('text', 'Текст отзыва', 600, REQUIRED),
            image('photo', 'Фото', 'avatar', { optional: true }, help('Необязательно — без фото будет кружок с первой буквой имени.')),
            text('caption', 'Подпись под отзывом', 40, example('из Telegram, сентябрь'), help('Необязательно, мелким шрифтом.')),
          ]),
          {
            max: 12,
            itemLabel: 'Отзыв',
            titleKeys: ['name', 'topic'],
            addLabel: 'Добавить отзыв',
            empty: 'Отзывов пока нет, поэтому блока на сайте не видно. Он появится, когда добавишь первый.',
          }
        ),
        area('title', 'Заголовок блока', 60, REQUIRED, ACCENT, NEW_LINE),
        area('lead', 'Текст под заголовком', 160),
        area('note', 'Примечание мелким шрифтом', 200, help('Например, «Публикую с разрешения учеников». Если пусто — не показывается.')),
        text('cta', 'Кнопка рядом с отзывами', 50, help('Ведёт в Telegram. Если пусто — кнопки нет.')),
        area('sticker', 'Белый стикер (только на компьютере)', 40, EXTRA, NEW_LINE),
      ]),
    ],
  },
  {
    id: 'faq',
    title: 'Вопросы и ответы',
    where: 'Раскрывающиеся вопросы перед записью',
    kind: 'main',
    anchor: 'faq',
    summary: { count: 'faq.items', forms: ['вопрос', 'вопроса', 'вопросов'], hideable: true },
    groups: [
      group('faq', 'Вопросы и ответы', [
        list(
          'items',
          'Вопросы',
          group(null, 'Вопрос', [
            text('question', 'Вопрос', 140, REQUIRED, example('Я совсем с нуля — подойдёт?')),
            area('answer', 'Ответ', 1000, REQUIRED, PARAGRAPHS),
          ]),
          {
            max: 15,
            itemLabel: 'Вопрос',
            titleKeys: ['question'],
            addLabel: 'Добавить вопрос',
            empty: 'Вопросов пока нет, поэтому блока на сайте не видно. Он появится, когда добавишь первый.',
          }
        ),
        text('title', 'Заголовок блока', 60, REQUIRED, ACCENT),
        area('aside', 'Рукописная надпись у заголовка', 60, EXTRA, help('Ведёт в Telegram. Enter — перенос на новую строку.')),
      ]),
    ],
  },
  {
    id: 'about',
    title: 'Обо мне',
    where: 'Фото, рассказ о себе и пункты с галочками',
    kind: 'main',
    anchor: 'about',
    summary: { text: 'about.text' },
    groups: [
      group('about', 'Обо мне', [
        text('title', 'Заголовок', 60, REQUIRED, ACCENT),
        area('text', 'Рассказ о себе', 1500, REQUIRED, PARAGRAPHS),
        list('points', 'Пункты с галочками', point('Пункт', 90), {
          max: 8,
          itemLabel: 'Пункт',
          addLabel: 'Добавить пункт',
          help: 'Коротко, по одной мысли: образование, сертификаты, опыт, подход.',
        }),
        image('photo', 'Фото', 'portrait', { alt: true }),
        area('sticker', 'Розовый стикер на фото', 40, EXTRA, NEW_LINE),
      ]),
    ],
  },
  {
    id: 'hero',
    title: 'Первый экран',
    where: 'Самый верх страницы: заголовок, фото и главная кнопка',
    kind: 'page',
    anchor: 'top',
    summary: { text: 'hero.title' },
    groups: [
      group('hero', 'Первый экран', [
        area('title', 'Главный заголовок', 80, REQUIRED, ACCENT, help('Выделенные слова подсвечиваются розовым маркером.')),
        area('lead', 'Текст под заголовком', 300),
        text('button', 'Надпись на кнопке', 40, REQUIRED),
        image('photo', 'Фото', 'portrait', { alt: true }, help('На сайте обрезается до пропорции 4:5 по центру — лицо лучше держать посередине.')),
        list('badges', 'Короткие преимущества', point('Пункт', 30), {
          max: 6,
          itemLabel: 'Пункт',
          addLabel: 'Добавить пункт',
          help: 'Строчки с оранжевыми точками под кнопкой.',
        }),
        text('eyebrow', 'Строчка над заголовком', 50, EXTRA, help('Мелкими заглавными буквами.')),
        area('note', 'Рукописная фраза у кнопки', 60, EXTRA, NEW_LINE),
        text('photoCaption', 'Подпись на полароиде', 30, EXTRA),
        area('stickerTop', 'Розовый стикер у фото', 50, EXTRA, NEW_LINE),
        area('stickerBottom', 'Белый стикер под фото (только на компьютере)', 30, EXTRA, NEW_LINE),
      ]),
    ],
  },
  {
    id: 'goals',
    title: 'Цели',
    where: 'Четыре карточки «Выбери свою цель» — переворачиваются по нажатию',
    kind: 'page',
    anchor: 'goals',
    summary: { join: 'goals.cards', key: 'title' },
    groups: [
      group('goals', 'Цели', [
        text('title', 'Заголовок блока', 60, REQUIRED, ACCENT),
        list(
          'cards',
          'Карточки',
          group(null, 'Карточка', [
            text('title', 'Название', 20, REQUIRED),
            area('text', 'Текст на лицевой стороне', 110, REQUIRED),
            image('photo', 'Фото на лицевой стороне', 'card', { optional: true, alt: true }),
            text('backTitle', 'Заголовок на обороте', 30, REQUIRED),
            list('backItems', 'Пункты на обороте', point('Пункт', 60), { min: 1, max: 3, itemLabel: 'Пункт', addLabel: 'Добавить пункт' }),
          ]),
          {
            min: 4,
            max: 4,
            itemLabel: 'Карточка',
            titleKeys: ['title'],
            help: 'Карточек всегда четыре — под них сделана раскладка. Порядок можно менять стрелками.',
          }
        ),
      ]),
    ],
  },
  {
    id: 'steps',
    title: 'Как проходят занятия',
    where: 'Шаги от пробного урока до результата',
    kind: 'page',
    anchor: 'steps',
    summary: { count: 'steps.items', forms: ['шаг', 'шага', 'шагов'] },
    groups: [
      group('steps', 'Как проходят занятия', [
        text('title', 'Заголовок блока', 60, REQUIRED, ACCENT),
        list(
          'items',
          'Шаги',
          group(null, 'Шаг', [text('title', 'Название', 40, REQUIRED), area('text', 'Текст', 200, REQUIRED)]),
          { min: 1, max: 6, itemLabel: 'Шаг', titleKeys: ['title'], addLabel: 'Добавить шаг' }
        ),
        area('aside', 'Рукописная надпись справа от заголовка', 60, EXTRA, NEW_LINE),
      ]),
    ],
  },
  {
    id: 'signup',
    title: 'Запись внизу',
    where: 'Розовый блок с кнопкой в конце страницы',
    kind: 'page',
    anchor: 'signup',
    summary: { text: 'signup.title' },
    groups: [
      group('signup', 'Запись внизу', [
        text('title', 'Заголовок', 60, REQUIRED, ACCENT),
        area('text', 'Текст', 300),
        text('button', 'Надпись на кнопке', 40, REQUIRED),
        area('note', 'Подпись под кнопкой', 200),
        text('eyebrow', 'Рукописная надпись над заголовком', 30, EXTRA),
      ]),
    ],
  },
  {
    id: 'footer',
    title: 'Логотип и подвал',
    where: 'Логотип в шапке и нижняя строка с реквизитами',
    kind: 'page',
    anchor: 'footer',
    summary: { text: 'footer.legal', empty: 'Реквизиты не заполнены' },
    groups: [
      group('footer', 'Подвал', [
        area('legal', 'Реквизиты', 200, example('Фамилия Имя, самозанятая, ИНН …'), help('Мелким шрифтом в самом низу. Если пусто — строка не показывается.')),
        text('sign', 'Рукописная надпись в подвале', 40, EXTRA),
      ]),
      group('brand', 'Логотип', [text('mark', 'Буквы логотипа', 6, REQUIRED), area('tagline', 'Подпись рядом с логотипом', 50, NEW_LINE)]),
    ],
  },
  {
    id: 'seo',
    title: 'Поиск и ссылки',
    where: 'Как сайт выглядит в Яндексе и в мессенджерах, когда ссылкой делятся',
    kind: 'page',
    anchor: null,
    mockup: true,
    summary: { text: 'seo.title' },
    groups: [
      group('seo', 'Поиск и ссылки', [
        text('title', 'Заголовок в поиске и на вкладке браузера', 70, REQUIRED),
        text('description', 'Описание в поиске', 200, REQUIRED, { long: true }),
        text('shareTitle', 'Заголовок, когда ссылкой делятся', 90, REQUIRED),
        text('shareDescription', 'Описание, когда ссылкой делятся', 200, REQUIRED, { long: true }),
      ]),
    ],
  },
];

const IMAGE_PATH = /^(?:assets\/images\/[\w-]+\.(?:webp|jpe?g|png)|uploads\/[a-f0-9]{16}\.(?:webp|jpg))$/;
const TELEGRAM = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z0-9_]{4,32})\/?$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const telegramUsername = value => {
  const match = TELEGRAM.exec(String(value).trim());
  return match ? match[1] : null;
};

function cleanText(options, value) {
  const raw = (typeof value === 'string' ? value : '').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  if (!options.multiline) return raw.replace(/\s+/g, ' ').trim();
  return raw
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dimension(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : 0;
}

function clean(spec, value, trail, ctx) {
  const where = trail.join(' → ');
  switch (spec.type) {
    case 'group': {
      const source = isPlainObject(value) ? value : {};
      const out = {};
      spec.fields.forEach(child => {
        out[child.key] = clean(child, source[child.key], trail.concat(child.label), ctx);
      });
      return out;
    }
    case 'list': {
      const items = Array.isArray(value) ? value : [];
      const min = spec.min || 0;
      const max = spec.max || Infinity;
      if (items.length < min) ctx.errors.push(`${where}: нужно хотя бы ${min}`);
      if (items.length > max) ctx.errors.push(`${where}: не больше ${max}`);
      return items.slice(0, max).map((item, i) => clean(spec.item, item, trail.concat(`${spec.itemLabel} ${i + 1}`), ctx));
    }
    case 'image': {
      if (!isPlainObject(value) || !value.src) {
        if (!spec.optional) ctx.errors.push(`${where}: нужно фото`);
        return null;
      }
      const src = String(value.src);
      if (!IMAGE_PATH.test(src) || !fs.existsSync(path.join(ctx.siteDir, src))) {
        ctx.errors.push(`${where}: фото не найдено на сервере, загрузи его заново`);
        return null;
      }
      const out = { src, width: dimension(value.width), height: dimension(value.height) };
      if (spec.alt) out.alt = cleanText({}, value.alt).slice(0, 200);
      return out;
    }
    case 'telegram': {
      const username = telegramUsername(cleanText({}, value));
      if (!username) {
        ctx.errors.push(`${where}: нужен ник вроде @vallex_english или ссылка t.me/…`);
        return '';
      }
      return `https://t.me/${username}`;
    }
    default: {
      const out = cleanText(spec, value);
      if (spec.required && !out) ctx.errors.push(`${where}: заполни поле`);
      if (spec.max && out.length > spec.max) {
        ctx.errors.push(`${where}: слишком длинно — ${out.length} символов при максимуме ${spec.max}`);
      }
      return out;
    }
  }
}

/**
 * Brings any input to the shape the template expects: unknown keys are dropped,
 * missing ones get empty values. Returns the cleaned content and human-readable errors.
 */
function cleanContent(input, { siteDir }) {
  const ctx = { siteDir, errors: [] };
  const source = isPlainObject(input) ? input : {};
  const content = {};
  sections.forEach(section =>
    section.groups.forEach(part => {
      const trail = section.groups.length > 1 ? [section.title, part.label] : [section.title];
      content[part.key] = clean(part, source[part.key], trail, ctx);
    })
  );
  return { content, errors: ctx.errors };
}

module.exports = { sections, cleanContent, isPlainObject };
