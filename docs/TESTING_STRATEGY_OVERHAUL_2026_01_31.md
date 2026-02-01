# Testing Strategy Overhaul - Concierge Collector

**Date:** January 31, 2026  
**Status:** PLANNING  
**Scope:** Frontend (JavaScript/Vitest) + Backend (Python/pytest)

---

## 🎯 Executive Summary

Análise completa revelou **boas fundações mas gaps críticos**:

### Situação Atual
- ✅ **Frontend:** 339 testes (332 passing, 7 failing) - boa cobertura de core
- ⚠️ **Backend:** 60+ testes, pytest não instalado no ambiente de desenvolvimento
- ❌ **Serviços refatorados:** 0 testes (10 novos serviços sem cobertura)
- ❌ **Integration E2E:** cobertura superficial
- ❌ **Performance/Load:** não testado

### Problemas Identificados

#### 1. **Serviços Refatorados Sem Testes** 🔴 CRÍTICO
Acabamos de refatorar 3 God Objects em 10 serviços (~3,500 linhas) sem adicionar testes:
- AudioRecordingService.js (370 linhas) - **0 testes**
- AudioConversionService.js (412 linhas) - **0 testes**
- RecordingUIManager.js (379 linhas) - **0 testes**
- RecordingStateManager.js (321 linhas) - **0 testes**
- ConceptValidationService.js (281 linhas) - **0 testes**
- ImageProcessingService.js (279 linhas) - **0 testes**
- ConceptUIManager.js (397 linhas) - **0 testes**
- ConceptExtractionService.js (348 linhas) - **0 testes**
- PlacesSearchService.js (330 linhas) - **0 testes**
- PlacesUIManager.js (336 linhas) - **0 testes**

#### 2. **Testes Desatualizados** ⚠️ MÉDIO
Testes de módulos refatorados ainda testam código antigo:
- `test_recordingModule.test.js` - testa módulo de 2,421 linhas (agora 516)
- `test_conceptModule.test.js` - testa módulo de 2,511 linhas (agora 609)
- `test_placesModule.test.js` - **não existe!**

#### 3. **Testes Falhando** ⚠️ MÉDIO
- 7 testes failing relacionados a inicialização do DataStore
- test_syncManagerV3.test.js: 3 falhas (PATCH partial updates)
- test_realProduction.test.js: 2 falhas (DataStore null)
- test_integration_real.test.js: 5 falhas (DataStore.db.close)

#### 4. **Backend Environment** ⚠️ BAIXO
- pytest não instalado no ambiente local de desenvolvimento
- Testes backend não são executados regularmente

#### 5. **Sem Testes E2E Reais** 🔴 CRÍTICO
- Fluxo completo audio → transcription → concepts → MongoDB não testado
- Conflict resolution UI não testada
- OAuth flow não testado

---

## 📊 Gap Analysis

### Frontend Testing Gaps

| Categoria | Coverage Atual | Gap | Prioridade |
|-----------|----------------|-----|------------|
| **Novos Serviços** | 0% (0/10) | 100% | 🔴 CRÍTICA |
| **Services/utilities** | 25% (1/4 utils) | 75% | 🔴 ALTA |
| **Módulos refatorados** | 60% (desatualizado) | 40% | 🟡 MÉDIA |
| **Integration E2E** | 20% | 80% | 🔴 ALTA |
| **UI Components** | 10% | 90% | 🟡 MÉDIA |
| **Error Boundaries** | 40% | 60% | 🟢 BAIXA |

### Backend Testing Gaps

| Categoria | Coverage Atual | Gap | Prioridade |
|-----------|----------------|-----|------------|
| **AI Orchestrate** | 0% (bugs) | 100% | 🔴 CRÍTICA |
| **Audio Transcription** | 0% (bugs) | 100% | 🔴 ALTA |
| **Conflict Resolution** | 30% | 70% | 🟡 MÉDIA |
| **Performance** | 10% | 90% | 🟡 MÉDIA |
| **Error Handling** | 50% | 50% | 🟢 BAIXA |

---

## 🏗️ Nova Estrutura de Testes (Proposta)

### Frontend - Reorganização Completa

