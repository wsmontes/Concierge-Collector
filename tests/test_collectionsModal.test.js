import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadModal() {
  const source = readFileSync(path.resolve(__dirname, '..', 'scripts/ui/collectionsModal.js'), 'utf8');
  new Function('window', `${source}\n;`)(window); // eslint-disable-line no-new-func
  return window.CollectionsModal;
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.CollectionsModal;
  delete window.CollectionsService;
  delete window.ModalManager;
  vi.restoreAllMocks();
});

describe('CollectionsModal', () => {
  test('renders published memberships and admin draft choices without using local state', async () => {
    const opened = [];
    window.ModalManager = { open: vi.fn((options) => { opened.push(options); return 'modal-1'; }) };
    window.CollectionsService = {
      getPublishedAssociations: vi.fn().mockResolvedValue({ items: [{ title: 'São Paulo', slug: 'sao-paulo', current_published_version: 3 }] }),
      getDraftOptions: vi.fn().mockResolvedValue({ items: [{ collectionId: 'c1', title: 'Brazil', slug: 'brazil', draftRevision: 4, draftState: 'dirty', desiredState: 'add', locked: false }] })
    };

    const modal = loadModal();
    expect(modal.open({ curation_id: 'curation-1', restaurant_name: 'Bistro' })).toBe('modal-1');
    await new Promise(resolve => setTimeout(resolve, 0));

    const content = opened[0].content;
    expect(content.textContent).toContain('São Paulo');
    expect(content.textContent).toContain('Published v3');
    expect(content.querySelector('.collections-modal__action')?.textContent).toBe('Add to draft');
    expect(window.CollectionsService.getPublishedAssociations).toHaveBeenCalledWith('curation-1');
    expect(window.CollectionsService.getDraftOptions).toHaveBeenCalledWith('curation-1');
  });

  test('keeps published data visible when draft access is denied', async () => {
    const opened = [];
    window.ModalManager = { open: vi.fn((options) => { opened.push(options); return 'modal-1'; }) };
    window.CollectionsService = {
      getPublishedAssociations: vi.fn().mockResolvedValue({ items: [{ title: 'São Paulo', slug: 'sao-paulo', current_published_version: 3 }] }),
      getDraftOptions: vi.fn().mockRejectedValue({ status: 403 })
    };

    loadModal().open({ curation_id: 'curation-1' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(opened[0].content.textContent).toContain('São Paulo');
    expect(opened[0].content.textContent).toContain('requires an administrator role');
  });
});
