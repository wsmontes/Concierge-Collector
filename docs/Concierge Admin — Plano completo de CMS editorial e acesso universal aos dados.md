# Concierge Admin — Plano completo de CMS editorial

## 1. Objetivo

Transformar o Admin do Concierge em uma verdadeira **interface de exploração, leitura e edição do conhecimento**, sem transformar o produto em um CMS corporativo excessivamente complexo.

Ao término deste plano, um editor deve ser capaz de:

1. Encontrar qualquer Entity, Curation ou Collection sem conhecer seu ID.
2. Buscar conteúdo usando tanto pesquisa textual quanto qualquer campo específico.
3. Abrir qualquer resultado e entender imediatamente o que ele representa.
4. Visualizar todos os campos existentes no registro, inclusive metadata dinâmica, campos legados e estruturas JSON.
5. Editar qualquer campo editorial que seja mutável.
6. Entender quando um campo pertence à Entity, à Curation ou à Collection.
7. Navegar entre Entity ↔ Curations ↔ Collections sem voltar manualmente para listas.
8. Encontrar Curations por Concepts, curator, conteúdo textual, fontes, estado, Entity, Collection etc.
9. Trabalhar com mídia, fontes, transcript e Concepts diretamente a partir do conteúdo.
10. Nunca depender de IDs técnicos para compreender o que está vendo.

O Admin deve responder basicamente:

> **“Mostre todo o conhecimento que temos, deixe-me encontrar qualquer coisa e permita que eu corrija qualquer informação.”**

---

# 2. O que significa “qualquer campo”

Esse requisito precisa ter uma definição precisa.

O modelo atual já mostra por que um formulário tradicional não é suficiente.

### Entity

Hoje uma Entity contém, entre outros:

- `name`
- `type`
- `status`
- `externalId`
- `metadata[]`
- `data`
- `sync`
- `createdBy`
- `updatedBy`
- `createdAt`
- `updatedAt`
- `version`
- IDs internos

Além disso, `metadata.data` e `data` são estruturas flexíveis. 

### Curation

Uma Curation contém:

- `restaurant_name`
- `entity_id`
- `status`
- `curator_id`
- `curator`
- `curator_type`
- `notes.public`
- `notes.private`
- `city`
- `type`
- `categories`
- `transcript`
- `sources`
- `items`
- `embeddings`
- `embeddings_metadata`
- `createdBy`
- `updatedBy`
- `createdAt`
- `updatedAt`
- `version`
- `catalog_sequence`
- IDs internos

`categories`, `sources`, `items` e partes da provenance são estruturas abertas ou parcialmente abertas. 

Portanto adotaremos três níveis de edição.

### Nível 1 — Editor editorial

Interface bonita e específica para os campos utilizados normalmente.

Exemplo:

- Name
- Status
- Entity
- Curator
- Summary
- Public note
- Private note
- Concepts
- Images
- Sources
- Transcript

### Nível 2 — Field Inspector

Mostra **todos os campos do objeto**, incluindo aqueles que não possuem componente editorial dedicado.

Exemplo:

```text
sources.audio[0].duration
sources.audio[0].filename
sources.image[2].analysis
categories.Mood
metadata[0].data.place_id
embeddings_metadata.model
```

Nada desaparece porque não criamos uma tela específica para aquilo.

### Nível 3 — Advanced structured editor

Campos flexíveis podem ser editados numa representação estruturada adequada:

- object editor;
- array editor;
- key/value editor;
- JSON editor como último recurso.

Assim conseguimos suportar dados antigos, novos campos e campos inesperados sem precisar reconstruir a interface toda vez.

---

# 3. Uma exceção importante: campos administrados pelo sistema

“Editar qualquer campo” não deve permitir que o editor destrua invariantes internas.

Todo campo será visível, mas terá uma das seguintes classificações:

| Categoria | Comportamento |
|---|---|
| Editorial | leitura + edição |
| Canonical Entity | edição na Entity |
| Relationship | edição por selector/linker |
| Flexible structured | edição estruturada / Advanced |
| Derived | leitura + link para sua origem |
| System-managed | somente leitura |