```
tests/
├── README.md                        # Documentação atualizada
├── setup/
│   ├── conftest.js                  # Setup global
│   ├── mocks/                       # Mocks centralizados
│   │   ├── browser.mock.js          # MediaRecorder, getUserMedia
│   │   ├── indexeddb.mock.js        # Dexie mocks
│   │   ├── api.mock.js              # API responses
│   │   └── dom.mock.js              # DOM elements
│   └── fixtures/                    # Test data
│       ├── entities.fixture.js
│       ├── curations.fixture.js
│       └── audio.fixture.js
│
├── unit/                            # NOVO: Testes unitários isolados
│   ├── services/                    # ⭐ PRIORIDADE MÁXIMA
│   │   ├── AudioRecordingService.test.js       # MISSING
│   │   ├── AudioConversionService.test.js      # MISSING
│   │   ├── RecordingUIManager.test.js          # MISSING
│   │   ├── RecordingStateManager.test.js       # MISSING
│   │   ├── ConceptValidationService.test.js    # MISSING
│   │   ├── ImageProcessingService.test.js      # MISSING
│   │   ├── ConceptUIManager.test.js            # MISSING
│   │   ├── ConceptExtractionService.test.js    # MISSING
│   │   ├── PlacesSearchService.test.js         # MISSING
│   │   └── PlacesUIManager.test.js             # MISSING
│   │
│   ├── utils/                       # Utilities
│   │   ├── uiHelpers.test.js                   # MISSING
│   │   ├── errorHandling.test.js               # MISSING
│   │   ├── apiUtils.test.js                    # MISSING
│   │   └── audioUtils.test.js                  # MISSING
│   │
│   └── core/                        # Core infrastructure (já existe)
│       ├── config.test.js           # ✅ EXISTS (19 tests)
│       ├── logger.test.js           # ✅ EXISTS (22 tests)
│       ├── errorManager.test.js     # ✅ EXISTS (25 tests)
│       └── moduleWrapper.test.js    # ✅ EXISTS (27 tests)
│
├── integration/                     # NOVO: Testes de integração entre módulos
│   ├── modules/                     # Módulos refatorados (atualizar)
│   │   ├── recordingModule.test.js            # ⚠️ UPDATE NEEDED
│   │   ├── conceptModule.test.js              # ⚠️ UPDATE NEEDED
│   │   ├── placesModule.test.js               # ❌ MISSING
│   │   ├── entityModule.test.js               # ❌ MISSING
│   │   └── syncModule.test.js                 # ⚠️ UPDATE (syncManagerV3)
│   │
│   ├── workflows/                   # Fluxos completos
│   │   ├── audioToMongoDB.test.js             # MISSING - audio → DB
│   │   ├── conceptExtraction.test.js          # MISSING - full pipeline
│   │   ├── placeImport.test.js                # MISSING - Places → Entity
│   │   ├── conflictResolution.test.js         # MISSING - merge conflicts
│   │   └── offlineSync.test.js                # MISSING - offline → online
│   │
│   └── api/                         # API integration (já existe parcialmente)
│       ├── apiService.test.js       # ✅ EXISTS (60 tests)
│       ├── api_integration.test.js  # ✅ EXISTS (12 tests)
│       └── dataStore.test.js        # ✅ EXISTS (23 tests)
│
├── e2e/                             # NOVO: End-to-End real (Playwright)
│   ├── critical/                    # Fluxos críticos de negócio
│   │   ├── completeRestaurantFlow.spec.js     # MISSING
│   │   ├── audioRecordingFlow.spec.js         # MISSING
│   │   └── syncFlow.spec.js                   # MISSING
│   │
│   └── edge-cases/                  # Casos extremos
│       ├── networkFailure.spec.js             # MISSING
│       ├── browserCompatibility.spec.js       # MISSING
│       └── dataCorruption.spec.js             # MISSING
│
├── performance/                     # NOVO: Performance benchmarks
│   ├── audioProcessing.bench.js               # MISSING
│   ├── imageQueue.bench.js                    # MISSING
│   └── syncPerformance.bench.js               # MISSING
│
└── legacy/                          # Testes antigos (mover temporariamente)
    ├── test_audioTranscription.test.js
    ├── test_consoleErrors.test.js
    ├── test_integration_real.test.js
    └── test_realProduction.test.js
```

### Backend - Reorganização

