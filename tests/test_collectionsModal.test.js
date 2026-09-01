import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The modal reads the role from AuthService on every open. */
function authAs(role) {
  window.AuthService = { getCurrentUser: () => ({ role, authorized: true }) };
}

function loadModal() {
  const source = readFileSync(path.resolve(__dirname, '..', 'scripts/ui/collectionsModal.js'), 'utf8');
  new Function('window', `${source}\n;`)(window); // eslint-disable-line no-new-func
  return window.CollectionsModal;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  delete window.CollectionsModal;
  delete window.CollectionsService;
  delete window.ModalManager;
  delete window.AuthService;
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

    authAs('admin');
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

    authAs('admin');
    loadModal().open({ curation_id: 'curation-1' });
    await new Promise(resolve => setTimeout(resolve, 0));

    // The server is the authority: the request was made and its 403 is what
    // removed the controls, not the client-side hint.
    expect(window.CollectionsService.getDraftOptions).toHaveBeenCalledWith('curation-1');
    expect(opened[0].content.textContent).toContain('São Paulo');
    expect(opened[0].content.textContent).toContain('requires an administrator role');
    expect(opened[0].content.querySelector('[data-collection-id]')).toBeNull();
  });

  test.each([['viewer'], ['curator']])('%s vê publicado e nunca pede opções de draft', async (role) => {
    const opened = [];
    window.ModalManager = { open: vi.fn((options) => { opened.push(options); return 'modal-1'; }) };
    window.CollectionsService = {
      getPublishedAssociations: vi.fn().mockResolvedValue({ items: [{ title: 'São Paulo', slug: 'sao-paulo', current_published_version: 3 }] }),
      getDraftOptions: vi.fn()
    };

    authAs(role);
    loadModal().open({ curation_id: 'curation-1' });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(opened[0].content.textContent).toContain('São Paulo');
    // No guaranteed 403 round-trip for a non-admin.
    expect(window.CollectionsService.getDraftOptions).not.toHaveBeenCalled();
    expect(opened[0].content.querySelector('.collections-modal__action')).toBeNull();
  });

  test('completed_with_skips reloads authoritative draft but never reports unconditional success', async () => {
    vi.useFakeTimers();
    const opened = [];
    window.ModalManager = { open: vi.fn((options) => { opened.push(options); return 'modal-1'; }) };
    window.CollectionsService = {
      getPublishedAssociations: vi.fn().mockResolvedValue({ items: [] }),
      getDraftOptions: vi.fn().mockResolvedValue({
        items: [{ collectionId: 'c1', title: 'Brazil', slug: 'brazil', draftRevision: 4, draftState: 'dirty', desiredState: 'add', locked: false }]
      }),
      createSingleCurationOperation: vi.fn().mockResolvedValue({ id: 'op-1' }),
      getOperation: vi.fn().mockResolvedValue({
        id: 'op-1',
        status: 'completed_with_skips',
        reasonCode: 'curation_already_present'
      })
    };

    authAs('admin');
    loadModal().open({ curation_id: 'curation-1' });
    await vi.advanceTimersByTimeAsync(0);
    const content = opened[0].content;
    content.querySelector('.collections-modal__action').click();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(content.querySelector('.collections-modal__status').textContent).toContain('completed with skips');
    expect(content.querySelector('.collections-modal__status').textContent).not.toBe('Draft updated.');
    expect(window.CollectionsService.getDraftOptions.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});