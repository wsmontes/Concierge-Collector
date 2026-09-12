/**
 * RequestChunking - divide listas de ids em requisições que cabem nos limites
 * reais do transporte.
 *
 * Contexto (2026-09-12): os endpoints `?ids=` recebem listas grandes e havia
 * DOIS limites desconsiderados:
 *
 *   1. o cap do servidor — `?ids` aceita no máximo 500 (`app/api/entities.py`);
 *   2. o TAMANHO DA URL — o edge de produção responde `414 URI Too Long` acima
 *      de ~16KB. O detalhe que engana o diagnóstico: a resposta de erro do edge
 *      NÃO traz cabeçalhos CORS, então o browser reporta "bloqueado por CORS"
 *      em vez de "URL longa" — o log do servidor ainda mostra 200 para as
 *      requisições que passaram, o que faz o problema parecer intermitente.
 *
 * Um lote por contagem (500 ids) produz ~21KB com ids longos — os ids de
 * `overture_*` têm 38 caracteres — e o pull inteiro falhava. O corte por
 * contagem continua valendo, mas agora com um orçamento de bytes para o
 * parâmetro `ids` já codificado (ids de `rest_*` têm acento e vírgula, então o
 * tamanho codificado difere do literal).
 *
 * Dependências: nenhuma.
 */
const RequestChunking = (() => {
    // Fallbacks usados quando o AppConfig não está disponível (harnesses de
    // teste carregam este arquivo isolado). O valor canônico vive no config.
    const DEFAULT_MAX_IDS = 500;
    const DEFAULT_MAX_CHARS = 6000;

    function budget(name, fallback) {
        try {
            const value = window.AppConfig?.api?.backend?.[name];
            return Number.isFinite(value) && value > 0 ? value : fallback;
        } catch (_) {
            return fallback;
        }
    }

    /**
     * Serializa os ids do jeito que eles VÃO na URL: parâmetro repetido.
     *
     *   ids=a&ids=b&ids=c
     *
     * Não é CSV de propósito. Ids do acervo podem conter vírgula
     * (`rest_<slug>_<lat>,<lng>` — 408 entidades), e um separador por vírgula
     * torna o transporte ambíguo: o servidor fragmentava o id e a entidade
     * nunca era devolvida (curadorias órfãs para sempre no cache local).
     *
     * Usada tanto pelo chunker (para MEDIR) quanto pelo ApiService (para
     * ENVIAR), garantindo que o orçamento medido é o orçamento real.
     *
     * @param {Iterable<string>} ids
     * @returns {string} query string (ex.: "ids=a&ids=b")
     */
    function idsQuery(ids) {
        const params = new URLSearchParams();
        for (const id of ids || []) {
            if (id !== null && id !== undefined && String(id).trim()) {
                params.append('ids', String(id));
            }
        }
        return params.toString();
    }

    /**
     * Tamanho que um id ocupa já codificado (sem o nome do parâmetro).
     * Medido com URLSearchParams — o MESMO codificador do envio — para não
     * haver divergência entre o orçamento e a URL real.
     *
     * @param {string} id
     * @returns {number}
     */
    function encodedIdLength(id) {
        const solo = new URLSearchParams();
        solo.append('ids', String(id));
        // "ids=" tem 4 caracteres
        return solo.toString().length - 4;
    }

    /**
     * Divide uma lista de ids em lotes que respeitam TANTO a contagem máxima
     * quanto o orçamento de caracteres da query codificada.
     *
     * Garantias:
     * - nenhum id é descartado ou reordenado;
     * - `idsQuery(lote).length` fica em `maxChars` ou menos;
     * - um id sozinho maior que o orçamento vira lote próprio (nunca some).
     *
     * @param {Iterable<string>} ids
     * @param {Object} [options]
     * @param {number} [options.maxIds]  Teto de itens por lote.
     * @param {number} [options.maxChars] Orçamento da query `ids` codificada.
     * @returns {string[][]} Lotes, na ordem original.
     */
    function chunkIds(ids, options = {}) {
        const maxIds = options.maxIds || budget('entitiesIdsMaxPerRequest', DEFAULT_MAX_IDS);
        const maxChars = options.maxChars || budget('entitiesIdsMaxChars', DEFAULT_MAX_CHARS);

        const list = Array.from(ids || []);
        const chunks = [];
        let current = [];
        let size = 0;

        for (const raw of list) {
            const id = String(raw);
            // Primeiro id: "ids=" (4). Seguintes: "&ids=" (5).
            const overhead = current.length === 0 ? 4 : 5;
            const cost = overhead + encodedIdLength(id);
            const mustFlush = current.length >= maxIds
                || (current.length > 0 && size + cost > maxChars);
            if (mustFlush) {
                chunks.push(current);
                current = [];
                size = 0;
            }
            current.push(id);
            size += cost;
        }
        if (current.length) chunks.push(current);

        return chunks;
    }

    return { chunkIds, idsQuery, encodedIdLength, DEFAULT_MAX_IDS, DEFAULT_MAX_CHARS };
})();

window.RequestChunking = RequestChunking;
