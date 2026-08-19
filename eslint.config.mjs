/**
 * ESLint flat config — frontend vanilla (ModuleWrapper, sem build).
 *
 * Adicionado na auditoria ago/2026. Política pragmática: `no-undef` e
 * `no-unused-vars` como WARN — a base tem ~50 arquivos legados com
 * globais do pattern ModuleWrapper; o lint roda como baseline
 * (`npm run lint`) e os warns viram dívida monitorável, não bloqueio.
 *
 * capture/ é ignorado: usa ES modules próprios (estrutura dos testes
 * vitest) e tem convenções separadas.
 */
export default [
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'capture/**',
      'scripts/python-tools/**',
      'archive/**'
    ]
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module', // vitest roda ESM
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        process: 'readonly',
        global: 'readonly'
      }
    },
    rules: {
      'no-undef': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': 'error'
    }
  },
  {
    files: ['scripts/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        // runtime
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        indexedDB: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        Audio: 'readonly',
        MediaRecorder: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        // globais do app (ModuleWrapper pattern)
        ModuleWrapper: 'readonly',
        Logger: 'readonly',
        AppConfig: 'readonly',
        Dexie: 'readonly',
        JSZip: 'readonly',
        lamejs: 'readonly',
        Toastify: 'readonly',
        CardFactory: 'readonly',
        DataStore: 'readonly',
        ApiService: 'readonly',
        CollectionsService: 'readonly',
        CollectionsServiceClass: 'readonly',
        CollectionsError: 'readonly',
        AuthService: 'readonly',
        CuratorProfile: 'readonly',
        SyncManager: 'readonly',
        SyncManagerV3: 'readonly',
        CurationBrowser: 'readonly',
        EntityBrowser: 'readonly',
        PendingAudioManager: 'readonly',
        PendingAudioModal: 'readonly',
        DraftRestaurantManager: 'readonly',
        DatabaseManager: 'readonly',
        SourceUtils: 'readonly',
        SafetyUtils: 'readonly',
        uiManager: 'readonly',
        uiUtils: 'readonly',
        entityModule: 'readonly',
        findEntityModal: 'readonly',
        AudioUtils: 'readonly',
        // testes (vitest)
        describe: 'readonly',
        test: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly'
      }
    },
    rules: {
      'no-undef': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': 'warn',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': 'error'
    }
  }
];
