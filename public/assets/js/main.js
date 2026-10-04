'use strict';

// The cards work with a mouse, touch, Enter and Space; touch scrolling stays native.
const board = document.querySelector('.goals-board');
const cards = [...board.querySelectorAll('[data-i]')];
let layer = 4;

function flip(card, active = !card.classList.contains('is-flipped')) {
  card.classList.toggle('is-flipped', active);
  card.setAttribute('aria-pressed', String(active));
  const faces = card.firstElementChild.children;
  faces[0].setAttribute('aria-hidden', String(active));
  faces[1].setAttribute('aria-hidden', String(!active));
}

cards.forEach(card => {
  let drag = null;
  let suppressClick = false;
  flip(card, false);
  card.addEventListener('click', () => {
    if (!suppressClick) flip(card);
    suppressClick = false;
  });
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      flip(card);
    }
  });
  card.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (event.button !== 0 || event.pointerType !== 'mouse' || window.matchMedia('(max-width: 819px)').matches) return;
    const rect = card.getBoundingClientRect();
    const bounds = board.getBoundingClientRect();
    const x = parseFloat(card.style.getPropertyValue('--x')) || 0;
    const y = parseFloat(card.style.getPropertyValue('--y')) || 0;
    drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, x, y,
      minX: x + bounds.left - rect.left, maxX: x + bounds.right - rect.right,
      minY: y + bounds.top - rect.top - 20, maxY: y + bounds.bottom - rect.bottom + 20 };
    card.setPointerCapture(event.pointerId);
    card.style.setProperty('--layer', String(++layer));
  });
  card.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.sx, dy = event.clientY - drag.sy;
    if (Math.hypot(dx, dy) < 6 && !suppressClick) return;
    suppressClick = true;
    card.classList.add('is-dragging');
    card.style.setProperty('--x', `${Math.max(drag.minX, Math.min(drag.maxX, drag.x + dx))}px`);
    card.style.setProperty('--y', `${Math.max(drag.minY, Math.min(drag.maxY, drag.y + dy))}px`);
  });
  const finish = () => { drag = null; card.classList.remove('is-dragging'); };
  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', () => { suppressClick = true; finish(); });
  card.addEventListener('lostpointercapture', finish);
});

function resetPositions() {
  cards.forEach(card => {
    card.style.removeProperty('--x');
    card.style.removeProperty('--y');
    card.style.removeProperty('--layer');
  });
}
document.querySelector('#reset-goals').addEventListener('click', () => {
  resetPositions();
  cards.forEach(card => flip(card, false));
});
window.addEventListener('resize', resetPositions);

const mobileMenu = document.querySelector('.mobile-menu');
const menuSummary = mobileMenu.querySelector('summary');
const menuNav = mobileMenu.querySelector('nav');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mobileViewport = window.matchMedia('(max-width: 819px)');
let menuAnimation = null;
let itemAnimations = [];
let menuExpanded = mobileMenu.open;

function setMenuExpanded(expanded, animate = true) {
  const startHeight = mobileMenu.getBoundingClientRect().height;
  if (menuAnimation) menuAnimation.cancel();
  itemAnimations.forEach(animation => animation.cancel());
  itemAnimations = [];
  menuExpanded = expanded;
  mobileMenu.classList.toggle('is-expanded', expanded);
  menuSummary.setAttribute('aria-expanded', String(expanded));
  menuNav.inert = !expanded;
  const finish = () => {
    mobileMenu.open = expanded;
    mobileMenu.style.removeProperty('overflow');
    menuAnimation = null;
  };
  if (!animate || reducedMotion.matches || !mobileViewport.matches) {
    finish();
    return;
  }
  // Keep details open during collapse; remove its native open state on completion.
  mobileMenu.open = true;
  const border = parseFloat(getComputedStyle(mobileMenu).borderTopWidth) || 0;
  const endHeight = expanded
    ? mobileMenu.getBoundingClientRect().height
    : menuSummary.getBoundingClientRect().height + border;
  mobileMenu.style.overflow = 'hidden';
  menuAnimation = mobileMenu.animate(
    [{ height: `${startHeight}px` }, { height: `${endHeight}px` }],
    { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)' }
  );
  menuAnimation.onfinish = finish;
  if (expanded) {
    itemAnimations = [...menuNav.querySelectorAll('a')].map((link, index) =>
      link.animate(
        [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 200, delay: index * 25, fill: 'backwards', easing: 'ease-out' }
      )
    );
  }
}

