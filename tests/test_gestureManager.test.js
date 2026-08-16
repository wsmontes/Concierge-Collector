/**
 * Testes do GestureManager — scroll nativo vs preventDefault (2026-08-15).
 *
 * Bug reportado em mobile: o scroll TRAVA quando o toque começa sobre um
 * card de curadoria. Causa: o default de onSwipe era preventDefault:true
 * (opt-out) — o touchmove cancelava o pan vertical nativo do browser em
 * qualquer movimento >10px, em conflito com o design dos swipe actions
 * (touch-action:pan-y — o vertical rola nativo, o horizontal é do app).
 *
 * Contrato testado (código real, jsdom):
 * - onSwipe SEM preventDefault → touchmove NÃO cancela o scroll nativo;
 * - o swipe horizontal continua disparando onSwipeLeft/Right;
 * - preventDefault:true explícito (makeSwipeable) continua suprimindo.
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/ui-core/gestureManager.js'),
  'utf8'
);

function loadGestureManager() {
  delete globalThis.gestureManager;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.gestureManager;`);
  return fn(window);
}

function touchEvent(type, x, y) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: [{ clientX: x, clientY: y }] });
  return ev;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GestureManager — scroll nativo preservado', () => {
  test('onSwipe sem preventDefault não cancela o scroll vertical (touchmove >10px)', () => {
    const gm = loadGestureManager();
    const card = document.createElement('div');

    gm.onSwipe(card, {
      threshold: 60,
      onSwipeLeft: vi.fn(),
      onSwipeRight: vi.fn()
    });

    const pd = vi.spyOn(Event.prototype, 'preventDefault');
    card.dispatchEvent(touchEvent('touchstart', 100, 100));
    card.dispatchEvent(touchEvent('touchmove', 100, 140)); // deltaY 40 > 10
    card.dispatchEvent(touchEvent('touchend', 100, 140));

    expect(pd).not.toHaveBeenCalled();
  });

  test('swipe horizontal continua disparando onSwipeRight/Left (listener passivo)', () => {
    const gm = loadGestureManager();
    const card = document.createElement('div');
    const onLeft = vi.fn();
    const onRight = vi.fn();

    gm.onSwipe(card, { threshold: 60, onSwipeLeft: onLeft, onSwipeRight: onRight });

    card.dispatchEvent(touchEvent('touchstart', 100, 100));
    card.dispatchEvent(touchEvent('touchmove', 150, 100));
    card.dispatchEvent(touchEvent('touchmove', 210, 100));
    card.dispatchEvent(touchEvent('touchend', 210, 100));

    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).not.toHaveBeenCalled();

    card.dispatchEvent(touchEvent('touchstart', 210, 100));
    card.dispatchEvent(touchEvent('touchmove', 150, 100));
    card.dispatchEvent(touchEvent('touchmove', 90, 100));
    card.dispatchEvent(touchEvent('touchend', 90, 100));

    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  test('touchcancel (browser assumiu o scroll) remove a classe .swiping', () => {
    const gm = loadGestureManager();
    const card = document.createElement('div');

    gm.onSwipe(card, { threshold: 60, onSwipeLeft: vi.fn() });

    card.dispatchEvent(touchEvent('touchstart', 100, 100));
    expect(card.classList.contains('swiping')).toBe(true);

    // scroll nativo assumiu o gesto: browser envia touchcancel, não touchend
    card.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    expect(card.classList.contains('swiping')).toBe(false);
  });

  test('preventDefault:true explícito continua suprimindo o scroll (makeSwipeable)', () => {
    const gm = loadGestureManager();
    const card = document.createElement('div');

    gm.onSwipe(card, {
      threshold: 60,
      preventDefault: true,
      onSwipeLeft: vi.fn()
    });

    const pd = vi.spyOn(Event.prototype, 'preventDefault');
    card.dispatchEvent(touchEvent('touchstart', 100, 100));
    card.dispatchEvent(touchEvent('touchmove', 100, 140));

    expect(pd).toHaveBeenCalled();
  });
});
