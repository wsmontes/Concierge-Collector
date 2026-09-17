/**
 * Cadeia crítica de autoração do Collector, ponta a ponta.
 *
 * O que este spec prova, na ordem em que o curador faz:
 *   1. criar uma Curation por texto (nome, descrição, nota pública e um
 *      conceito) a partir do próprio app;
 *   2. salvar;
 *   3. recarregar a página — a Curation continua lá;
 *   4. abrir de novo pelo card e salvar uma segunda edição (o caminho de
 *      UPDATE, não de INSERT);
 *   5. editar SEM salvar e FECHAR a página antes de qualquer sync — o rascunho
 *      sobrevive à interrupção;
 *   6. abrir a página, retomar pelo card (o texto não salvo volta ao editor) e
 *      salvar;
 *   7. vincular a Curation a uma Entity existente no acervo;
 *   8. conferir na API que a Curation existe com conceitos e provenance, que o
 *      texto retomado chegou ao servidor e que a Entity está vinculada.
 *
 * Cada passo afirma um observável (texto na tela, URL, card na lista, resposta
 * da API) — nunca um detalhe interno do encadeamento de durabilidade.
 *
 * Pré-requisitos (o README detalha): FastAPI local em `-test` sobre Mongo
 * local, `COLLECTOR_E2E=1`. O servidor estático do Collector sobe pelo
 * próprio harness na porta que o `config.js` trata como local.
 */
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import {
    CONCEPT_CATEGORY,
    CONCEPT_VALUE,
    SEEDED_ENTITY_ID,
    SEEDED_ENTITY_NAME,
    apiBaseUrl,
    devLoginToken,
    isEnabled,
} from './preconditions'

const live = isEnabled() ? test : test.skip

const API = apiBaseUrl()

interface CurationRow {
    curation_id?: string
    restaurant_name?: string
    entity_id?: string | null
    version?: number
    notes?: { public?: string | null }
    categories?: Record<string, string[]>
    sources?: Record<string, unknown[]>
}

