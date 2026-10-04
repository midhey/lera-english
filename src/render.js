'use strict';

const { html, raw, lines, accent, paragraphs } = require('./html');

// Card looks go by position, so the layout keeps its rhythm whatever the texts are.
const GOAL_LOOKS = [
  { card: 'goals-11', face: 'goals-13', tape: 'goals-14', frame: 'goals-18' },
  { card: 'goals-28', face: 'goals-29', tape: 'goals-30', frame: 'goals-31' },
  { card: 'goals-32', face: 'goals-13', tape: 'goals-33', frame: 'goals-18' },
  { card: 'goals-34', face: 'goals-35', tape: 'goals-36', frame: 'goals-37' },
];
const STEP_LOOKS = [
  { card: 'steps-4', tape: 'steps-5' },
  { card: 'steps-9', tape: 'steps-10' },
  { card: 'steps-11', tape: 'steps-12' },
  { card: 'steps-13', tape: 'steps-14' },
];

// Sections in page order; the ones with an empty list are hidden together with their menu item.
const NAV = [
  { id: 'goals', label: 'Цели', mobileLabel: 'Цели занятий' },
  { id: 'about', label: 'Обо мне' },
  { id: 'steps', label: 'Занятия', mobileLabel: 'Как проходят занятия' },
  { id: 'reviews', label: 'Отзывы' },
  { id: 'prices', label: 'Цены' },
  { id: 'faq', label: 'Вопросы' },
];

const SITE_NAME = 'Английский с Лерой';
const SHARE_IMAGE = 'assets/images/social-preview.jpg';
// Fonts are served from this site (public/assets/fonts, rules in fonts.css). The three files
// the first screen needs — heading upright and italic, body text — start loading right away;
// their names carry the font version, so update them together with the files.
const PRELOAD_FONTS = ['playfair-display-cyrillic-v40', 'playfair-display-italic-500-cyrillic-v40', 'manrope-cyrillic-v20'];
const fontLinks = (asset, root = '') => html`${PRELOAD_FONTS.map(name => html`<link rel="preload" href="${root}assets/fonts/${name}.woff2" as="font" type="font/woff2" crossorigin>
  `)}<link rel="stylesheet" href="${root}${asset('assets/css/fonts.css')}">`;

const number = index => String(index + 1).padStart(2, '0');
const sizeAttrs = photo => (photo.width && photo.height ? html` width="${photo.width}" height="${photo.height}"` : '');
const initial = name => (Array.from(name.trim())[0] || '♡').toUpperCase();
const oneLine = text => text.replace(/\s*\n\s*/g, ' ');

const underline = (width, d, className = 'goals-5') =>
  html`<svg width="${width}" height="16" viewBox="0 0 ${width} 16" class="${className}"><path d="${d}" fill="none" stroke="#E9782F" stroke-width="5" stroke-linecap="round"></path></svg>`;

function goalCard(card, index) {
  const look = GOAL_LOOKS[index % GOAL_LOOKS.length];
  return html`
    <div data-i="${index}" aria-pressed="false" tabindex="0" role="button" aria-label="${card.title} — перевернуть карточку" class="${look.card}">
      <div class="goals-12">
        <div class="${look.face}">
          <div class="${look.tape}"></div>
          <div class="goals-15">${number(index)}</div>
          <h3 class="goals-16">${card.title}</h3>
          <p class="goals-17">${lines(card.text)}</p>
          <div class="${look.frame}">${card.photo && html`<img loading="lazy" decoding="async" src="${card.photo.src}" alt="${card.photo.alt}" draggable="false" class="goals-19">`}</div>
          <div class="goals-20">переверни ↻</div>
        </div>
        <div class="goals-21">
          <div class="goals-22">как проходят занятия</div>
          <h3 class="goals-23">${card.backTitle}</h3>
          <div class="goals-24">${card.backItems.map(item => html`
            <div class="goals-25"><span class="goals-26">✓</span>${item}</div>`)}
          </div>
          <div class="goals-27">↻ назад</div>
        </div>
      </div>
    </div>
`;
}

function step(item, index) {
  const look = STEP_LOOKS[index % STEP_LOOKS.length];
  return html`
    <div class="${look.card}">
      <div class="${look.tape}"></div>
      <div class="steps-6">${number(index)}</div>
      <h3 class="steps-7">${item.title}</h3>
      <p class="steps-8">${lines(item.text)}</p>
    </div>`;
}

