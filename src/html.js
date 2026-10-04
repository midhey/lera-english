'use strict';

// Tagged template for the page markup: every interpolated value is escaped
// unless it is markup produced by html`` itself, so texts from the admin
// can never break the page or inject tags.
class Markup {
  constructor(value) {
    this.value = value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = value => String(value).replace(/[&<>"']/g, ch => ESCAPES[ch]);

function stringify(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Markup) return value.value;
  if (Array.isArray(value)) return value.map(stringify).join('');
  return escape(value);
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += stringify(value) + strings[i + 1];
  });
  return new Markup(out);
}

// Text with line breaks. The newline kept after <br> still separates the words
// where CSS hides the break (the hero note on phones).
const lines = text => new Markup(escape(text).replace(/\n/g, '<br>\n'));

// Markup built by the code itself (JSON-LD); never pass admin text here unescaped.
const raw = value => new Markup(String(value));

// Like lines(), and *words in asterisks* become the accented part of a heading.
const accent = (text, className) =>
  new Markup(lines(text).value.replace(/\*([^*\n]+)\*/g, `<em class="${className}">$1</em>`));

// Paragraphs are separated by an empty line.
const paragraphs = (text, className) =>
  text
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => html`<p class="${className}">${lines(part)}</p>`);

module.exports = { html, raw, escape, lines, accent, paragraphs };