const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` })

/** Chaves que o app lê no boot e `cleanupBrowserData` preserva a cada reload. */
async function seedCollectorSession(page: Page, token: string): Promise<void> {
    await page.addInitScript((value: string) => {
        localStorage.setItem('oauth_access_token', value)
        localStorage.setItem('oauth_token_expiry', String(Date.now() + 55 * 60 * 1000))
    }, token)
}

/**
 * Boot completo do app autenticado: token aceito, DataStore aberto, Curations
 * puxadas e as Entities vinculadas resolvidas no cache local (o card da
 * fixture só mostra o nome da Entity quando ela está local).
 */
async function waitForAuthenticatedCollection(page: Page): Promise<void> {
    await expect(page.locator('#curations-container .collection-card').first()).toBeVisible({ timeout: 120_000 })
}

const sleep = (ms: number): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, ms)
    return promise
}

/** Espera o estado do registro na API — o push é assíncrono (quickSync). */
async function waitForCuration(
    request: APIRequestContext,
    token: string,
    name: string,
    subject: string,
    check: (row: CurationRow) => string | null
): Promise<CurationRow> {
    const deadline = Date.now() + 90_000
    let last = 'nenhuma tentativa'
    while (Date.now() < deadline) {
        const response = await request.get(
            `${API}/api/v3/curations/search?q=${encodeURIComponent(name)}&limit=10`,
            { headers: authHeaders(token) }
        )
        if (response.ok()) {
            const body = (await response.json()) as { items?: CurationRow[] }
            const rows = (body.items || []).filter((item) => item.restaurant_name === name)
            if (rows.length === 1) {
                const problem = check(rows[0])
                if (!problem) return rows[0]
                last = problem
            } else {
                last = `esperava exatamente 1 Curation chamada "${name}", encontrei ${rows.length}`
            }
        } else {
            last = `HTTP ${response.status()}`
        }
        await sleep(1_500)
    }
    throw new Error(`Timeout esperando ${subject} na API: ${last}`)
}

// Os dois helpers abaixo têm vários pontos de uso que precisam concordar
// (o mesmo recorte de conceitos em 3 checagens; a mesma receita de localizar
// card em 6 passos) — a função existe para que essa receita não derive.

const flattenConcepts = (categories: Record<string, string[]> | undefined): string[] =>
    Object.values(categories || {}).flatMap((values) => (Array.isArray(values) ? values : []))

/**
 * O card da Curation na lista. O nome da rodada (`E2E Authoring <stamp>`) é
 * único, e `visible` + `first` absorvem o render duplicado que o app deixa
 * logo após salvar (dois nós para a mesma Curation, um escondido).
 */
const cardByName = (page: Page, name: string) =>
    page
        .locator('#curations-container .collection-card', { hasText: name })
        .filter({ visible: true })
        .first()

/** Entrada canônica de nova curadoria no app: FAB → Quick actions → Manual entry. */
async function startNewCuration(page: Page): Promise<void> {
    await page.locator('#fab').click()
    await page.locator('#quick-manual').click()
    await expect(page.locator('#restaurant-edit-toolbar')).toBeVisible()
    await expect(page.locator('#save-restaurant')).toContainText(/save curation/i)
}

/**
 * Abre o editor pelo card da lista. O id sai da própria URL e é conferido
 * contra o id que a API devolve — é isso que garante que os passos seguintes
 * falam do MESMO registro.
 */
async function openEditorFromCard(page: Page, name: string, expectedId: string): Promise<void> {
    await cardByName(page, name).locator('.btn-edit-curation').click()
    await expect(page).toHaveURL(/#\/curation\/.+\/edit/)
    const id = decodeURIComponent(new URL(page.url()).hash.split('/')[2] || '')
    expect(id).toBe(expectedId)
    await expect(page.locator('#restaurant-name')).toHaveValue(name)
}

live('authoring chain: create → save → reload → edit → save → draft survives interruption → resume → sync → API', async ({
    page,
    context,
    request,
}) => {
    const stamp = Date.now()
    const curationName = `E2E Authoring ${stamp}`
    const notesInitial = `Nota inicial do harness ${stamp}`
    const notesEdited = `Nota editada do harness ${stamp}`
    const notesDraft = `Nota NÃO SALVA ${stamp}`

    const token = await devLoginToken(request)

    await seedCollectorSession(page, token)
    await page.goto('/')
    await waitForAuthenticatedCollection(page)

    // ── 1. criar a Curation (texto + um conceito) ──────────────────────────
    await startNewCuration(page)
    await page.locator('#restaurant-name').fill(curationName)
    await page.locator('#restaurant-description').fill('Curadoria criada pelo harness de autoração.')
    await page.locator('#curation-notes-public').fill(notesInitial)
    await page.locator('#curation-review-concepts').click()
    await page.locator('#curation-edit-concepts-manually').click()
    await page.locator(`#concepts-container button[data-category="${CONCEPT_CATEGORY}"]`).click()
    await page.locator('#new-concept-value').fill(CONCEPT_VALUE)
    await page.locator('.confirm-add-concept').click()
    await expect(page.locator('#curation-concepts-summary')).toContainText('1 concept')

    // ── 2. salvar ─────────────────────────────────────────────────────────
    await page.locator('#save-restaurant').click()
    await expect(cardByName(page, curationName)).toBeVisible()

    const created = await waitForCuration(request, token, curationName, 'a Curation recém-criada', (row) =>
        flattenConcepts(row.categories).includes(CONCEPT_VALUE) ? null : 'conceito ainda ausente no servidor'
    )
    const curationId = created.curation_id as string
    expect(curationId).toBeTruthy()

    // ── 3. reload: a Curation sobrevive ao recarregamento ─────────────────
    await page.reload({ waitUntil: 'load' })
    await waitForAuthenticatedCollection(page)
    await expect(cardByName(page, curationName)).toBeVisible()

    // ── 4. editar e salvar de novo (caminho de UPDATE) ────────────────────
    await openEditorFromCard(page, curationName, curationId)
    // O editor veio do registro persistido — não da memória da sessão anterior.
    await expect(page.locator('#curation-notes-public')).toHaveValue(notesInitial)
    await page.locator('#curation-notes-public').fill(notesEdited)
    await page.locator('#save-restaurant').click()
    await expect(cardByName(page, curationName)).toBeVisible()

    const updated = await waitForCuration(request, token, curationName, 'a 2ª edição salva', (row) =>
        row.notes?.public === notesEdited ? null : `notes.public ainda é ${JSON.stringify(row.notes?.public)}`
    )
    expect(updated.curation_id).toBe(curationId)
    expect(updated.version ?? 0).toBeGreaterThanOrEqual(2)

    // ── 5. rascunho sobrevive à interrupção (fecha a página ANTES do sync) ─
    await openEditorFromCard(page, curationName, curationId)
    await page.locator('#curation-notes-public').fill(notesDraft)
    // O autosave durável é debounced (3s) e o flush roda em pagehide/visibility:
    // esperar a janela garante que o rascunho já está no IndexedDB quando a
    // página fecha. Nada aqui foi salvo — este texto só existe localmente.
    await page.waitForTimeout(5_000)
    await page.close()

    // ── 6. retomar: nova página, o texto não salvo volta ao editor ────────
    const resumed = await context.newPage()
    await seedCollectorSession(resumed, token)
    await resumed.goto('/')
    await waitForAuthenticatedCollection(resumed)
    await openEditorFromCard(resumed, curationName, curationId)
    await expect(resumed.locator('#curation-notes-public')).toHaveValue(notesDraft)

    // ── 7. salvar a retomada (o rascunho vira estado persistido) ──────────
    await resumed.locator('#save-restaurant').click()
    await expect(cardByName(resumed, curationName)).toBeVisible()
    await waitForCuration(request, token, curationName, 'o rascunho retomado salvo', (row) =>
        row.notes?.public === notesDraft ? null : `notes.public ainda é ${JSON.stringify(row.notes?.public)}`
    )

    // ── 8. vincular a Entity existente (seletor local-first) ──────────────
    await cardByName(resumed, curationName).locator('.btn-link-entity').click()
    await expect(resumed.locator('#find-entity-modal')).toBeVisible()
    await resumed.locator('#fem-search-input').fill(SEEDED_ENTITY_NAME)
    await resumed.locator('#find-entity-modal .fem-search-btn').click()
    const localEntityCard = resumed.locator(
        `#find-entity-modal [data-local-entity-card="${SEEDED_ENTITY_ID}"]`
    )
    await expect(localEntityCard).toBeVisible({ timeout: 30_000 })
    await expect(localEntityCard).toContainText(SEEDED_ENTITY_NAME)
    await localEntityCard.locator('.fem-local-select').click()
    await expect(resumed.locator('#find-entity-modal')).toBeHidden()
    // O app confirma o vínculo na tela (não é só um PATCH silencioso).
    await expect(resumed.getByText(`Review linked to "${SEEDED_ENTITY_NAME}"`).first()).toBeVisible({
        timeout: 15_000,
    })

    // ── 9. conferir na API ────────────────────────────────────────────────
    const linked = await waitForCuration(request, token, curationName, 'o vínculo com a Entity', (row) =>
        row.entity_id === SEEDED_ENTITY_ID ? null : `entity_id ainda é ${JSON.stringify(row.entity_id)}`
    )

    expect(linked.restaurant_name).toBe(curationName)
    expect(flattenConcepts(linked.categories)).toContain(CONCEPT_VALUE)
    // Provenance: a cadeia é só texto, então o registro tem que trazer o
    // escopo de origem gravado pelo app (não o conteúdo reconstruído).
    expect(Object.keys(linked.sources || {})).toContain('manual')
    expect(linked.sources?.manual?.length ?? 0).toBeGreaterThan(0)
    expect(linked.notes?.public).toBe(notesDraft)

    // A Entity vinculada existe de verdade no acervo (não é um id órfão).
    const entityResponse = await request.get(`${API}/api/v3/entities/${encodeURIComponent(SEEDED_ENTITY_ID)}`, {
        headers: authHeaders(token),
    })
    expect(entityResponse.ok()).toBe(true)
    const entity = (await entityResponse.json()) as { name?: string }
    expect(entity.name).toBe(SEEDED_ENTITY_NAME)
})

