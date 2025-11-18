# Michelin CSV Import Script

Script para importar dados de restaurantes do Guia Michelin a partir de arquivos CSV para o MongoDB.

## Características

✅ **Importação Completa**
- Processa todos os CSVs em `data/csv/`
- Cria documentos Entity + Metadata (michelin)
- Suporte para todos os campos disponíveis nos CSVs

✅ **Deduplicação Inteligente**
- Verifica duplicatas por nome + localização
- Fuzzy matching por entity_id gerado
- Evita inserções duplicadas

✅ **Parsing Avançado**
- Awards: 3 Stars, 2 Stars, 1 Star, Bib Gourmand, Green Star
- Coordenadas geográficas (lat/lng)
- Telefone (scientific notation handling)
- Cuisine types (múltiplas)
- Facilities & Services (lista completa)
- URLs do Guia Michelin

✅ **Modo Dry-Run**
- Teste sem escrever no banco
- Estatísticas completas
- Detecção de problemas antes da importação

## Uso

### Importação Real
```bash
cd concierge-api-v3
source venv/bin/activate
python scripts/import_michelin_csv.py
```

### Modo Teste (Dry-Run)
```bash
python scripts/import_michelin_csv.py --dry-run
```

## Formato CSV Esperado

O script espera CSVs com as seguintes colunas:

| Coluna | Descrição | Obrigatório |
|--------|-----------|-------------|
| NAME | Nome do restaurante | ✅ Sim |
| Location | Cidade, País | ✅ Sim |
| Address | Endereço completo | Não |
| Latitude | Coordenada latitude | Não |
| Longitude | Coordenada longitude | Não |
| Cuisine | Tipo(s) de cozinha | Não |
| Award | Prêmio Michelin | Não |
| REVIEW | Review do guia | Não |
| Price | Faixa de preço | Não |
| PhoneNumber | Telefone | Não |
| WebsiteUrl | Site do restaurante | Não |
| URL | URL guia Michelin | Não |
| FacilitiesAndServices | Facilidades (CSV) | Não |

## Estrutura de Dados Gerada

### Entity Document
```javascript
{
  entity_id: "rest_lasarte_barcelona",  // Gerado automaticamente
  type: "restaurant",
  name: "Lasarte",
  status: "active",
  
  metadata: [
    {
      type: "michelin",
      source: "Michelin Guide CSV Import",
      importedAt: ISODate("2025-11-18T..."),
      data: {
        award: {
          type: "stars",
          stars: 3,
          raw: "3 MICHELIN Stars"
        },
        review: "Full review text...",
        url: "https://guide.michelin.com/...",
        facilities: ["Air conditioning", "Valet parking", ...],
        import_source: "Michelin - Barcelona - 2025-10-16.csv"
      }
    }
  ],
  
  data: {
    location: {
      address: "Carrer de Mallorca 259, Barcelona",
      city: "Barcelona",
      country: "Spain",
      coordinates: {
        lat: 41.3935,
        lng: 2.1643
      }
    },
    contacts: {
      phone: "+34932451242",
      website: "https://www.lasarte.restaurant"
    },
    attributes: {
      cuisine: ["Creative"],
      price_range: "$$$$",
      michelin_award: "stars",
      michelin_stars: 3,
      facilities: ["Air conditioning", "Valet parking", ...]
    }
  },
  
  createdBy: "michelin_import_script",
  version: 1
}
```

## Resultados da Última Importação

**Data:** 2025-11-18

| Métrica | Valor |
|---------|-------|
| Total Processados | 570 |
| ✅ Criados | 466 |
| ⚠️ Duplicados | 0 |
| ⏭️ Pulados | 104 (London) |
| ❌ Erros | 0 |

### Por Prêmio
- 🌟🌟🌟 3 Stars: **18** restaurantes
- 🌟🌟 2 Stars: **39** restaurantes
- 🌟 1 Star: **200** restaurantes
- 🍴 Bib Gourmand: **209** restaurantes

### Por Cidade
| Cidade | Restaurantes |
|--------|--------------|
| Paris | 165 |
| New York | 177 |
| Los Angeles | 45 |
| Amsterdam | 36 |
| Barcelona | 32 |
| Rio de Janeiro | 11 |

## Deduplicação

O script detecta duplicatas usando:

1. **Exact Match:** Nome exato + cidade na localização
2. **Fuzzy Match:** entity_id gerado (nome_slugified + cidade_slugified)

Se duplicata encontrada:
```
⚠️ DUPLICATE: Lasarte (entity_id: rest_lasarte_barcelona)
```

## Problemas Conhecidos

### London CSV
O arquivo `Michelin - London - 2025-10-16.csv` está malformado:
- 104 linhas sem NAME ou Location
- Todas puladas automaticamente
- Requer correção manual do CSV

## Desenvolvimento

### Adicionar Novo Campo

1. Adicione parsing em `create_entity_from_csv()`
2. Inclua no documento `entity_doc`
3. Teste com `--dry-run`

### Customizar entity_id

Edite a função `generate_entity_id()`:
```python
def generate_entity_id(name: str, location: str) -> str:
    name_slug = slugify(name)
    location_slug = slugify(location.split(',')[0])
    return f"rest_{name_slug}_{location_slug}"
```

## Troubleshooting

### Import não funciona
```bash
# Verifique conexão MongoDB
python -c "from app.core.config import settings; print(settings.mongodb_url)"

# Teste dry-run
python scripts/import_michelin_csv.py --dry-run
```

### Telefones com notação científica
O script converte automaticamente:
```
5.52135E+11 → +552135...
```

### CSVs com encoding errado
O script usa `utf-8`. Se problemas:
```python
# Linha 123 em import_michelin_csv.py
with open(file_path, 'r', encoding='utf-8') as f:
# Mude para: encoding='latin-1' ou 'cp1252'
```

## Logs

Saída padrão mostra:
```
📖 Reading: Michelin - Barcelona - 2025-10-16.csv
   Found 32 restaurants
   ✅ Lasarte (stars)
   ✅ ABaC (stars)
   ...
   
📊 IMPORT STATISTICS
Total restaurants processed: 570
✅ Created: 466
```

## Próximos Passos

- [ ] Corrigir London CSV
- [ ] Adicionar importação de imagens
- [ ] Integração com Google Places API (enriquecer dados)
- [ ] Update de restaurantes existentes (não só insert)
- [ ] Suporte para outras fontes (Zagat, World's 50 Best)

## Contribuindo

Para adicionar novos CSVs:

1. Coloque em `data/csv/`
2. Garanta colunas NAME e Location
3. Execute `--dry-run` para validar
4. Execute importação real

## Licença

Parte do projeto Concierge Collector.
