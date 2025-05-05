/**
 * Prompt templates for GPT-4 interactions
 */
const promptTemplates = {
    // Main prompt for restaurant concept extraction
    conceptExtraction: {
        system: "You are an assistant specialized in categorizing restaurant curations with extreme precision. Your task is to extract detailed and structured information from the provided text, organizing it within the specific requested categories.",
        
        user: `Analyze the following text about a restaurant and extract all relevant characteristics and concepts, organized by the categories below:

{texto}

Categories for classification:
- Cuisine: types of cuisine/gastronomy (e.g.: Italian, Japanese, fusion)
- Menu: specific dishes or ingredients mentioned
- Price Range: price range (e.g.: inexpensive, moderate, expensive)
- Mood: atmosphere/vibe of the place (e.g.: romantic, casual, lively)
- Setting: physical environment (e.g.: rustic, modern, outdoor)
- Crowd: predominant type of audience (e.g.: family, executives, tourists)
- Suitable For: suitable for which occasions (e.g.: dates, business meetings)
- Food Style: food style (e.g.: comfort food, gourmet, street food)
- Drinks: featured beverages (e.g.: wine list, signature cocktails)

Format your response as a JSON object with the above categories as keys and arrays of values found in the text. If there is no information about a category, return an empty array. Be extremely precise and consider the Brazilian/Portuguese context.`
    },
    
    // Prompt for disambiguation of similar concepts
    disambiguation: {
        system: "You are an expert in semantic analysis and restaurant categorization, capable of identifying subtle differences between similar concepts.",
        
        user: `I need to determine if a new restaurant concept is truly unique or corresponds to an existing concept.

New concept: "{newConcept}" (Category: {newCategory})

Similar existing concepts:
{similarConcepts}

I should:
1. Add as a new concept because it is truly unique
2. Use a similar existing concept (specify which one)
3. Merge into a better formulation (suggest the best wording)

Answer as a JSON object with the fields: "decision" (1, 2, or 3), "explanation", "chosen_concept" (if decision is 2), and "suggested_phrasing" (if decision is 3).`
    }
};