// Reviews alternate sides of the chat: even ones on the left, odd ones on the right.
function review(item, index) {
  const left = index % 2 === 0;
  const avatar = item.photo
    ? html`<img class="reviews-10" src="${item.photo.src}" alt=""${sizeAttrs(item.photo)} loading="lazy" decoding="async">`
    : html`<span class="reviews-10 review-initial" aria-hidden="true">${initial(item.name)}</span>`;
  const bubble = html`
        <div class="${left ? 'reviews-11' : 'reviews-16'}">
          <div class="${left ? 'reviews-12' : 'reviews-17'}">${[item.name, item.topic].filter(Boolean).join(' · ')}</div>
          <div class="reviews-13">${lines(item.text)}</div>${item.caption && html`
          <div class="${left ? 'reviews-14' : 'reviews-18'}">${item.caption}</div>`}
        </div>`;
  return left
    ? html`
      <div class="reviews-9">
        ${avatar}${bubble}
      </div>`
    : html`
      <div class="reviews-15">${bubble}
        ${avatar}
      </div>`;
}

function price(item, index) {
  return html`
    <div class="price-card price-card-${index % 3}">
      <div class="price-tape"></div>${item.badge && html`
      <div class="price-badge">${item.badge}</div>`}
      <div class="price-value">${item.price}</div>
      <h3 class="price-name">${item.title}</h3>${item.note && html`
      <p class="price-note">${lines(item.note)}</p>`}
    </div>`;
}

// schema.org description for search engines: who teaches, what and where to sign up, plus the FAQ.
function structuredData(content, siteUrl) {
  const url = `${siteUrl}/`;
  const contact = content.contacts.telegram ? [content.contacts.telegram] : undefined;
  const graph = [
    { '@type': 'WebSite', '@id': `${url}#site`, url, name: SITE_NAME, inLanguage: 'ru-RU' },
    {
      '@type': 'Service',
      '@id': `${url}#service`,
      name: content.seo.title,
      description: content.seo.description,
      serviceType: 'Индивидуальные онлайн-занятия английским языком',
      url,
      image: `${siteUrl}/${SHARE_IMAGE}`,
      availableChannel: contact && { '@type': 'ServiceChannel', serviceUrl: contact[0] },
      provider: {
        '@type': 'Person',
        name: 'Лера',
        jobTitle: 'Репетитор английского языка',
        image: content.hero.photo ? `${siteUrl}/${content.hero.photo.src}` : undefined,
        sameAs: contact,
      },
    },
  ];
  if (content.faq.items.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: content.faq.items.map(item => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    });
  }
  // "<" escaped, so no text from the admin can close the script tag.
  return raw(JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c'));
}

const question = item => html`
    <details class="faq-item">
      <summary class="faq-question">${item.question}<span class="faq-icon" aria-hidden="true"></span></summary>
      <div class="faq-answer">${paragraphs(item.answer, 'faq-text')}</div>
    </details>`;

/**
 * Renders the whole page from the admin content.
 * options.siteUrl — absolute address for canonical and link previews;
 * options.asset(path) — adds a version to CSS/JS links;
 * options.preview — page opened from the admin before publishing.
 */
