# Estudo de design do Feedmine → Collector

**Data:** 2026-08-15 · **Escopo:** soluções de UX/UI do feedmine avaliadas para o Collector (tema concierge)

## O que o feedmine faz bem

### 1. Tokens em 3 camadas (`DesignTokens.swift`)

- **Primitivas**: escalas de cor geradas matematicamente em **OKLCH** (espaço perceptual) — `neutral(level)`, `warm(level)`, `cool(level)`, `accent(level)` com hue interpolado (amber → coral).
- **Semântica**: propósito, não cor — `fgDefault/fgMuted/fgSubtle`, `bgSurface/bgElevated`, `borderDefault`, ações e feedback. "As únicas cores que views devem referenciar."
- **Componente**: tokens de UI concreta (cardBg, swipe, badges, gradientes de categoria).

### 2. "Cards resolvidos antes de aparecer" (`FeedCardPresentation`)

Estado terminal do media (`image | placeholder | none`) é decidido **antes** do card renderizar — zero swap placeholder→imagem, zero fade de chegada, zero download pós-inserção. Sem imagem → **placeholder de gradiente na cor da categoria** (`base.opacity(0.3) → 0.15`), nunca um card branco vazio.

### 3. Read-state por opacidade

Lido = `opacity 0.7` + overlay preto 0.15 sobre o thumbnail — escaneabilidade sem esconder conteúdo.

### 4. Detalhes

Linha de metadados quieta (categoria colorida · fonte · data relativa com formatter cacheado), badges de media (vídeo/podcast/novo), swipe actions com cores semânticas.

## O que foi portado ao Collector

| Padrão feedmine | Implementação no Collector |
|---|---|
| Placeholder de categoria (sem card branco) | **Véu de fallback**: `card-og-veil--fallback` com gradiente diagonal no **tom do status** (draft=bronze, linked=aço, active=garrafa, archived=pedra, deleted=tijolo), ancorado nas classes `card-accent-*` existentes. Sem foto E sem rede: decidido no render. |
| Read-state por opacidade | Cards `archived`/`deleted` com `opacity 0.78` (voltam a 1 no hover) |
| Camadas de token | O design-system.css já tinha primitivas+semântica; os fallbacks usam vars (`--og-fallback-a/b`) por tom — mesma ideia de componente |
| Cascata de candidatas de imagem | Já portada no `og_image_service.py` (JSON-LD, `<img>` lazy, filtro de decorativas, gate de dimensão) — ver memória og-image-card-veil |

## Avaliado e NÃO portado (com motivo)

- **OKLCH matemático**: o tema concierge já tem uma rampa perceptual curada (limestone/olive) — trocar geraria re-trabalho visual sem ganho.
- **srcset/responsive variants**: o Pillow já redimensiona server-side; o cap de 20MB protege.
- **Swipe actions**: o Collector é web desktop/mobile com FAB e botões explícitos — gesto de swipe não é idiomático aqui.
- **Circadian engine (paleta por fase do dia)**: dark mode é intencionalmente off no Collector (ver comentário no design-system.css); fase do dia seria ruído numa ferramenta de trabalho.
- **Datas relativas**: cards não exibem timestamps (conflito modal usa data absoluta com fuso).
- **ImageUpgradePolicy**: cache 1h + Cache Storage já evitam re-fetch.
