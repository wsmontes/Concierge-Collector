# MCP Setup para Claude Desktop - Concierge Restaurant

## ✅ Configuração Completa

### Arquivos Criados:

1. **`mcp-server.py`** - Servidor MCP em Python que faz ponte com a API REST
2. **Claude Desktop Config** - `~/Library/Application Support/Claude/claude_desktop_config.json`

### Configuração Atual:

```json
{
  "mcpServers": {
    "concierge-restaurant": {
      "command": "/Users/wagnermontes/Documents/GitHub/Concierge-Collector/.venv/bin/python3",
      "args": [
        "/Users/wagnermontes/Documents/GitHub/Concierge-Collector/mcp-server.py"
      ]
    }
  }
}
```

### Dependências Instaladas:

- ✅ `mcp` - MCP Python SDK
- ✅ `httpx` - HTTP client assíncrono

---

## 🚀 Como Usar:

### 1. Reinicie Claude Desktop

```bash
# Fechar completamente
killall Claude

# Ou use Cmd+Q no Claude Desktop
```

### 2. Abra Claude Desktop novamente

O servidor MCP deve iniciar automaticamente.

### 3. Verifique se os tools foram carregados

Pergunte no Claude:
```
What tools do you have available?
```

Você deve ver **3 tools**:
- `search_restaurants`
- `get_restaurant_snapshot`
- `get_restaurant_availability`

### 4. Teste com perguntas reais

```
Tell me about the D.O.M restaurant in São Paulo
```

```
Find restaurants near Avenida Paulista
```

```
Is Maní open on weekends?
```

---

## 🔧 Troubleshooting:

### Server Failed ou Disconnected

1. **Verifique logs do Claude:**
   - Settings → Developer → View Logs

2. **Teste o servidor manualmente:**
   ```bash
   /Users/wagnermontes/Documents/GitHub/Concierge-Collector/.venv/bin/python3 \
     /Users/wagnermontes/Documents/GitHub/Concierge-Collector/mcp-server.py
   ```

3. **Verifique se a API está respondendo:**
   ```bash
   curl https://concierge-collector.onrender.com/api/v3/llm/health
   ```

### Tools não aparecem

1. Verifique se o caminho do venv está correto:
   ```bash
   ls -la /Users/wagnermontes/Documents/GitHub/Concierge-Collector/.venv/bin/python3
   ```

2. Verifique se as dependências estão instaladas:
   ```bash
   /Users/wagnermontes/Documents/GitHub/Concierge-Collector/.venv/bin/python3 -c "import mcp; import httpx; print('✅ OK')"
   ```

3. Reinicie o Mac (às vezes resolve problemas de cache)

---

## 📝 Arquitetura:

```
Claude Desktop
    ↓ (MCP Protocol via stdio)
mcp-server.py
    ↓ (HTTP REST)
https://concierge-collector.onrender.com/api/v3/llm
    ↓
Google Places API + MongoDB + Curations
```

---

## 🎯 Tools Disponíveis:

### 1. search_restaurants
- **Input**: `query`, `latitude` (opcional), `longitude` (opcional)
- **Output**: Lista de restaurantes com `place_id` e `entity_id`
- **Uso**: Encontrar restaurantes por nome

### 2. get_restaurant_snapshot
- **Input**: `place_id` OU `entity_id`
- **Output**: Dados completos (horários, rating, contato, Michelin, curadoria)
- **Uso**: Informações detalhadas sobre um restaurante

### 3. get_restaurant_availability
- **Input**: `place_id` OU `entity_id`
- **Output**: Horários de funcionamento e disponibilidade
- **Uso**: Checar se está aberto agora ou em fins de semana

---

## ✨ Status:

- ✅ MCP Server criado
- ✅ Dependências instaladas
- ✅ Claude config atualizado
- ✅ Pronto para usar

**Próximo passo**: Reinicie o Claude Desktop e teste!
