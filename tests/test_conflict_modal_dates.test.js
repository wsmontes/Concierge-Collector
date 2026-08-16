/**
 * Testes de data relativa do modal de conflito (padrão feedmine:
 * RelativeDateTimeFormatter cacheado — "2 hours ago" em vez de
 * timestamp absoluto; absoluto no title, relativo visível).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadModal() {
  delete globalThis.ConflictResolutionModal;
  // Ordem espelhando o index.html: uiUtils.js define o formatter
  // canônico (formatRelativeDate) antes do modal delegar para ele
  const uiUtilsSrc = readFileSync(path.resolve(__dirname, '../scripts/ui-core/uiUtils.js'), 'utf8');
  new Function('window', `${uiUtilsSrc}\n;`)(window); // eslint-disable-line no-new-func
  const src = readFileSync(path.resolve(__dirname, '../scripts/ui/conflictResolutionModal.js'), 'utf8');
  new Function('window', `${src}\n;`)(window); // eslint-disable-line no-new-func
  // o tail do arquivo já expõe a INSTÂNCIA singleton
  return window.ConflictResolutionModal;
}

afterEach(() => {
  delete globalThis.ConflictResolutionModal;
  document.body.innerHTML = '';
});

describe('ConflictResolutionModal — datas relativas (feedmine)', () => {
  const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
  const isoAhead = (ms) => new Date(Date.now() + ms).toISOString();

  test('minutos atrás → relativa em minutos', () => {
    const modal = loadModal();
    const out = modal.formatRelativeDate(isoAgo(90 * 1000));
    expect(out.toLowerCase()).toContain('minute');
  });

  test('horas atrás → relativa em horas', () => {
    const modal = loadModal();
    const out = modal.formatRelativeDate(isoAgo(2 * 3600 * 1000));
    expect(out.toLowerCase()).toContain('hour');
  });

  test('futuro próximo → relativa no futuro', () => {
    const modal = loadModal();
    const out = modal.formatRelativeDate(isoAhead(86400 * 1000));
    // numeric:'auto' do Intl renderiza "tomorrow" para +1 dia
    expect(['tomorrow', 'in 1 day'].includes(out)).toBe(true);
  });

  test('além de ~30 dias cai no formato absoluto', () => {
    const modal = loadModal();
    const out = modal.formatRelativeDate(isoAgo(90 * 86400 * 1000));
    expect(out).toBeTruthy();
    expect(out.toLowerCase()).not.toContain('day');
  });

  test('entrada vazia/inválida não quebra', () => {
    const modal = loadModal();
    expect(modal.formatRelativeDate(null)).toBe('Unknown');
    expect(modal.formatRelativeDate('não sou data')).toBe('não sou data');
  });
});