/**
 * Captura por dispositivo (review gravado e foto de câmera) NÃO é automatizada
 * aqui — o caminho existe na UI (`#curation-record-review` e `#take-photo`),
 * mas não é alcançável de forma honesta neste harness:
 *
 *   - áudio: `startRecording()` depende de `getUserMedia`/MediaRecorder reais.
 *     O Chromium headless não tem device de entrada; forçar
 *     `--use-fake-device-for-media-stream` injetaria um stream sintético, isto
 *     é, um mock da captura — exatamente o que este spec não faz. Além disso a
 *     transcrição sai para o provedor de IA (chave e rede externas).
 *   - foto: `#take-photo` é um input de arquivo com `capture=environment`
 *     (câmera do aparelho); no desktop ele só alcança o seletor de arquivos do
 *     sistema.
 *
 * O encadeamento de durabilidade do áudio (PendingAudioManager + associação
 * pós-save) e o pipeline de imagem (resize + `sources.image`) seguem sem
 * cobertura E2E; a cadeia provada acima usa o caminho de texto, que é o mesmo
 * save/restore/sync.
 */
test.fixme('capture-based authoring: record a review and take a photo through the same chain', async () => {
    // Passos pretendidos, para quem tiver device ou fake-stream consentido:
    // 1. #fab → #quick-record → #curation-record-review → conceder microfone;
    // 2. gravar alguns segundos, parar, esperar a transcrição;
    // 3. #take-photo (ou #gallery-input via setInputFiles) e conferir o preview;
    // 4. repetir a cadeia do spec principal e afirmar `sources.audio` e
    //    `sources.image` na API.
})