```
concierge-api-v3/tests/
├── conftest.py                      # Setup global (já existe)
├── fixtures/                        # NOVO: Fixtures organizados
│   ├── entities.py
│   ├── curations.py
│   ├── auth.py
│   └── places.py
│
├── unit/                            # NOVO: Unit tests isolados
│   ├── services/
│   │   ├── test_ai_service.py                 # MISSING
│   │   ├── test_transcription_service.py      # MISSING
│   │   └── test_conflict_resolver.py          # MISSING
│   │
│   └── utils/
│       ├── test_validators.py                 # MISSING
│       └── test_transformers.py               # MISSING
│
├── integration/                     # Reorganizar existentes
│   ├── api/                         # API endpoints
│   │   ├── test_auth.py             # ✅ EXISTS (8 tests)
│   │   ├── test_entities.py         # ✅ EXISTS (15 tests)
│   │   ├── test_curations.py        # ✅ EXISTS (11 tests)
│   │   ├── test_concepts.py         # ✅ EXISTS (5 tests)
│   │   ├── test_places.py           # ✅ EXISTS (7 tests)
│   │   └── test_system.py           # ✅ EXISTS (2 tests)
│   │
│   ├── ai/                          # AI services
│   │   ├── test_ai.py               # ⚠️ UPDATE (fix fixtures)
│   │   ├── test_ai_orchestrate.py   # ⚠️ UPDATE (fix fixtures)
│   │   └── test_integration_transcription.py  # ⚠️ UPDATE
│   │
│   └── workflows/
│       └── test_integration.py      # ✅ EXISTS
│
├── e2e/                             # NOVO: End-to-end backend
│   └── test_complete_flow.py                  # MISSING
│
└── performance/                     # NOVO: Performance tests
    ├── test_load.py                           # MISSING - load testing
    └── test_concurrent.py                     # MISSING - concurrent requests
```

---

## 🎯 Test Pyramid Strategy

### Pirâmide Ideal (70/20/10)

```
         /\
        /  \  E2E (10%)
       /----\  
      /      \  Integration (20%)
     /--------\
    /          \  Unit (70%)
   /____________\
```

### Distribuição Proposta

| Tipo | Quantidade | % | Esforço | Prioridade |
|------|------------|---|---------|------------|
| **Unit Tests** | ~150 novos | 70% | 40h | 🔴 MÁXIMA |
| **Integration Tests** | ~40 novos | 20% | 25h | 🟡 ALTA |
| **E2E Tests** | ~15 novos | 10% | 20h | 🟢 MÉDIA |
| **Performance Tests** | ~10 novos | bonus | 15h | 🟢 BAIXA |

---

## 🚀 Roadmap de Implementação

### **Fase 1: Foundation (Week 1) - CRÍTICO** 🔴

**Meta:** Testes unitários para todos os 10 serviços refatorados

#### Day 1-2: Services Core (Audio)
- ✅ AudioRecordingService.test.js (30 testes)
  - Browser support checks
  - MediaRecorder lifecycle
  - Chunk collection
  - Error handling
  - iOS Safari compatibility

- ✅ AudioConversionService.test.js (35 testes)
  - Strategy pattern (MP3, Opus, WebM, WAV)
  - Format conversion accuracy
  - Fallback chains
  - Error handling
  - Performance benchmarks

- ✅ RecordingStateManager.test.js (25 testes)
  - State machine transitions
  - Queue management
  - Error state recovery
  - Retry logic

#### Day 3: Services Core (Concepts)
- ✅ ConceptValidationService.test.js (30 testes)
  - Duplicate detection
  - Levenshtein distance
  - Category normalization
  - Validation rules

- ✅ ConceptExtractionService.test.js (25 testes)
  - API integration
  - Text parsing
  - Image analysis
  - Merge logic

- ✅ ImageProcessingService.test.js (20 testes)
  - Queue processing
  - Async handling
  - Statistics tracking
  - Error recovery

#### Day 4: Services UI & Places
- ✅ RecordingUIManager.test.js (20 testes)
  - Button states
  - Timer display
  - Visualizer rendering
  - Progress indicators

- ✅ ConceptUIManager.test.js (25 testes)
  - Modal rendering
  - Autocomplete
  - Pills display
  - Similarity warnings

- ✅ PlacesSearchService.test.js (25 testes)
  - API integration
  - Filtering logic
  - Distance calculation
  - Rate limiting

- ✅ PlacesUIManager.test.js (20 testes)
  - Search modal
  - Results rendering
  - Filter controls