Por exemplo:

`version`, `_id`, timestamps e `catalog_sequence` devem normalmente ser visíveis, mas read-only.

Da mesma forma, o design já aprovado estabelece que `city` e `type` existentes na Curation podem ser projeções operacionais da Entity, e não propriedade editorial da Curation. 

A interface deverá dizer:

```text
City
Victoria

Derived from Entity
Edit Entity →
```

e não apresentar uma caixa de texto que faça parecer que existem duas cidades independentes.

Esse princípio é essencial.

**Acesso universal aos dados não significa abandonar ownership do domínio.**

---

# 4. Arquitetura de informação do Admin

A navegação atual em Content contém somente Collections e Curation Explorer. 

Ela deve evoluir para:

```text
OVERVIEW
  Dashboard

CONTENT
  Curations
  Entities
  Collections

DISTRIBUTION
  Applications

OPERATIONS
  Operations
```

`Curation Explorer` deixa de parecer uma ferramenta paralela.

Ele passa a ser simplesmente:

# Curations

O excelente mecanismo atual de seleção em massa continua existindo dentro dessa tela.

---

# 5. Padrão universal de navegação

Curations, Entities e Collections deverão seguir o mesmo padrão mental.

```text
LIST
  ↓
QUICK PREVIEW
  ↓
FULL RECORD
  ↓
EDIT
```

Isso elimina a sensação atual de que cada parte do Admin é uma ferramenta diferente.

## Lista

Serve para explorar grandes conjuntos.

## Quick Preview

Drawer lateral, sem sair da lista.

Mostra informação suficiente para identificar e avaliar o item.

## Full Record

Página canônica com URL própria.

Exemplo:

```text
/admin/curations/{id}
/admin/entities/{id}
/admin/collections/{id}
```

Deep links passam a funcionar naturalmente.

---

# 6. Global Search

Adicionar pesquisa global ao shell do Admin.

Atalho:

```text
⌘ K
Ctrl K
```

Pesquisar:

```text
Ritz
```

poderia retornar:

```text
ENTITIES
Ritz Restaurant
Restaurant · São Paulo

CURATIONS
Ritz Restaurant
Wagner · Human · Active

Ritz Restaurant
Synthetic · Draft

COLLECTIONS
Best Business Lunches in São Paulo
contains Ritz Restaurant
```

O resultado deve identificar visualmente o tipo de objeto.

Nunca:

```text
cur_01HE90A...
ent_fa992...
```

como informação principal.

IDs continuam pesquisáveis, mas secundários.

---

# 7. Dois tipos de pesquisa

Precisamos separar duas necessidades muito diferentes.

## 7.1 Search simples

A caixa principal pesquisa os campos editoriais mais importantes:

### Curation

- Entity/name
- `restaurant_name`
- description/summary quando existente
- public notes
- private notes
- transcript
- Concepts
- curator name
- curator ID
- Curation ID
- city
- type
- source metadata relevante

### Entity

- name
- type
- external IDs
- address
- city
- country
- website
- phone
- metadata textual
- campos textuais dentro de `data`

### Collection

- title
- slug
- description
- Curation/Entity names pertencentes à Collection quando apropriado

Essa pesquisa deve atender aproximadamente 90% das situações.

---

# 8. Advanced Field Search

Aqui resolvemos de maneira limpa o requisito **buscar qualquer campo**.

Em vez de tentar colocar 200 filtros na tela, disponibilizamos:

```text
+ Add filter

Field
[ categories.Mood                ▾ ]

Operator
[ contains                       ▾ ]

Value
[ Casual                           ]
```

Exemplos:

```text
notes.private
contains
anniversary
```

```text
sources.audio
exists
```

```text
curator_type
equals
synthetic
```

```text
metadata.google_places.rating
greater than
4
```

```text
entity_id
is empty
```

Operadores:

- equals;
- not equals;
- contains;
- does not contain;
- starts with;
- greater than;
- less than;
- exists;
- does not exist;
- is empty;
- is not empty;
- before;
- after;
- contains any;
- contains all.