menuSummary.addEventListener('click', event => {
  event.preventDefault();
  setMenuExpanded(!menuExpanded);
});
mobileMenu.addEventListener('click', event => {
  if (event.target.closest('a')) {
    menuSummary.focus({ preventScroll: true });
    setMenuExpanded(false);
  }
});
mobileMenu.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    menuSummary.focus({ preventScroll: true });
    setMenuExpanded(false);
  }
});
mobileViewport.addEventListener('change', () => setMenuExpanded(false, false));
reducedMotion.addEventListener('change', () => setMenuExpanded(menuExpanded, false));
setMenuExpanded(menuExpanded, false);

// FAQ answers slide open and closed like the menu above; with reduced motion
// <details> just toggles natively.
document.querySelectorAll('.faq-item').forEach(item => {
  const summary = item.querySelector('summary');
  const answer = item.querySelector('.faq-answer');
  let animation = null;
  summary.addEventListener('click', event => {
    if (reducedMotion.matches) return;
    event.preventDefault();
    const opening = !item.open || item.classList.contains('is-closing');
    const startHeight = item.getBoundingClientRect().height;
    if (animation) animation.cancel();
    item.classList.toggle('is-closing', !opening);
    item.open = true;
    const endHeight = opening ? item.getBoundingClientRect().height : summary.getBoundingClientRect().height;
    item.style.overflow = 'hidden';
    animation = item.animate(
      [{ height: `${startHeight}px` }, { height: `${endHeight}px` }],
      { duration: opening ? 340 : 260, easing: 'cubic-bezier(.22, 1, .36, 1)' }
    );
    if (opening) {
      answer.animate(
        [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 320, delay: 80, fill: 'backwards', easing: 'ease-out' }
      );
    }
    animation.onfinish = () => {
      animation = null;
      item.style.removeProperty('overflow');
      if (opening) return;
      item.open = false;
      item.classList.remove('is-closing');
    };
  });
});

// Blocks below the first screen float in as they scroll into view. Whatever is already on
// screen when the page opens is left alone, so nothing blinks. Admin previews (.still) and
// reduced motion skip this and the card hint below.
const still = document.documentElement.classList.contains('still');
const lively = !still && !reducedMotion.matches && 'IntersectionObserver' in window;
const REVEALS = [
  { selector: '.goals-2, .about-10, .steps-2, .reviews-3, .faq-head', lift: 22, underline: true },
  { selector: '.goals-board > [data-i], .steps-3 > div, .prices-grid > .price-card', lift: 36, tilt: -4, stagger: 110 },
  { selector: '.about-2', lift: 30, tilt: 3 },
  { selector: '.reviews-8 > div', lift: 10, side: 28, stagger: 160 },
  { selector: '.faq-item', lift: 14, stagger: 70 },
  { selector: '.prices-note, .signup-2', lift: 24 },
];

function reveal(node, group, delay) {
  // Chat bubbles arrive from their own side; paper cards drop in and straighten up.
  const side = group.side ? (node.classList.contains('reviews-15') ? group.side : -group.side) : 0;
  node.classList.remove('reveal-pending');
  node.animate(
    { opacity: [0, 1], translate: [`${side}px ${group.lift}px`, '0 0'], rotate: [`${group.tilt || 0}deg`, '0deg'] },
    { duration: 700, delay, fill: 'backwards', easing: 'cubic-bezier(.2, .8, .2, 1)' }
  );
  if (!group.underline) return;
  node.querySelectorAll('.goals-5, .reviews-4').forEach(line =>
    line.animate(
      { clipPath: ['inset(0 100% 0 0)', 'inset(0 0 0 0)'] },
      { duration: 800, delay: delay + 250, fill: 'backwards', easing: 'cubic-bezier(.6, 0, .3, 1)' }
    )
  );
}

if (lively) {
  const pending = new Map();
  REVEALS.forEach(group =>
    document.querySelectorAll(group.selector).forEach(node => {
      if (node.getBoundingClientRect().top < window.innerHeight * 0.92) return;
      node.classList.add('reveal-pending');
      pending.set(node, group);
    })
  );
  const observer = new IntersectionObserver(entries => {
    // Items that come into view together appear one after another.
    const counts = new Map();
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const group = pending.get(entry.target);
      const index = counts.get(group) || 0;
      counts.set(group, index + 1);
      observer.unobserve(entry.target);
      reveal(entry.target, group, index * (group.stagger || 0));
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  pending.forEach((group, node) => observer.observe(node));
}

// The first goal card turns a little once, so it is clear that the cards flip.
if (lively && cards.length) {
  const firstCard = cards[0];
  const hint = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    hint.disconnect();
    if (firstCard.classList.contains('is-flipped')) return;
    firstCard.firstElementChild.animate(
      [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(28deg)', offset: 0.45 }, { transform: 'rotateY(0deg)' }],
      { duration: 1100, delay: 900, easing: 'ease-in-out' }
    );
  }, { threshold: 0.6 });
  hint.observe(firstCard);
}