#### Day 5: Utilities
- ✅ uiHelpers.test.js (15 testes)
- ✅ errorHandling.test.js (20 testes)
- ✅ apiUtils.test.js (15 testes)
- ✅ audioUtils.test.js (20 testes)

**Deliverable:** 325 unit tests, 100% coverage dos serviços refatorados

---

### **Fase 2: Integration Updates (Week 2) - ALTA** 🟡

**Meta:** Atualizar testes de integração para nova arquitetura

#### Day 1: Fix Failing Tests
- 🔧 Fix test_syncManagerV3.test.js (3 falhas)
- 🔧 Fix test_realProduction.test.js (2 falhas)
- 🔧 Fix test_integration_real.test.js (5 falhas)
- 🔧 Fix DataStore initialization issues

#### Day 2-3: Update Module Tests
- ♻️ Update test_recordingModule.test.js
  - Testar orchestration do módulo refatorado
  - Testar integração com 4 serviços
  - Remover testes de lógica movida para serviços

- ♻️ Update test_conceptModule.test.js
  - Testar orchestration do módulo refatorado
  - Testar integração com 4 serviços
  - Remover duplicação

- ✅ Create test_placesModule.test.js (novo)
  - Testar orchestration
  - Testar integração com PlacesSearchService
  - Testar integração com PlacesUIManager

#### Day 4-5: Workflow Integration
- ✅ audioToMongoDB.test.js
  - Audio recording → conversion → transcription → concepts → save
- ✅ conceptExtraction.test.js
  - Full pipeline with validation
- ✅ placeImport.test.js
  - Google Places → Entity creation
- ✅ conflictResolution.test.js
  - Conflict detection → merge → resolution
- ✅ offlineSync.test.js
  - Offline storage → online sync → conflict handling

**Deliverable:** 10 falhas corrigidas, 50 integration tests atualizados/criados

---

### **Fase 3: Backend Fixes (Week 3) - ALTA** 🟡

**Meta:** Corrigir todos os testes backend falhando

#### Day 1-2: Fix AI Fixtures
- 🔧 Fix test_ai_orchestrate.py (14 tests failing)
  - Corrigir fixtures de OpenAI
  - Mock responses adequados
  - Testar error handling

- 🔧 Fix test_integration_transcription.py (5 tests failing)
  - Corrigir audio fixtures
  - Mock de transcrição
  - Testar full pipeline

#### Day 3: Backend Unit Tests
- ✅ test_ai_service.py (novo)
- ✅ test_transcription_service.py (novo)
- ✅ test_conflict_resolver.py (novo)
- ✅ test_validators.py (novo)

#### Day 4-5: Backend Integration
- ♻️ Reorganizar testes existentes na nova estrutura
- ✅ test_complete_flow.py (E2E backend)
- 📊 Coverage report

**Deliverable:** 0 failing tests, +30 unit tests backend

---

### **Fase 4: E2E & Performance (Week 4) - MÉDIA** 🟢

**Meta:** Testes E2E reais com Playwright + Performance benchmarks

#### Day 1-2: Setup Playwright
- 📦 Install `@playwright/test`
- ⚙️ Configure playwright.config.js
- 🎭 Setup browser contexts
- 🔐 Mock OAuth for E2E

#### Day 3: Critical E2E Flows
- ✅ completeRestaurantFlow.spec.js
  - Login → Record → Transcribe → Concepts → Save → Sync
- ✅ audioRecordingFlow.spec.js
  - Record → Convert → Upload
- ✅ syncFlow.spec.js
  - Offline edits → Online sync → Conflict resolution

#### Day 4: Edge Cases
- ✅ networkFailure.spec.js
  - Test offline scenarios
- ✅ browserCompatibility.spec.js
  - Chrome, Firefox, Safari
- ✅ dataCorruption.spec.js
  - Recovery scenarios

#### Day 5: Performance Tests
- ✅ audioProcessing.bench.js
  - Conversion performance
- ✅ imageQueue.bench.js
  - Queue throughput
- ✅ syncPerformance.bench.js
  - Sync speed benchmarks

**Deliverable:** 15 E2E tests, 10 performance benchmarks

---

## 🛠️ Tools & Configuration

### Frontend Stack