Isso oferece capacidade real de busca arbitrária sem encher a interface normal de controles.

---

# 9. Field Registry

Para sustentar tudo isso de maneira organizada, criar uma pequena camada no Admin chamada conceitualmente:

```ts
ContentFieldRegistry
```

Cada campo conhecido possui metadata como:

```ts
{
  path: 'notes.public',
  label: 'Public recommendation',
  owner: 'curation',
  type: 'longText',
  searchable: true,
  filterable: true,
  editable: true,
  listable: true,
  section: 'curation'
}
```

Outro exemplo:

```ts
{
  path: 'city',
  label: 'City',
  owner: 'entity',
  derivedIn: 'curation',
  editable: false
}
```

Outro:

```ts
{
  path: 'version',
  label: 'Version',
  type: 'number',
  editable: false,
  system: true
}
```

Essa registry controla:

- labels;
- field type;
- editor apropriado;
- filtros;
- colunas;
- owner;
- search;
- read-only;
- advanced/basic;
- relação com outro objeto.

Mas ela **não determina quais campos existem**.

Isso é importante.

O Inspector compara:

```text
campos existentes no objeto
vs.
campos registrados
```

Campos não registrados ainda aparecem automaticamente.

Portanto um campo novo vindo do backend nunca fica invisível.

---

# 10. Universal Record Inspector

Toda página de Entity/Curation/Collection terá:

```text
Overview
Content
Relationships
Sources / Concepts (quando aplicável)
History
All fields
```

## All fields

Essa será uma ferramenta muito importante.

Exemplo:

```text
ALL FIELDS

Search fields...
[ price                          ]

▾ categories
    Price Range
      $$$

▾ sources
    google_places
      price_level
      3

▾ Entity
    data
      priceLevel
      3
```

O editor consegue pesquisar pelo **nome do campo** ou pelo **valor**.

Isso resolve também casos de debugging editorial:

> “Eu sei que essa informação existe, mas não lembro onde ela está.”

---

# 11. Curation List — Explorer 2.0

Atualmente o Explorer retorna um row bastante pequeno:

- `curation_id`
- status
- restaurant name
- city
- entity type
- curator ID
- updated date

e os filtros são apenas:

- text
- status
- city
- entity type
- curator ID. 

Vamos preservar toda a ótima infraestrutura de seleção existente, mas transformar a tabela em um navegador editorial.

## Default columns

```text
Curation
Entity
Curator
Type
City
Concepts
Collections
State
Updated
```

Não precisamos mostrar tudo simultaneamente.

Adicionar:

### Columns

Editor escolhe quais colunas quer ver.

Exemplo:

```text
☑ Entity
☑ Curator
☑ City
☑ Concepts
☐ Curation ID
☐ Created
☐ Source count
☐ Images
☐ Audio
☐ Transcript
☐ Version
```

Salvar essas escolhas como preferência.

---

# 12. Curation Quick Preview

Clicar numa Curation não deve imediatamente destruir o contexto da lista.

Abrir drawer:

```text
RITZ RESTAURANT
Human Curation · Active

Entity
Ritz Restaurant
São Paulo · Restaurant
View Entity →

Curator
Wagner Montes

Summary
...

Concepts
Business · Casual · Friends · Burger

Sources
🎤 2 audio
🖼 5 images
📄 Transcript available

Collections
São Paulo Business
Best Burgers

Updated
Sep 11, 2026

[Open full Curation]
```

Esse componente deve ser reutilizável dentro de Collections.

---

# 13. Full Curation Editor

O editor deve reutilizar o design já aprovado para o workspace de Curation, que separa Entity factual de conhecimento editorial. 

Estrutura:

```text
CURATION HEADER

ABOUT

YOUR CURATION

CONCEPTS

MEDIA & SOURCES

COLLECTIONS

HISTORY

ALL FIELDS

ADVANCED
```

## Header

Mostrar:

- human/synthetic;
- linked/unlinked;
- status;
- curator;
- last update;
- Entity;
- version.

---

# 14. About

