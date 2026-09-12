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
     * Divide uma lista de ids em lotes que respeitam TANTO a contagem máxima
     * quanto o orçamento de caracteres codificados.
     *
     * Garantias:
     * - nenhum id é descartado ou reordenado;
     * - o parâmetro `ids` de cada lote fica em `maxChars` ou menos;
     * - um id sozinho maior que o orçamento vira lote próprio (nunca some).
     *
     * @param {Iterable<string>} ids
     * @param {Object} [options]
     * @param {number} [options.maxIds]  Teto de itens por lote.
     * @param {number} [options.maxChars] Orçamento do parâmetro `ids` codificado.
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
            // +1 do separador ',' que entra na URL
            const cost = encodeURIComponent(id).length + 1;
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

    return { chunkIds, DEFAULT_MAX_IDS, DEFAULT_MAX_CHARS };
})();

window.RequestChunking = RequestChunking;
