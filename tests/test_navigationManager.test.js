/**
 * Testes do NavigationManager — regressão ago/2026: handleRoute usava
 * this.navigateCallbacks (propriedade de instância que NUNCA existiu —
 * a lista é variável de closure), lançando "Cannot read properties of
 * undefined (reading 'forEach')" em TODA navegação. Consequências:
 * breadcrumbs nunca populavam, back/título mobile nunca atualizavam e
 * cada goTo() vazava uma exceção não tratada.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadNavigationManager() {
    delete window.NavigationManager;
    delete window.navigationManager;
    // stateStore é tocado por handleRoute (set) — stub mínimo
    window.stateStore = { set: vi.fn(), get: vi.fn() };
    const src = readFileSync(
        path.resolve(__dirname, '../scripts/ui-core/navigationManager.js'),
        'utf8'
    );
    // eslint-disable-next-line no-new-func
    new Function('window', `${src}\n;`)(window);
    return window.NavigationManager;
}

describe('NavigationManager — callbacks de navegação (regressão forEach)', () => {
    let nm;

    beforeEach(() => {
        nm = loadNavigationManager();
        window.history.replaceState(null, '', '#/');
    });

    test('goTo executa o handler, notifica callbacks e NÃO lança', async () => {
        const handler = vi.fn();
        const callback = vi.fn();
        nm.register('/data', { breadcrumb: 'Data Management', handler });
        nm.addNavigateCallback(callback);

        await expect(nm.goTo('/data')).resolves.toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith('/data', {});
    });

    test('unsubscribe do addNavigateCallback remove o callback', async () => {
        const callback = vi.fn();
        nm.register('/data', { breadcrumb: 'Data Management', handler: () => {} });
        const off = nm.addNavigateCallback(callback);
        off();

        await nm.goTo('/data');
        expect(callback).not.toHaveBeenCalled();
    });

    test('callback que lança não derruba os demais nem a navegação', async () => {
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();
        nm.register('/data', { breadcrumb: 'Data Management', handler: () => {} });
        nm.addNavigateCallback(bad);
        nm.addNavigateCallback(good);

        await expect(nm.goTo('/data')).resolves.toBe(true);
        expect(good).toHaveBeenCalledWith('/data', {});
    });

    test('navegação bloqueada por guard não notifica callbacks', async () => {
        const callback = vi.fn();
        nm.register('/data', { breadcrumb: 'Data Management', handler: () => {} });
        nm.addGuard(() => false);
        nm.addNavigateCallback(callback);

        await expect(nm.goTo('/data')).resolves.toBe(false);
        expect(callback).not.toHaveBeenCalled();
    });
});
