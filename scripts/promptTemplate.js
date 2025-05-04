/**
 * Prompt templates for GPT-4 interactions
 */
const promptTemplates = {
    // Main prompt for restaurant concept extraction
    conceptExtraction: {
        system: "Você é um assistente especializado em categorizar curadorias de restaurantes com extrema precisão. Sua tarefa é extrair informações detalhadas e estruturadas do texto fornecido, organizando-as dentro das categorias específicas solicitadas.",
        
        user: `Analise o texto a seguir sobre um restaurante e extraia todas as características e conceitos relevantes, organizados pelas categorias abaixo:

{texto}

Categorias para classificação:
- Cuisine: tipos de culinária/gastronomia (ex: italiana, japonesa, fusion)
- Menu: pratos ou ingredientes específicos mencionados
- Price Range: faixa de preço (ex: barato, moderado, caro)
- Mood: atmosfera/clima do lugar (ex: romântico, casual, animado)
- Setting: ambiente físico (ex: rústico, moderno, ao ar livre)
- Crowd: tipo de público predominante (ex: família, executivos, turistas)
- Suitable For: adequado para quais ocasiões (ex: encontros, reuniões de negócios)
- Food Style: estilo da comida (ex: comfort food, gourmet, street food)
- Drinks: bebidas de destaque (ex: carta de vinhos, coquetéis autorais)

Formate sua resposta como um objeto JSON com as categorias acima como chaves e arrays de valores encontrados no texto. Se não houver informações sobre uma categoria, retorne um array vazio. Seja extremamente preciso e considere o contexto brasileiro/português.`
    },
    
    // Prompt for disambiguation of similar concepts
    disambiguation: {
        system: "Você é um especialista em análise semântica e categorização de restaurantes, capaz de identificar diferenças sutis entre conceitos similares.",
        
        user: `Preciso determinar se um novo conceito de restaurante é realmente único ou se corresponde a um conceito existente.

Conceito novo: "{newConcept}" (Categoria: {newCategory})

Conceitos similares existentes:
{similarConcepts}

Eu devo:
1. Adicionar como um novo conceito porque é realmente único
2. Usar um conceito existente similar (especifique qual)
3. Mesclar em uma melhor formulação (sugira a melhor redação)

Responda como objeto JSON com os campos: "decision" (1, 2, ou 3), "explanation", "chosen_concept" (se decision for 2), e "suggested_phrasing" (se decision for 3).`
    }
};
