/**
 * Testes de segurança do CardFactory: strings vindas do servidor/import/IA
 * (nome, endereço, telefone, cuisine, curation) NUNCA podem ser interpoladas
 * cruas no innerHTML dos cards — payload XSS no origin do collector teria
 * acesso ao oauth_access_token (regressão: interpolavam sem escape).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/ui/cardFactory.js'),
  'utf8'
);

function loadCardFactory() {
  // O tail do src faz `window.CardFactory = new CardFactory()` e window ===
  // global aqui — sem o delete, o próximo load receberia a INSTÂNCIA de volta
  // do defineClass e `new CardFactory()` quebraria ("not a constructor").
  delete globalThis.CardFactory;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.CardFactory;`);
  return fn(window);
}

const PAYLOAD = '<img src=x onerror="window.__pwned=1">';

afterEach(() => {
  document.body.innerHTML = '';
  window.__pwned = undefined;
  window.SourceUtils = undefined;
});

describe('CardFactory — XSS via dados de entity/curation', () => {
  test('escapa nome, cidade, telefone e cuisine no card de entity', () => {
    const factory = loadCardFactory();

    const entity = {
      entity_id: 'ent_xss',
      name: PAYLOAD,
      type: 'restaurant',
      status: 'active',
      data: {
        contact: { phone: PAYLOAD, website: 'example.com' },
        address: { city: PAYLOAD },
        attributes: { cuisine: [PAYLOAD], rating: 4.5, price_level: 2 }
      }
    };

    const card = factory.createEntityCard(entity, { showEntityActions: false });
    document.body.appendChild(card);

    // O que importa é a SEMÂNTICA do DOM: o payload vira texto inerte, nunca
    // elemento real. (Serializar atributos deixa `<` cru no innerHTML por
    // spec — checar innerHTML cru daria falso positivo.)
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.entity-card-name').textContent).toContain(PAYLOAD);
    expect(card.querySelector('.entity-card-name').innerHTML).toContain('&lt;img');
    // atributo title preserva o valor intacto, sem quebrar o atributo
    const contactTitle = card.querySelector('.entity-card-contact [title]');
    expect(contactTitle?.getAttribute('title')).toBe(PAYLOAD);
    expect(window.__pwned).toBeUndefined();
  });

  test('escapa status/label e não interpola curation_id em onclick no card de curation', () => {
    const factory = loadCardFactory();
    window.SourceUtils = {
      detectSource: () => ({ className: 'chip', icon: 'public', label: PAYLOAD })
    };

    const entity = {
      entity_id: 'ent_xss',
      name: 'Ok Name',
      type: 'restaurant',
      status: 'active',
      data: {}
    };
    const curation = {
      curation_id: `c_'"><img src=x onerror="window.__pwned=1">`,
      entity_id: 'ent_xss',
      status: 'draft',
      sync: { status: 'conflict' }
    };

    const card = factory.createCurationCard(entity, curation);
    document.body.appendChild(card);

    expect(card.querySelector('img')).toBeNull();
    expect(card.innerHTML).not.toContain('onclick="');
    // chip de conflito continua presente, agora com listener real
    expect(card.querySelector('.sync-conflict-chip')).toBeTruthy();
    expect(window.__pwned).toBeUndefined();
  });

  test('escapa título/mensagem/action do empty state', () => {
    const factory = loadCardFactory();

    const el = factory.createEmptyState({
      title: PAYLOAD,
      message: PAYLOAD,
      action: { label: PAYLOAD }
    });
    document.body.appendChild(el);

    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('p').textContent).toContain(PAYLOAD);
  });
});