```json
// package.json additions
{
  "devDependencies": {
    "vitest": "^1.6.1",            // ✅ já instalado
    "jsdom": "^24.0.0",            // ✅ já instalado
    "@vitest/ui": "^1.6.1",        // ✅ já instalado
    "@playwright/test": "^1.45.0", // ❌ INSTALAR
    "@vitest/coverage-v8": "^1.6.1" // ✅ já instalado
  }
}
```

**Playwright Config (novo):**
```javascript
// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 2,
  workers: 4,
  use: {
    baseURL: 'http://localhost:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ]
});
```

**Vitest Config Updates:**
```javascript
// vitest.config.js updates
export default defineConfig({
  test: {
    // ... existing config
    
    // NOVO: Suporte a benchmarks
    benchmark: {
      include: ['tests/performance/**/*.bench.js']
    },
    
    // NOVO: Coverage exclusions atualizadas
    coverage: {
      exclude: [
        'tests/**',
        'scripts/modules/*.original*.js', // Backup files
        'scripts/legacy/**'
      ],
      // Aumentar thresholds gradualmente
      statements: 75,  // was 70
      branches: 65,    // was 60
      functions: 75,   // was 70
      lines: 75        // was 70
    }
  }
});
```

### Backend Stack

```python
# requirements-dev.txt (novo)
pytest==8.3.4
pytest-asyncio==0.24.0
pytest-cov==5.0.0              # ADICIONAR - coverage
pytest-benchmark==4.0.0        # ADICIONAR - performance
pytest-xdist==3.6.1            # ADICIONAR - parallel execution
httpx==0.27.0                  # já existe
faker==25.0.0                  # ADICIONAR - fake data
```

**Pytest Config Updates:**
```ini
# pytest.ini updates
[pytest]
markers =
    integration: Integration tests
    external_api: External API tests
    mongo: MongoDB tests
    openai: OpenAI tests
    slow: Slow tests
    benchmark: Performance benchmarks  # NOVO
    
# NOVO: Coverage configuration
addopts = 
    -ra
    --strict-markers
    --disable-warnings
    --tb=short
    --timeout=60
    --cov=app                          # NOVO
    --cov-report=html                  # NOVO
    --cov-report=term-missing          # NOVO
    -n auto                            # NOVO - parallel execution

# NOVO: Coverage thresholds
[coverage:run]
omit = 
    */tests/*
    */conftest.py
    */main.py

[coverage:report]
precision = 2
skip_empty = True
fail_under = 70  # Minimum 70% coverage
```

---

## 📝 Test Writing Standards

### Frontend Test Template

```javascript
/**
 * Test: ServiceName.test.js
 * Purpose: Unit tests for ServiceName
 * Coverage: [list key scenarios]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceName } from '../../scripts/services/ServiceName.js';

describe('ServiceName', () => {
  let service;
  
  beforeEach(() => {
    // Setup
    service = new ServiceName();
  });
  
  afterEach(() => {
    // Cleanup
    vi.restoreAllMocks();
  });
  
  describe('Constructor', () => {
    it('should initialize with default values', () => {
      expect(service).toBeDefined();
      expect(service.someProperty).toBe(expectedValue);
    });
    
    it('should throw if dependencies missing', () => {
      window.someUtils = undefined;
      expect(() => new ServiceName()).toThrow('someUtils not loaded');
    });
  });
  
  describe('Method Name', () => {
    it('should [expected behavior]', async () => {
      // Arrange
      const input = 'test data';
      
      // Act
      const result = await service.methodName(input);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.property).toBe(expected);
    });
    
    it('should throw on invalid input', async () => {
      await expect(service.methodName(null))
        .rejects.toThrow('Input is required');
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle empty input', () => {
      // ...
    });
    
    it('should handle large datasets', () => {
      // ...
    });
  });
});
```

### Backend Test Template

```python
"""
Test: test_service_name.py
Purpose: Unit tests for ServiceName
Coverage: [list key scenarios]
"""
import pytest
from app.services.service_name import ServiceName


class TestServiceName:
    """Tests for ServiceName"""
    
    @pytest.fixture
    def service(self):
        """Create service instance"""
        return ServiceName()
    
    def test_initialization(self, service):
        """Should initialize with default values"""
        assert service is not None
        assert service.some_property == expected_value
    
    @pytest.mark.asyncio
    async def test_async_method(self, service):
        """Should [expected behavior]"""
        # Arrange
        input_data = "test"
        
        # Act
        result = await service.async_method(input_data)
        
        # Assert
        assert result is not None
        assert result.property == expected
    
    def test_error_handling(self, service):
        """Should throw on invalid input"""
        with pytest.raises(ValueError, match="Input is required"):
            service.method_name(None)
    
    @pytest.mark.benchmark
    def test_performance(self, benchmark, service):
        """Should process within acceptable time"""
        result = benchmark(lambda: service.method_name("test"))
        assert result is not None
```