### Linked Curation

A Entity aparece como contexto factual.

```text
Ritz Restaurant
Restaurant · São Paulo
Av...

View Entity →
```

Não duplicar formulário da Entity.

### Unlinked Curation

`restaurant_name` continua sendo working name editável.

Essa distinção já faz parte do design de domínio aprovado. 

---

# 15. Your Curation

Campos editoriais normais:

- description/summary;
- public notes;
- private notes;
- demais campos editoriais atuais.

Modo leitura inicialmente.

```text
Public recommendation

Excellent option for...
                        Edit
```

Ao clicar Edit, transforma somente aquele bloco em formulário.

Isso melhora muito a leitura.

---

# 16. Concepts

Concepts precisam finalmente se tornar cidadãos de primeira classe no Admin.

Exemplo:

```text
CONCEPTS

Cuisine
Italian
Contemporary

Mood
Casual
Lively

Suitable For
Business
Friends

Price Range
$$$

Food Style
Sharing
```

A estrutura atual permite categories dinâmicas, portanto a UI não deve hardcodear exclusivamente as categorias atuais. 

Cada categoria deve oferecer:

- adicionar conceito;
- remover;
- alterar;
- pesquisar;
- navegar para “show all Curations with this concept”.

Exemplo:

```text
Casual  ×
```

clicar:

```text
View 312 Curations with Mood = Casual
```

---

# 17. Sources & Media

Uma área editorial específica deverá apresentar:

```text
IMAGES
[thumb] [thumb] [thumb]

AUDIO
Review 1 · 03:42
Review 2 · 01:15

TRANSCRIPT
Available

OTHER SOURCES
Google Places
Web research
Imported data
```

Para imagens:

- thumbnail;
- abrir;
- original;
- download original;
- filename;
- source;
- dimensions quando disponíveis;
- processamento;
- erros;
- remover/substituir quando suportado.

Para áudio:

- playback;
- duração;
- transcription associada;
- processing status;
- provenance.

---

# 18. Transcript

Transcript não deve ocupar a tela principal.

Mas precisa ser completamente:

- pesquisável;
- legível;
- editável;
- copiável.

Abrir em uma área própria com texto confortável.

---

# 19. All Fields da Curation

Este é o garantidor do requisito universal.

Mesmo que amanhã apareça:

```json
{
  "sources": {
    "instagram": {...}
  }
}
```

sem existir um componente “Instagram”, o usuário verá:

```text
sources
  instagram
    ...
```

e poderá editar aquilo através do editor estruturado, se o campo for mutável.

---

# 20. Entity List

Criar uma superfície dedicada:

# Entities

Colunas default:

```text
Entity
Type
City
Status
Curations
Collections
Updated
```

Filtros:

- type;
- status;
- geography;
- has Curations;
- has multiple Curations;
- has human Curation;
- has synthetic Curation;
- missing fields;
- updated date;
- metadata/source;
- qualquer campo via Advanced Search.

---

# 21. Full Entity Editor

A Entity responde:

> “O que essa coisa é?”

Estrutura:

```text
ENTITY HEADER

CANONICAL IDENTITY

LOCATION

CONTACT

MEDIA

ATTRIBUTES

CURATIONS ABOUT THIS ENTITY

COLLECTIONS THROUGH CURATIONS

METADATA

ALL FIELDS

HISTORY
```

Campos canônicos como nome, tipo, endereço, website, telefone etc. são editados aqui.

O backend já possui PATCH de Entity baseado em `EntityUpdate`. 

---

# 22. Entity → Curations

Uma Entity poderá ter N Curations.

Mostrar:

```text
CURATIONS ABOUT THIS ENTITY

Wagner Montes
Human · Active
Business · Casual · Friends
Updated yesterday

Synthetic research
Synthetic · Draft
Updated 4 days ago
```

Cada row abre preview ou Curation completa.

Isso torna a relação real do modelo visível na aplicação:

```text
Entity
  ↳ Curation A
  ↳ Curation B
  ↳ Curation C
```

---

# 23. Curation → Entity

