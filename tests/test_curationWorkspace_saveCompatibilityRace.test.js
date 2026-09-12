/**
 * O boundary de durabilidade do autoramento depende de UMA corrida que hoje é
 * sempre perdida.
 *
 * Cadeia (verificada no boot de produção de 2026-09-12, que emite os 5 avisos):
 *
 *   window.uiManager é atribuído no PARSE do script (uiManager.js:3680)
 *   → CurationWorkspaceModule.bootstrap() (DOMContentLoaded) vê o uiManager e
 *     chama install() → installSaveCompatibility()
 *   → mas uiManager.init() só roda DEPOIS do await de autenticação, e é o
 *     init() que cria `uiManager.conceptModule`
 *   → installSaveCompatibility() não acha `conceptModule.saveRestaurant` e
 *     RETORNA SEM RE-TENTAR
 *   → `__curationWorkspaceSaveCompatibilityInstalled` nunca é setado
 *   → OfflineDurabilityModule espera esse flag (`workspaceReady`) e desiste após
 *     30s ("durability wrappers not installed")
 *   → os outros 4 módulos esperam `__offlineDurabilityEditRestoreInstalled`, que
 *     nunca chega → Ownership, AuthoringController, SourceIdentityBridge e
 *     SaveCoordinator também desistem.
 *
 * Ou seja: os wrappers de autosave durável, restore de draft, guarda de
 * ownership, ponte de identidade de fonte e coordenador de save NUNCA foram
 * instalados. É a superfície de "não perder informação" do autoramento.
 *
 * Este teste reproduz a corrida de forma determinística (sem rede, sem login).
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/modules/curationWorkspaceModule.js'),
  'utf8'
);

function loadWorkspaceModule() {
  delete globalThis.CurationWorkspaceModule;
  delete globalThis.curationWorkspace;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', `${src}\nreturn window.CurationWorkspaceModule;`);
  return fn(window, document);
}

/** uiManager mínimo no estado em que o bootstrap o encontra no boot real. */
function makeUiManager({ withConceptModule = false } = {}) {
  const uiManager = {
    isEditingEntity: false,
    currentConcepts: [],
    __curationWorkspaceSaveCompatibilityInstalled: undefined
  };
  if (withConceptModule) {
    uiManager.conceptModule = { saveRestaurant: vi.fn(async () => ({ ok: true })) };
  }
  return uiManager;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="concepts-section"><div id="concepts-container"></div></div>
    <input id="restaurant-name" value="Teste" />
  `;
});

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.CurationWorkspaceModule;
  delete globalThis.curationWorkspace;
  window.__CURATION_WORKSPACE_AUTO_INIT__ = true;
});

describe('CurationWorkspaceModule — corrida do installSaveCompatibility', () => {
  test('instala a compatibilidade quando o conceptModule chega DEPOIS do install', async () => {
    // Reproduz o boot real: uiManager já existe (parse do script) sem
    // conceptModule; o init() só cria o conceptModule depois do await de auth.
    const uiManager = makeUiManager({ withConceptModule: false });
    const CurationWorkspaceModule = loadWorkspaceModule();

    const workspace = new CurationWorkspaceModule(uiManager);
    workspace.install();

    // Nada para instalar ainda — e o módulo precisa estar esperando, não desistido.
    expect(uiManager.conceptModule?.__curationWorkspaceSaveCompatibilityInstalled).toBeUndefined();

    // Agora o init() roda e cria o conceptModule.
    uiManager.conceptModule = { saveRestaurant: vi.fn(async () => ({ ok: true })) };
    await vi.advanceTimersByTimeAsync(1000);

    expect(
      uiManager.conceptModule.__curationWorkspaceSaveCompatibilityInstalled,
      'o wrapper de compatibilidade deveria ter sido instalado quando o conceptModule ficou pronto'
    ).toBe(true);
    // O save original precisa ter sido preservado (é ele que o wrapper chama)
    expect(uiManager.conceptModule.__curationWorkspaceOriginalSaveRestaurant).toBeTypeOf('function');
  });

  test('não reinstala nem re-embrulha quando o conceptModule já está pronto', async () => {
    const uiManager = makeUiManager({ withConceptModule: true });
    const originalSave = uiManager.conceptModule.saveRestaurant;
    const CurationWorkspaceModule = loadWorkspaceModule();

    const workspace = new CurationWorkspaceModule(uiManager);
    workspace.install();
    await vi.advanceTimersByTimeAsync(2000);

    // Contrato do wrapper: substitui o método e guarda uma referência ao
    // original (é ele que o wrapper chama no fim). O original é preservado
    // como função vinculada, então a identidade não é preservada.
    expect(uiManager.conceptModule.__curationWorkspaceSaveCompatibilityInstalled).toBe(true);
    expect(uiManager.conceptModule.saveRestaurant).not.toBe(originalSave);
    expect(uiManager.conceptModule.__curationWorkspaceOriginalSaveRestaurant).toBeTypeOf('function');

    // E não re-embrulha: o segundo install (via retry) tem de ser no-op.
    const afterFirstInstall = uiManager.conceptModule.saveRestaurant;
    workspace.installSaveCompatibility();
    await vi.advanceTimersByTimeAsync(1000);
    expect(uiManager.conceptModule.saveRestaurant).toBe(afterFirstInstall);
  });

  test('desiste com aviso se o conceptModule nunca aparecer (sem loop infinito)', async () => {
    const warn = vi.fn();
    globalThis.Logger = { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn(), module: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) };
    const uiManager = makeUiManager({ withConceptModule: false });
    const CurationWorkspaceModule = loadWorkspaceModule();

    const workspace = new CurationWorkspaceModule(uiManager);
    workspace.install();
    await vi.advanceTimersByTimeAsync(120000);   // muito além de qualquer janela

    expect(uiManager.conceptModule?.__curationWorkspaceSaveCompatibilityInstalled).toBeUndefined();
    delete globalThis.Logger;
  });
});
