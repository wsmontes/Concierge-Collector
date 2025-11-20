# 🗺️ Google Places API - Setup Guide

## ✅ Correções Implementadas

### 1. **Backend (places.py)**
- ✅ Removida função `get_gmaps_client()` inexistente
- ✅ Implementado endpoint `/places/details` usando `httpx` direto
- ✅ Melhorada validação de API key (detecta strings vazias)
- ✅ Usando Places API (New) com field masks otimizados

### 2. **Frontend**
- ✅ Corrigido endpoint de `/places/search` → `/places/nearby`
- ✅ Atualizado `apiService.js` com parâmetros corretos
- ✅ Atualizado `config.js` com endpoints corretos

---

## 🔧 Como Configurar no Render

### **Passo 1: Obter Google Places API Key**

1. Acesse: https://console.cloud.google.com/
2. Crie/selecione um projeto
3. Ative a API: **"Places API (New)"**
4. Vá em: **APIs & Services** → **Credentials**
5. Clique: **Create Credentials** → **API Key**
6. Copie a key gerada

#### **Opcional: Restringir a API Key (Recomendado)**
1. Clique no nome da API key
2. Em **API restrictions**, selecione:
   - ✅ Places API (New)
3. Em **Application restrictions**:
   - **HTTP referrers** (para produção): `https://wsmontes.github.io/*`
   - Ou **None** (menos seguro, mas funciona em qualquer lugar)

---

### **Passo 2: Adicionar no Render**

#### **Via Dashboard (Interface Gráfica)**
1. Acesse: https://dashboard.render.com/
2. Selecione seu serviço: **concierge-collector** (backend)
3. Clique em: **Environment** (menu lateral esquerdo)
4. Clique: **Add Environment Variable**
5. Adicione:
   ```
   Key:   GOOGLE_PLACES_API_KEY
   Value: AIzaSy... (sua-api-key-aqui)
   ```
6. Clique: **Save Changes**
7. Render vai fazer redeploy automático (aguarde 2-3 minutos)

#### **Via Render CLI (Alternativo)**
```bash
# Instalar Render CLI
npm install -g render-cli

# Login
render login

# Adicionar variável
render env:set GOOGLE_PLACES_API_KEY=AIzaSy...
```

---

### **Passo 3: Verificar se Funcionou**

#### **1. Verificar Health Check**
```bash
curl https://concierge-collector.onrender.com/api/v3/places/health
```

**Resposta Esperada:**
```json
{
  "status": "ok",
  "api_key_configured": true,
  "message": "Google Places API ready"
}
```

#### **2. Testar Nearby Search**
```bash
curl "https://concierge-collector.onrender.com/api/v3/places/nearby?latitude=-23.5505&longitude=-46.6333&radius=2000&type=restaurant&max_results=5"
```

**Resposta Esperada:**
```json
{
  "results": [
    {
      "place_id": "ChIJ...",
      "name": "Restaurant Name",
      "vicinity": "Address",
      "rating": 4.5,
      ...
    }
  ],
  "status": "OK"
}
```

---

## 📊 Endpoints Disponíveis

### **1. Nearby Search**
```
GET /api/v3/places/nearby
```

**Parâmetros:**
- `latitude` (required): Latitude do centro da busca
- `longitude` (required): Longitude do centro da busca
- `radius` (optional): Raio em metros (1-50000, default: 5000)
- `type` (optional): Tipo de lugar (restaurant, cafe, bar, etc.)
- `keyword` (optional): Busca por texto
- `max_results` (optional): Máximo de resultados (1-20, default: 20)
- `language` (optional): Código de idioma (pt-BR, en, etc.)
- `min_rating` (optional): Rating mínimo (1.0-5.0)
- `open_now` (optional): Apenas lugares abertos agora (true/false)

**Exemplos:**
```bash
# Busca básica
/places/nearby?latitude=-23.55&longitude=-46.63&radius=2000

# Com filtros
/places/nearby?latitude=-23.55&longitude=-46.63&radius=5000&type=restaurant&min_rating=4.0&open_now=true

# Busca global (sem radius)
/places/nearby?latitude=-23.55&longitude=-46.63&keyword=Osteria+Francescana
```

### **2. Place Details**
```
GET /api/v3/places/details/{place_id}
```

**Exemplo:**
```bash
/places/details/ChIJN1t_tDeuEmsRUsoyG83frY4
```

### **3. Health Check**
```
GET /api/v3/places/health
```

---

## 🐛 Troubleshooting

### **Problema: "Google Places API key not configured on server"**
**Solução:**
1. Verifique se adicionou `GOOGLE_PLACES_API_KEY` no Render
2. Verifique se não tem espaços em branco na key
3. Aguarde o redeploy completar (2-3 minutos)
4. Teste com `/places/health`

### **Problema: "HTTP 502: Google Places API error"**
**Possíveis causas:**
1. **API Key inválida**: Gere uma nova no Google Cloud
2. **API não ativada**: Ative "Places API (New)" no Google Cloud
3. **Restrições muito rígidas**: Configure HTTP referrers corretamente
4. **Cota excedida**: Verifique uso no Google Cloud Console

### **Problema: "ZERO_RESULTS"**
**Soluções:**
1. Aumente o `radius` (tente 10000 metros)
2. Remova filtros muito restritivos (`min_rating`, `open_now`)
3. Use busca por `keyword` sem `radius`
4. Verifique se coordenadas estão corretas

### **Problema: Frontend não chama a API**
**Verificações:**
1. Usuário está autenticado? (OAuth Bearer token necessário)
2. CORS configurado corretamente?
3. Frontend está usando `https://concierge-collector.onrender.com`?
4. Console do navegador mostra erros?

---

## 💰 Custos da API

### **Google Places API (New) - Pricing**

| Operação | Custo por Request | Included Free/Month |
|----------|-------------------|---------------------|
| Nearby Search (básico) | $0.032 | 200 USD = 6,250 requests |
| Text Search | $0.032 | 200 USD = 6,250 requests |
| Place Details (básico) | $0.017 | 200 USD = 11,765 requests |
| Place Details (completo) | ~$0.05 | Depende dos fields |

**Dica**: Use field masks para controlar custos! O código já usa `get_enhanced_field_mask()` para otimização.

---

## 📚 Referências

- [Google Places API (New) Docs](https://developers.google.com/maps/documentation/places/web-service/overview)
- [Field Masks Guide](https://developers.google.com/maps/documentation/places/web-service/place-details#fields)
- [Render Environment Variables](https://render.com/docs/environment-variables)

---

## ✨ Próximos Passos

Após configurar:
1. ✅ Testar no frontend em `https://wsmontes.github.io/Concierge-Collector`
2. ✅ Verificar logs no Render para debugging
3. ✅ Monitorar uso da API no Google Cloud Console
4. ✅ Considerar implementar cache para reduzir custos

---

**Última Atualização**: Novembro 20, 2025