Da mesma forma:

```text
ENTITY

Ritz Restaurant
Restaurant · São Paulo

[View Entity]
```

Se órfã:

```text
No Entity linked

Working name
Ritz

[Find and link Entity]
[Create Entity]
```

O selector deverá pesquisar Entities por nome, localidade e ID.

Nunca exigir copiar/colar um `entity_id`.

---

# 24. Collections

Collections continuam tendo o workflow operacional atual.

Mas seu conteúdo precisa ser completamente humanizado.

Hoje `MembersView` apresenta essencialmente o `curationId`. 

Isso deve virar algo como:

```text
Ritz Restaurant
Wagner Montes
Restaurant · São Paulo
Business · Casual
Active

[Preview]
[Open]
[Remove]
```

ID disponível apenas em detalhes técnicos.

---

# 25. Collection Draft Diff

Hoje o pensamento técnico é:

```text
+ curation_01HG...
- curation_20FF...
```

O pensamento editorial deverá ser:

```text
ADDED

+ Ritz Restaurant
  Wagner Montes · São Paulo
  Business · Casual

REMOVED

− D.O.M.
  Carla · São Paulo
  Fine Dining
```

IDs podem continuar disponíveis expandindo `Technical details`.

---

# 26. Relationships

Cada registro terá uma seção consistente:

# Relationships

Para Curation:

```text
Entity
Ritz Restaurant

Collections
Business São Paulo
Best Burgers

Curator
Wagner Montes
```

Para Entity:

```text
Curations
3

Collections
7 through Curations
```

Para Collection:

```text
Curations
243

Entities represented
198

Curators represented
12
```

Essas relações devem ser clicáveis.

---

# 27. Saved Views

A funcionalidade existente de Saved Views deve ser mantida e expandida.

Exemplos práticos:

```text
My recent Curations
Synthetic awaiting review
Unlinked restaurants
No Collections
Has processing errors
Missing images
São Paulo · Business
Updated this week
```

A Saved View deverá preservar:

- query;
- filters;
- sort;
- visible columns.

---

# 28. URL como estado

Filtros não podem viver apenas no React state.

Exemplo:

```text
/admin/curations
  ?status=active
  &city=Victoria
  &curator=wagner
  &concept.Mood=Casual
  &sort=-updatedAt
```

Benefícios:

- refresh não destrói pesquisa;
- back funciona;
- forward funciona;
- abrir em nova aba funciona;
- copiar link funciona;
- dashboard pode apontar para pesquisas prontas.

---

# 29. Sort

Toda lista deverá aceitar sort apropriado.

Exemplos:

- name;
- last updated;
- creation;
- curator;
- status;
- Entity;
- city.

Advanced Search + sort + configurable columns transforma a lista em ferramenta de exploração real.

---

# 30. Edição de relationships

IDs não serão text fields.

## Entity

```text
Entity
[Ritz Restaurant                       ▾]
```

Pesquisar e selecionar.

## Curator

```text
Curator
[Wagner Montes                         ▾]
```

## Collections

```text
Collections

☑ Best Business Restaurants
☑ São Paulo
☐ Date Night
```

Quando uma relação possuir comportamento especial, o Admin chama a operação correta em vez de simplesmente trocar um ID cru.

---

# 31. Editing Engine

Precisamos de componentes reutilizáveis por tipo:

```text
TextFieldEditor
LongTextEditor
NumberEditor
BooleanEditor
DateTimeEditor
EnumEditor
RelationshipEditor
ConceptEditor
ArrayEditor
ObjectEditor
JsonEditor
ReadOnlyField
```

O `ContentFieldRegistry` decide qual utilizar.

Campos desconhecidos usam inferência:

```text
string → text
number → number
boolean → checkbox
array → array editor
object → object editor
null → generic editor
```

Dessa forma o sistema continua funcionando quando surgem campos novos.

---

# 32. Save behavior

Não usar um gigantesco “Edit whole document” como única opção.

Preferir edição por seção.

Exemplo:

```text
Public recommendation

[Edit]
```

Ao editar:

