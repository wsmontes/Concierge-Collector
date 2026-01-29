/**
 * Prompt templates for GPT-4 interactions
 * These templates define how the AI should process restaurant information,
 * always responding in English regardless of input language,
 * while preserving local terms, restaurant names, and culturally specific concepts in their native language.
 */

// Only define if not already defined
if (!window.promptTemplates) {
    window.promptTemplates = {
        // Main prompt for restaurant concept extraction
        conceptExtraction: {
            system: "You are an assistant specialized in categorizing restaurant curations with extreme precision. Your task is to extract detailed and structured information from the provided text, organizing it within the specific requested categories. Always respond in English regardless of the input language, but preserve original names of restaurants, dishes, local culinary terms, and culturally specific concepts in their native language.",
            
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

Format your response as a JSON object with the above categories as keys and arrays of values found in the text. If there is no information about a category, return an empty array. Be extremely precise and consider different context. Your analysis must be in English regardless of the input language, but keep original names and local terms in native language.`
        },
        
        // Prompt for disambiguation of similar concepts
        disambiguation: {
            system: "You are an expert in semantic analysis and restaurant categorization, capable of identifying subtle differences between similar concepts. Always provide your analysis in English regardless of the input language, but preserve restaurant names, dish names, and culturally specific terms in their original language.",
            
            user: `I need to determine if a new restaurant concept is truly unique or corresponds to an existing concept.

New concept: "{newConcept}" (Category: {newCategory})

Similar existing concepts:
{similarConcepts}

I should:
1. Add as a new concept because it is truly unique
2. Use a similar existing concept (specify which one)
3. Merge into a better formulation (suggest the best wording)

Answer as a JSON object with the fields: "decision" (1, 2, or 3), "explanation", "chosen_concept" (if decision is 2), and "suggested_phrasing" (if decision is 3). Your response must be in English regardless of the input language, but maintain any restaurant-specific or culturally specific terms in their original language.`
        },
        
        // Prompt for generating short restaurant descriptions
        restaurantDescription: {
            system: "You are a concise restaurant critic able to create compelling short descriptions. Always write your descriptions in English regardless of the input language, but maintain restaurant names, signature dish names, and culturally specific terms in their original language.",
            
            user: `Create a brief, engaging description of this restaurant based on the following transcription. 
The description must be 30 words or fewer and highlight the most distinctive aspects of the restaurant.

Transcription:
{texto}

Output just the description with no additional text, explanations, or quotation marks. The description must be in English regardless of the input language but preserve the restaurant name and any signature dishes or local terms in their original language.`
        },
        
        // New prompt for restaurant name extraction
        restaurantNameExtraction: {
            system: "You are an assistant specialized in identifying restaurant names from review texts. Always respond in English regardless of the input language.",
            
            user: `Extract the restaurant name from the following text. If multiple restaurant names are mentioned, identify the main one being reviewed. If no restaurant name is clearly mentioned, respond with "Unknown".

Text: {texto}

Provide only the restaurant name without any additional text or explanation. Keep the restaurant name in its original language.`
        },
        
        // Updated prompt for extracting restaurant name from images
        imageRestaurantNameExtraction: {
            system: "You are a restaurant name detector. Your only task is to identify the name of a restaurant from images. Always respond in English regardless of the language in the image. If you can identify a restaurant name in the image, respond ONLY with that name in its original language, nothing else. If you cannot identify a restaurant name with reasonable confidence, respond with 'UNKNOWN'.",
            user: "What is the name of this restaurant? Respond only with the name, with no additional explanations. Keep the restaurant name in its original language. If you cannot determine the name with reasonable confidence, respond with 'UNKNOWN'."
        },
        
        // New prompt for extracting concepts from restaurant images
        imageConceptExtraction: {
            system: "You are a restaurant concept analyzer. Always respond in English regardless of the language in the image. For menu items, list each distinct food or drink as a separate object. Don't combine multiple menu items with commas. For example, use [{\"category\": \"Menu\", \"value\": \"Fruit Salad\"}, {\"category\": \"Menu\", \"value\": \"Cocktails\"}] instead of [{\"category\": \"Menu\", \"value\": \"Fruit Salad, Cocktails\"}].",
            user: "Extract restaurant concepts from this image. Return a JSON array with objects containing 'category' and 'value'. Valid categories are: 'Cuisine', 'Menu', 'Price Range', 'Mood', 'Setting', 'Crowd', 'Suitable For', 'Food Style', 'Drinks', 'Special Features'. For menu items, create a separate object for each distinct item. Example: [{\"category\": \"Cuisine\", \"value\": \"Italian\"}, {\"category\": \"Menu\", \"value\": \"Pizza\"}]. Only return valid JSON with no additional text. Your analysis must be in English regardless of the language in the image, but keep dish names and restaurant-specific terms in their original language."
        }
    };

    console.log("Prompt templates initialized");
}