---

## 📊 Success Metrics

### Phase 1 Success Criteria
- ✅ 325+ unit tests created
- ✅ 100% coverage of 10 refactored services
- ✅ 100% coverage of 4 utilities
- ✅ 0 failing unit tests
- ✅ All tests run in <30s

### Phase 2 Success Criteria
- ✅ 0 failing tests (fix 10 current failures)
- ✅ 50+ integration tests updated/created
- ✅ Module tests updated for new architecture
- ✅ 5 workflow integration tests

### Phase 3 Success Criteria
- ✅ 0 failing backend tests
- ✅ 30+ new backend unit tests
- ✅ Backend coverage > 70%
- ✅ All AI tests passing

### Phase 4 Success Criteria
- ✅ 15 E2E tests covering critical flows
- ✅ 10 performance benchmarks
- ✅ E2E tests run in <5min
- ✅ Cross-browser compatibility verified

### Overall Success Criteria
- 📊 **Total Tests:** 500+ (was 339)
- 📊 **Pass Rate:** 100% (was 97.9%)
- 📊 **Frontend Coverage:** 80%+ (was 70%)
- 📊 **Backend Coverage:** 75%+ (unknown)
- 📊 **Test Execution:** <2min unit, <5min all
- 📊 **CI/CD:** All tests automated in pipeline

---

## 🔄 CI/CD Integration

### GitHub Actions Workflow (novo)

```yaml
# .github/workflows/tests.yml
name: Tests

on: [push, pull_request]

jobs:
  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm test
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Generate coverage
        run: npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
  
  backend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      
      - name: Install dependencies
        working-directory: ./concierge-api-v3
        run: |
          pip install -r requirements.txt
          pip install -r requirements-dev.txt
      
      - name: Run tests
        working-directory: ./concierge-api-v3
        run: pytest --cov=app --cov-report=xml
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./concierge-api-v3/coverage.xml
```

---

## 📚 Documentation Updates Needed

1. **tests/README.md** - Reescrever completamente com nova estrutura
2. **docs/TESTING.md** - Atualizar estratégia e cobertura
3. **CONTRIBUTING.md** - Adicionar guidelines de teste
4. **package.json scripts** - Adicionar novos comandos
5. **concierge-api-v3/README.md** - Adicionar instruções de teste

---

## 💰 Esforço Estimado

| Fase | Tempo | Custo (dev hours) | Prioridade |
|------|-------|-------------------|------------|
| Fase 1 | 1 semana | 40h | 🔴 CRÍTICA |
| Fase 2 | 1 semana | 25h | 🟡 ALTA |
| Fase 3 | 1 semana | 20h | 🟡 ALTA |
| Fase 4 | 1 semana | 20h | 🟢 MÉDIA |
| **TOTAL** | **4 semanas** | **105h** | - |

---

## 🎯 Próximos Passos IMEDIATOS

### Esta Sessão (agora)
1. ✅ Revisar e aprovar este plano
2. 🔄 Criar branch `testing-overhaul`
3. 🚀 Começar Fase 1 - Day 1 (AudioRecordingService.test.js)

### Próxima Sessão
1. Continuar Fase 1 - Days 2-5
2. Completar unit tests de todos os serviços
3. Gerar coverage report

---

## ❓ Questões para Discussão

1. **Priorização:** Concordas com a ordem? Ou prefere começar pelos testes falhando?
2. **Playwright:** Vale a pena E2E real ou focar só em unit/integration?
3. **Coverage Targets:** 80% frontend / 75% backend é realista?
4. **Backend Environment:** Configurar pytest no teu ambiente agora ou depois?
5. **CI/CD:** Implementar GitHub Actions na Fase 1 ou deixar para o final?

---

**Status:** ⏳ AGUARDANDO APROVAÇÃO

Vamos começar? 🚀