```text
[Save] [Cancel]
```

Para operações que modificam múltiplos campos:

```text
Save changes
```

O backend de Curations já possui PATCH e optimistic version handling. 

O Admin deve aproveitar isso.

---

# 33. Conflitos

Caso uma Curation tenha sido alterada desde a abertura:

```text
This Curation changed while you were editing it.

Your version
...

Current version
...

[Reload]
[Review differences]
```

Nunca sobrescrever silenciosamente.

Não precisamos construir Google Docs colaborativo.

---

# 34. Raw JSON

Adicionar em Advanced:

```text
View raw record
```

e, para campos flexíveis:

```text
Edit structured data
```

O raw JSON é importante para transparência e manutenção.

Mas não deve ser o editor principal.

O editor normal deve continuar entendível por alguém que não conhece MongoDB.

---

# 35. Search dentro do registro

Além da busca global:

```text
Search this record...
```

Pesquisar simultaneamente:

- field names;
- values.

Exemplo:

```text
phone
```

mostra:

```text
Entity.data.contact.phone
+1 250...
```

Pesquisar:

```text
casual
```

mostra:

```text
Curation.categories.Mood
Casual
```

Extremamente útil em registros grandes.

---

# 36. Bulk actions

O excelente modelo atual de seleção deve permanecer.

Mas as ações deixam de ser exclusivamente Collection-centric.

Ações úteis:

```text
Add to Collection
Remove from Collection
Change status
Link Entity
Change curator
Archive
Export
```

Para Concepts ou campos arbitrários, eu não colocaria bulk editing inicialmente.

É fácil destruir dezenas de Curations.

Pode entrar depois.

---

# 37. Dashboard editorial

Dashboard atual evolui para **Content Health**.

Cards clicáveis:

```text
18,430 Curations
1,203 Unlinked
312 Synthetic drafts
84 Processing errors
2,491 Without Collections
630 Without images
125 Updated today
```

Clicar em:

```text
1,203 Unlinked
```

abre:

```text
/admin/curations?entity_id=empty
```

Não precisamos inventar um quality score mágico.

Indicadores objetivos são suficientes.

---

# 38. Estratégia de implementação

Não devemos fazer um “big bang”.

## Fase 0 — Foundation: Universal Content Access

Criar:

```text
ContentFieldRegistry
FieldInspector
FieldRenderer
FieldEditor
RecordRelationships
```

Criar a convenção universal:

```text
record
field path
label
owner
type
editable
searchable
filterable
```

### Critério de conclusão

Dado qualquer objeto de Curation ou Entity, o Admin consegue renderizar **100% dos campos existentes**, inclusive campos desconhecidos.

---

# 39. Fase 1 — Curations torna-se um CMS de verdade

Modificar o atual Explorer em vez de substituí-lo.

Criar:

```text
/admin/curations
```

Pode inicialmente manter `/admin/explorer` como redirect/compatibilidade.

Implementar:

- clickable rows;
- configurable columns;
- sort;
- URL state;
- Quick Preview;
- Full Curation page;
- relationships;
- All Fields;
- edição dos campos de Curation;
- Concepts;
- Sources;
- transcript;
- Advanced.

### Critério

Um editor consegue encontrar uma Curation, abrir, ler todos os seus campos e editar todos os campos mutáveis sem sair do Admin.

---

# 40. Fase 2 — Entities

Adicionar:

```text
/admin/entities
/admin/entities/{id}
```

Implementar:

- search;
- filters;
- list;
- preview;
- full record;
- canonical editor;
- metadata;
- flexible `data`;
- All Fields;
- Curations about Entity;
- link/unlink navigation.

### Critério

Nunca mais é necessário corrigir dados de Entity através da Curation ou diretamente no banco.

---

# 41. Fase 3 — Universal Search

Adicionar:

```text
⌘ K
```

e pesquisa agregada sobre:

- Entities;
- Curations;
- Collections.

Implementar Advanced Field Search nas listas.

### Critério

Qualquer registro pode ser encontrado por:

- nome humano;
- ID;
- conteúdo;
- relationship;
- field/value específico.