function render(content, { siteUrl, asset = path => path, preview = false }) {
  const { brand, contacts, seo, hero, goals, about, steps, reviews, prices, faq, signup, footer } = content;
  const telegram = html`href="${contacts.telegram}" target="_blank" rel="noopener noreferrer"`;
  const hidden = {
    steps: !steps.items.length,
    reviews: !reviews.items.length,
    prices: !prices.items.length,
    faq: !faq.items.length,
  };
  const nav = NAV.filter(item => !hidden[item.id]);

  // Previews stay still: the admin reloads them after every edit.
  return `<!DOCTYPE html>\n${html`<html lang="ru"${preview && html` class="still"`}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">${preview && html`
  <base href="/">
  <meta name="robots" content="noindex">`}
  <meta name="description" content="${seo.description}">
  <meta name="theme-color" content="#213D32">
  <title>${seo.title}</title>
  <meta property="og:type" content="website">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${seo.shareTitle}">
  <meta property="og:description" content="${seo.shareDescription}">
  <link rel="canonical" href="${siteUrl}/">
  <meta property="og:url" content="${siteUrl}/">
  <meta property="og:image" content="${siteUrl}/${SHARE_IMAGE}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1122">
  <meta property="og:image:height" content="1402">
  <meta property="og:image:alt" content="Лера — преподаватель английского языка">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${structuredData(content, siteUrl)}</script>
  <link rel="icon" href="assets/images/favicon.svg" type="image/svg+xml">
  ${fontLinks(asset)}
  <link rel="stylesheet" href="${asset('assets/css/styles.css')}">
  <script src="${asset('assets/js/main.js')}" defer></script>
</head>
<body>${preview && html`
<div class="preview-banner">Предпросмотр — изменения ещё не опубликованы</div>`}
<a class="skip-link" href="#main-content">Перейти к содержимому</a>
<header class="header-1">
  <a href="#top" class="header-2">
    <span class="header-3">${brand.mark}</span>
    <span class="header-4">${lines(brand.tagline)}</span>
  </a>
  <div class="desktop-only">
    <nav aria-label="Основная навигация" class="header-5">${nav.map(item => html`
      <a href="#${item.id}" class="header-6">${item.label}</a>`)}
    </nav>
  </div>
  <a ${telegram} class="header-7 header-8">Пробный урок →</a>
  <details class="mobile-menu">
    <summary aria-label="Меню разделов сайта">Меню <span class="menu-icon" aria-hidden="true"><span></span><span></span><span></span></span></summary>
    <nav aria-label="Мобильная навигация">${nav.map(item => html`
      <a href="#${item.id}">${item.mobileLabel || item.label}</a>`)}
      <a ${telegram}>Записаться на пробный урок →</a>
    </nav>
  </details>
</header>

<main id="main-content">
<section id="top" class="top-1">
  <div class="top-2">${hero.eyebrow && html`
    <div class="top-3">${hero.eyebrow}</div>`}
    <h1 class="top-4">${accent(hero.title, 'top-5')}</h1>${hero.lead && html`
    <p class="top-6">${lines(hero.lead)}</p>`}
    <div class="top-7">
      <a ${telegram} class="top-8 header-8">${hero.button} <span>→</span></a>${hero.note && html`
      <div class="top-9">${lines(hero.note)}</div>`}
    </div>${hero.badges.length > 0 && html`
    <div class="top-10">${hero.badges.map(badge => html`
      <span class="top-11"><span class="top-12"></span>${badge}</span>`)}
    </div>`}
  </div>

  <div class="top-13">
    <svg width="130" height="54" viewBox="0 0 130 54" class="top-14"><path d="M6 40 C 24 8, 40 6, 46 30 S 72 50, 84 22 S 108 4, 124 16" fill="none" stroke="#E9782F" stroke-width="6" stroke-linecap="round"></path></svg>
    <div class="top-15">
      <div class="top-16">
        <div class="top-17"></div>
        ${hero.photo
          ? html`<img class="top-18 hero-photo" src="${hero.photo.src}" alt="${hero.photo.alt}"${sizeAttrs(hero.photo)} fetchpriority="high" decoding="async">`
          : html`<div class="top-18"></div>`}${hero.photoCaption && html`
        <div class="top-19">${hero.photoCaption}</div>`}
      </div>
    </div>${hero.stickerTop && html`
    <div class="top-20">
      <div class="top-21">${lines(hero.stickerTop)}</div>
    </div>`}
    <div class="desktop-only">${hero.stickerBottom && html`
      <div class="top-22">
        <div class="top-23"></div>
        <div class="top-24">${lines(hero.stickerBottom)}</div>
      </div>`}
      <svg width="110" height="60" viewBox="0 0 110 60" class="top-25"><path d="M6 50 C 30 44, 62 34, 96 12" fill="none" stroke="#E9782F" stroke-width="5" stroke-linecap="round"></path><path d="M78 10 L 98 10 L 92 30" fill="none" stroke="#E9782F" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
    </div>
  </div>
</section>

<section id="goals" class="goals-1">
  <div class="goals-2">
    <div class="goals-3">
      <h2 class="goals-4">${accent(goals.title, 'title-accent')}</h2>
      ${underline(220, 'M4 10 C 60 4, 140 4, 216 8')}
    </div>
    <div class="goals-6">
      <div class="goals-7"><span class="drag-hint">Перетаскивай карточки<br>и нажми, чтобы перевернуть ↓</span><span class="tap-hint">Нажми на карточку,<br>чтобы узнать больше ↓</span></div>
      <button type="button" id="reset-goals" class="goals-8 goals-9">↺ Разложить заново</button>
    </div>
  </div>

  <div class="goals-10 goals-board">${goals.cards.map(goalCard)}  </div>
</section>

<section id="about" class="about-1">
  <div class="about-2">
    <div class="about-3">
      <div class="about-4">
        <div class="about-5"></div>
        <div class="about-6"></div>${about.photo && html`
        <img class="about-photo" src="${about.photo.src}" alt="${about.photo.alt}"${sizeAttrs(about.photo)} loading="lazy" decoding="async">`}
      </div>
    </div>${about.sticker && html`
    <div class="about-8">
      <div class="about-9">${lines(about.sticker)}</div>
    </div>`}
  </div>
  <div class="about-10">
    <h2 class="goals-4">${accent(about.title, 'about-11')}</h2>
    ${paragraphs(about.text, 'about-12')}${about.points.length > 0 && html`
    <div class="about-13">${about.points.map(point => html`
      <div class="about-14"><span class="about-15">✓</span>${point}</div>`)}
    </div>`}
  </div>
</section>
${!hidden.steps && html`
<section id="steps" class="steps-1">
  <div class="steps-2">
    <div>
      <h2 class="goals-4">${accent(steps.title, 'title-accent')}</h2>
      ${underline(260, 'M4 9 C 70 3, 170 4, 256 9')}
    </div>${steps.aside && html`
    <div class="goals-7">${lines(steps.aside)}</div>`}
  </div>
  <div class="steps-3">${steps.items.map(step)}
  </div>
</section>
`}${!hidden.reviews && html`
<section id="reviews" class="reviews-1">
  <div class="reviews-2">
    <div class="reviews-3">
      <div class="reviews-intro">
        <div class="reviews-intro-body">
          <h2 class="goals-4">${accent(reviews.title, 'title-accent')}</h2>
          ${underline(200, 'M4 10 C 60 3, 130 4, 196 8', 'reviews-4')}${reviews.lead && html`
          <p class="reviews-5">${lines(reviews.lead)}</p>`}${reviews.note && html`
          <p class="reviews-demo-note">${lines(reviews.note)}</p>`}${reviews.cta && html`
          <div class="desktop-only"><a ${telegram} class="reviews-cta">${reviews.cta} <span>→</span></a></div>`}
        </div>
      </div>${reviews.sticker && html`
      <div class="desktop-only">
        <div class="reviews-6">
          <div class="reviews-7">${lines(reviews.sticker)}</div>
        </div>
      </div>`}
    </div>
    <div class="reviews-8">${reviews.items.map(review)}
    </div>${reviews.cta && html`
    <div class="mobile-only"><a ${telegram} class="reviews-cta">${reviews.cta} <span>→</span></a></div>`}
  </div>
</section>
`}${!hidden.prices && html`
<section id="prices" class="prices">
  <div class="steps-2">
    <div>
      <h2 class="goals-4">${accent(prices.title, 'title-accent')}</h2>
      ${underline(220, 'M4 10 C 60 4, 140 4, 216 8')}
    </div>${prices.aside && html`
    <div class="goals-7">${lines(prices.aside)}</div>`}
  </div>
  <div class="prices-grid">${prices.items.map(price)}
  </div>${prices.note && html`
  <p class="prices-note">${lines(prices.note)}</p>`}
</section>
`}${!hidden.faq && html`
<section id="faq" class="faq">
  <div class="faq-head">
    <div>
      <h2 class="goals-4">${accent(faq.title, 'title-accent')}</h2>
      ${underline(260, 'M4 9 C 70 3, 170 4, 256 9')}
    </div>${faq.aside && html`
    <a ${telegram} class="goals-7 faq-aside">${lines(faq.aside)}</a>`}
  </div>
  <div class="faq-list">${faq.items.map(question)}
  </div>
</section>
`}
<section id="signup" class="signup-1">
  <div class="signup-2">
    <div class="signup-3"></div>
    <div class="signup-4"></div>
    <div class="signup-5">${signup.eyebrow && html`
      <div class="signup-6">${signup.eyebrow}</div>`}
      <h2 class="signup-7">${accent(signup.title, 'title-accent')}</h2>${signup.text && html`
      <p class="signup-8">${lines(signup.text)}</p>`}
      <a ${telegram}${signup.note && html` aria-describedby="signup-contact"`} class="signup-9 signup-10">${signup.button} <span>→</span></a>${signup.note && html`
      <p id="signup-contact" class="contact-note">${lines(signup.note)}</p>`}
    </div>
  </div>
</section>

</main>

<footer id="footer" class="footer-1">
  <div class="footer-2"><span class="footer-3">${brand.mark}</span>${oneLine(brand.tagline)}</div>${footer.sign && html`
  <div class="goals-20">${footer.sign}</div>`}${footer.legal && html`
  <div class="footer-legal">${lines(footer.legal)}</div>`}
</footer>
</body>
</html>
`.value}`;
}

// "Page not found": served for any missing address, so every link here is absolute.
function renderNotFound(content, { asset = path => path }) {
  const { brand } = content;
  return `<!DOCTYPE html>\n${html`<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#213D32">
  <title>Страница не найдена — ${SITE_NAME}</title>
  <link rel="icon" href="/assets/images/favicon.svg" type="image/svg+xml">
  ${fontLinks(asset, '/')}
  <link rel="stylesheet" href="/${asset('assets/css/styles.css')}">
</head>
<body>
<header class="header-1">
  <a href="/" class="header-2">
    <span class="header-3">${brand.mark}</span>
    <span class="header-4">${lines(brand.tagline)}</span>
  </a>
</header>
<main class="notfound">
  <div class="signup-6">Ой!</div>
  <h1 class="signup-7">Такой страницы нет</h1>
  <p class="signup-8">Возможно, ссылка устарела. Всё самое важное — на главной.</p>
  <a href="/" class="top-8 header-8">На главную <span>→</span></a>
</main>
</body>
</html>
`.value}`;
}

module.exports = { render, renderNotFound };
