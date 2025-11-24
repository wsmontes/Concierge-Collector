# Restaurant Concepts Import Tool

Script interativo para importar conceitos de restaurantes do JSON para o MongoDB.

## Funcionalidades

✅ **Busca Inteligente**: Procura em MongoDB e Google Places simultaneamente  
✅ **Preview Interativo**: Mostra conceitos e candidatos antes de aprovar  
✅ **Múltiplas Opções**: Entidades existentes, novos places, ou entrada manual  
✅ **Controle Total**: Aprova um por um, skip, ou quit a qualquer momento  
✅ **Rastreabilidade**: Adiciona metadata de importação (fonte, data)  
✅ **Estatísticas**: Resumo final de updated/created/skipped/failed  

## Pré-requisitos

```bash
cd concierge-api-v3
pip install pymongo requests python-dotenv
```

## Uso

```bash
cd scripts
python3 import_concepts.py
```

## Fluxo Interativo

Para cada restaurante no JSON:

1. **Mostra Conceitos**:
   ```
   Restaurant: A CASA DO PORCO
   =====================================================
   Concepts:
     cuisine: brazilian, contemporary, fusion
     menu: pork, vegetables, salads (+10 more)
     food_style: creative, modern, organic
   ```

2. **Lista Candidatos**:
   ```
   [1] MongoDB Entity
     Entity ID: ent_12345
     Name: A Casa do Porco Bar
     Place ID: ChIJxxx
     ⚠️  Already has concepts
   
   [2] Google Places
     Place ID: ChIJyyy
     Name: Casa do Porco
     Rating: 4.7 ⭐ (1523 reviews)
   ```

3. **Escolha**:
   - `[1-N]` - Seleciona candidato
   - `[m]` - Entrada manual de place_id
   - `[s]` - Skip este restaurante
   - `[q]` - Quit (sai do script)

## Formato dos Conceitos no MongoDB

```json
{
  "_id": "ent_12345",
  "name": "A Casa do Porco Bar",
  "type": "restaurant",
  "data": {
    "place_id": "ChIJxxx",
    "name": "A Casa do Porco Bar",
    ...
  },
  "concepts": {
    "cuisine": ["brazilian", "contemporary", "fusion"],
    "menu": ["pork", "vegetables", "salads", ...],
    "food_style": ["creative", "modern", "organic"],
    "drinks": ["craft beers", "cocktails", "wine list"],
    "setting": ["industrial", "open kitchen", "communal tables"],
    "mood": ["trendy", "lively", "casual"],
    "crowd": ["young", "foodies", "locals"],
    "suitable_for": ["groups", "dates", "business lunches"],
    "special_features": ["celebrity chef", "reservations recommended"],
    "_metadata": {
      "source": "import_concepts.py",
      "imported_at": "2025-11-23T10:30:00",
      "original_file": "restaurants - 2025-10-15.json"
    }
  }
}
```

## Estratégias de Match

### 1. MongoDB Search
- Busca por nome exato (case insensitive)
- Busca em `name` e `data.name`
- Fallback para partial match com regex

### 2. Google Places Search
- Query: `"{restaurant_name} São Paulo restaurant"`
- Retorna até 5 resultados
- Mostra rating e número de reviews
- Permite criar entidade nova

### 3. Entrada Manual
- Para casos especiais ou quando busca falha
- Requer place_id válido
- Cria entidade automaticamente

## Casos Especiais

### Restaurante Já Tem Conceitos
- Script mostra aviso: `⚠️  Already has concepts`
- Permite sobrescrever (substitui completamente)
- Metadata rastreia última importação

### Múltiplas Unidades
- Exemplo: "fogo de chão - jardins", "fogo de chão - moema"
- Script mostra todas unidades encontradas
- Escolha a correta pelo endereço

### Nome Não Encontrado
- Use opção `[m]` para entrada manual
- Busque place_id no Google Maps
- Script cria entidade automaticamente

## Estatísticas Finais

```
Import Summary
=====================================================
Total restaurants: 70
Updated: 45
Created: 15
Skipped: 8
Failed: 2
```

## Troubleshooting

### Erro: MongoDB connection failed
```bash
# Verifique .env
cat concierge-api-v3/.env | grep MONGODB_URL
```

### Erro: Google Places API key invalid
```bash
# Verifique .env
cat concierge-api-v3/.env | grep GOOGLE_PLACES_API_KEY
```

### Restaurante não encontrado
1. Tente entrada manual `[m]`
2. Busque no Google Maps
3. Copie place_id da URL: `...place/ChIJxxx...`

## Notas

- Script preserva conceitos existentes com metadata
- Não faz updates incrementais - substitui completamente
- Recomendado fazer backup do MongoDB antes de importar
- Use `[s]` skip liberalmente - melhor revisar depois que errar

## Exemplo de Sessão

```
Restaurant: MANI
=====================================================
Concepts:
  cuisine: brazilian, contemporary
  menu: seasonal, vegetables, fish (+8 more)
  
Searching MongoDB...
Searching Google Places...

[1] MongoDB Entity
  Name: Mani
  Place ID: ChIJ5xF4HLNZzpQRJ2OMf_Om2aY
  Address: Rua Joaquim Antunes, 210 - Jardim Paulistano

[2] Google Places
  Name: MANI
  Rating: 4.6 ⭐ (892 reviews)

Options:
  [1-2] Select candidate
  [m] Manual place_id
  [s] Skip
  [q] Quit

Your choice: 1
Updating entity ent_xxx...
✓ Updated entity
```