---

# 42. Fase 4 — Collections humanizadas

Reutilizar Curation Summary e Preview.

Substituir IDs em:

- Members;
- Draft Diff;
- publish preview;
- activity.

Adicionar navegação Curation ↔ Collection.

### Critério

Um editor consegue entender completamente uma Collection sem ler nenhum ID.

---

# 43. Fase 5 — Concepts como estrutura explorável

Implementar:

- concept display;
- editing;
- concept filtering;
- concept navigation;
- dynamic categories;
- “show Curations with this Concept”.

### Critério

Toda a riqueza conceitual do Concierge passa a ser acessível na descoberta de conteúdo.

---

# 44. Fase 6 — Sources e Media

Criar componentes reutilizáveis de mídia/source.

Implementar:

- gallery;
- original image;
- download;
- audio;
- transcript;
- provenance;
- status;
- processing errors.

### Critério

Nenhuma mídia ou source precisa ser inspecionada através de JSON para tarefas normais.

---

# 45. Fase 7 — Advanced data access

Finalizar:

- complete Field Inspector;
- structured arbitrary-field editing;
- record search;
- raw view;
- flexible metadata editor;
- flexible `data` editor;
- `sources`;
- `items`;
- embeddings metadata quando apropriado.

### Critério

Nenhum campo armazenado no registro fica inacessível porque a UI não o conhecia quando foi escrita.

---

# 46. Fase 8 — History

Adicionar experiência humana sobre mudanças.

Exemplo:

```text
Sep 13 · Wagner Montes

Changed Public recommendation
Added concept Mood → Casual
Added image
Linked Entity Ritz Restaurant
```

Quando snapshots/version history estiverem disponíveis:

```text
Compare version 18 ↔ 19
```

Mostrar diferenças por campo.

IDs, hashes e informação operacional permanecem em Technical details.

---

# 47. Fase 9 — Editorial Dashboard

Depois que filtros e URL state estiverem prontos, dashboard é barato.

Cada indicador é simplesmente um link para uma Saved View/query.

---

# 48. Componentes que provavelmente deverão ser criados

Dentro do Admin:

```text
components/content/
  ContentRecordHeader
  ContentQuickPreview
  ContentFieldInspector
  ContentFieldRow
  ContentFieldEditor
  RelationshipCard
  RelationshipPicker
  ColumnPicker
  SortPicker
  AdvancedFilterBuilder
  RecordSearch
```

Curations:

```text
components/curations/
  CurationsWorkspace
  CurationTable
  CurationPreviewDrawer
  CurationDetailWorkspace
  CurationOverview
  CurationConcepts
  CurationSources
  CurationCollections
```

Entities:

```text
components/entities/
  EntitiesWorkspace
  EntityTable
  EntityPreviewDrawer
  EntityDetailWorkspace
  EntityCurations
```

Search:

```text
components/search/
  GlobalSearch
  GlobalSearchResults
```

E uma camada de domínio/editor:

```text
content/
  field-registry.ts
  field-path.ts
  field-types.ts
  record-inspector.ts
```

A nomenclatura final pode seguir os padrões existentes do repo.

---

# 49. O que deve ser reutilizado

Não reconstruir:

- seleção Gmail-like do Explorer;
- Saved Views;
- operations/jobs;
- Collection publishing;
- Payload shell;
- status primitives;
- current Collection domain;
- existing Entity/Curation APIs;
- optimistic locking;
- authoring rules;
- existing Concepts pipeline.

O Explorer atual já possui uma boa infraestrutura operacional; o objetivo é acrescentar a camada editorial que falta.

---

# 50. O que não devemos construir agora

Não precisamos de:

- approval workflows;
- multi-level permissions por campo;
- editorial calendar;
- localization framework;
- assignments;
- Jira interno;
- enterprise DAM;
- content release orchestration;
- custom taxonomy designer;
- real-time collaborative editing.

Essas coisas não resolvem nosso problema.

Nosso problema é:

> encontrar → compreender → editar → relacionar conhecimento.

---

