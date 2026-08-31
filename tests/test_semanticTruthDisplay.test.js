import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadCardFactory() {
  const src = readFileSync(path.resolve(__dirname, '../scripts/ui/cardFactory.js'), 'utf8');
  delete globalThis.CardFactory;
  // eslint-disable-next-line no-new-func
  return new Function('window', `${src}\nreturn window.CardFactory;`)(window);
}

function loadSourceUtils() {
  const src = readFileSync(path.resolve(__dirname, '../scripts/utils/sourceUtils.js'), 'utf8');
  delete window.SourceUtils;
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', `${src}\nreturn window.SourceUtils;`)(window, document);
}

afterEach(() => {
  document.body.innerHTML = '';
  delete globalThis.CardFactory;
  delete window.SourceUtils;
});

describe('semantic truth — card display', () => {
  test('recognizes data.place_id as Google Places provenance when no explicit entity source exists', () => {
    const factory = loadCardFactory();
    const SourceUtils = loadSourceUtils();
    SourceUtils.installSemanticTruthGuards();

    const card = factory.createEntityCard({
      entity_id: 'ent-google',
      name: 'Google Place',
      type: 'restaurant',
      status: 'active',
      data: { place_id: 'ChIJ123' }
    });
    document.body.appendChild(card);

    expect(SourceUtils.getEntitySource({ data: { place_id: 'ChIJ123' } })).toBe('google_places');
    expect(card.querySelector('.collection-source-badge__label').textContent.toLowerCase()).toContain('google places');
  });

  test('uses automation identity for synthetic curator cards', () => {
    const factory = loadCardFactory();
    const SourceUtils = loadSourceUtils();
    SourceUtils.installSemanticTruthGuards();

    window.SourceUtils = SourceUtils;
    const card = factory.createCurationCard(
      { entity_id: 'ent-1', name: 'Place', type: 'restaurant', status: 'active', data: {} },
      {
        curation_id: 'cur-ai',
        entity_id: 'ent-1',
        status: 'draft',
        curator_type: 'synthetic',
        curator: { name: 'AI Web Research' },
        sources: { web_research: ['https://example.com'] }
      }
    );
    document.body.appendChild(card);

    expect(SourceUtils.getCuratorType({ curator_type: 'synthetic' })).toBe('synthetic');
    expect(card.querySelector('.collection-card__subtitle .material-icons').textContent).toBe('smart_toy');
  });

  test('keeps a human curator represented as a person', () => {
    const factory = loadCardFactory();
    const SourceUtils = loadSourceUtils();
    SourceUtils.installSemanticTruthGuards();
    window.SourceUtils = SourceUtils;

    const card = factory.createCurationCard(
      { entity_id: 'ent-1', name: 'Place', type: 'restaurant', status: 'active', data: {} },
      {
        curation_id: 'cur-human',
        entity_id: 'ent-1',
        status: 'draft',
        curator_type: 'human',
        curator: { name: 'Human Curator' },
        sources: { manual: [{}] }
      }
    );
    document.body.appendChild(card);

    expect(card.querySelector('.collection-card__subtitle .material-icons').textContent).toBe('person');
  });
});