# 51. Ordem prática que eu seguiria

### Bloco A — Fundamentos

1. Field Registry.
2. Generic Field Inspector.
3. Field rendering.
4. Generic structured editor.
5. relationship primitives.

### Bloco B — Curation end-to-end

6. Rename/reframe Explorer → Curations.
7. Row navigation.
8. Curation Preview Drawer.
9. Full Curation.
10. Curation editing.
11. Concepts.
12. Sources.
13. Collections relationship.
14. All Fields.

Nesse momento o produto já muda radicalmente.

### Bloco C — Entity end-to-end

15. Entities list.
16. Entity Preview.
17. Entity detail.
18. Entity editing.
19. Entity → Curations.
20. Curation → Entity picker.
21. All Fields.

### Bloco D — Discovery

22. URL-backed filters.
23. Sorting.
24. Columns.
25. Advanced filter builder.
26. Global search.
27. Saved View upgrade.

### Bloco E — Collections

28. Hydrated Collection members.
29. Humanized diff.
30. Preview from Collection.
31. reverse Collection relationships.
32. humanized activity.

### Bloco F — Completeness

33. media UX.
34. source UX.
35. record-local search.
36. advanced JSON.
37. field/value search.
38. history/diff.
39. content-health dashboard.

---

# 52. Definition of Done

O novo Admin só deve ser considerado editorialmente completo quando os seguintes testes manuais puderem ser executados.

### “Eu conheço o restaurante”

Pesquisar:

```text
Ritz
```

Encontrar Entity, Curations e Collections relacionadas.

---

### “Eu sei uma frase que alguém escreveu”

Pesquisar:

```text
great place for a business lunch
```

Encontrar a Curation através de notes/description/transcript.

---

### “Eu sei um Concept”

Pesquisar:

```text
Mood = Casual
```

Encontrar todas as Curations correspondentes.

---

### “Eu sei um campo estranho”

Pesquisar:

```text
sources.google_places.place_id
```

e encontrar registros usando Field Search.

---

### “Quero descobrir onde existe determinado valor”

Pesquisar:

```text
ChIJ...
```

e encontrar o campo que contém aquele valor.

---

### “Quero editar um dado factual”

Curation → Entity → Edit Entity → Save.

---

### “Quero editar a opinião”

Curation → Your Curation → Edit → Save.

---

### “Quero editar um dado arbitrário”

Curation → All Fields → localizar campo → Edit.

---

### “Não sei onde o dado está”

Abrir registro → Search this record → localizar pelo nome ou valor.

---

### “Quero saber onde essa Curation é usada”

Curation → Collections.

---

### “Quero saber tudo que sabemos sobre este lugar”

Entity → Curations.

---

### “Quero entender uma Collection”

Abrir Collection e compreender todos os membros sem visualizar nenhum UUID.

---

# 53. Resultado final

Quando concluirmos, a diferença conceitual será esta:

## Hoje

```text
Admin
  → encontrar rows
  → selecionar IDs
  → executar operações
```

## Depois

```text
Admin
  → descobrir conhecimento
  → navegar pelas relações
  → abrir qualquer objeto
  → localizar qualquer campo
  → compreender seu significado
  → corrigir qualquer dado editável
  → voltar ao contexto original
```

Essa é a transformação que considero necessária.

O Admin atual já tem boa parte da **infraestrutura operacional difícil**. O trabalho daqui para frente é colocar sobre ela uma camada editorial consistente.

A peça arquitetural mais importante é a combinação:

```text
Field Registry
      +
Generic Field Inspector
      +
Friendly specialized editors
      +
Advanced field search
```

Ela resolve o conflito fundamental entre dois objetivos que parecem opostos:

> **“Quero uma interface simples para o editor.”**

e

> **“Quero acesso a absolutamente todo o modelo de dados.”**

Os campos importantes recebem uma experiência boa e humana; os campos raros, legados ou futuros continuam sempre acessíveis.

Isso evita tanto o extremo de transformar o Admin em um editor de JSON quanto o extremo de criar uma UI bonita que esconde metade dos dados.