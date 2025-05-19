/**
 * Handles API requests to OpenAI (Whisper and GPT-4).
 * Ensures all concepts, transcripts, and descriptions are generated in English,
 * except for untranslatable local food names and expressions, which are preserved in their original form.
 * 
 * Dependencies:
 * - ModuleWrapper (for class definition and instance management)
 * - localStorage (for API key persistence)
 * - fetch API (for HTTP requests)
 */

const ApiHandler = ModuleWrapper.defineClass('ApiHandler', class {
    constructor() {
        this.apiKey = localStorage.getItem('openai_api_key') || null;
    }

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('openai_api_key', key);
    }

    async transcribeAudio(audioBlob) {
        if (!this.apiKey) {
            throw new Error('OpenAI API key not set');
        }

        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.mp3');
        formData.append('model', 'whisper-1');
        formData.append('language', 'pt');

        try {
            const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Whisper API error: ${error.error?.message || 'Unknown error'}`);
            }

            const data = await response.json();
            // Always translate the transcript to English, preserving untranslatable local terms
            const transcript = data.text;
            const translatedTranscript = await this.translateText(
                transcript,
                'English',
                true // preserve local terms
            );
            return translatedTranscript;
        } catch (error) {
            console.error('Transcription error:', error);
            throw error;
        }
    }

    async translateText(text, targetLanguage = 'English', preserveLocalTerms = false) {
        if (!this.apiKey) {
            throw new Error('OpenAI API key not set');
        }

        try {
            // Create parameters for the API call
            const messages = [
                { 
                    role: "system", 
                    content: `You are a translator. Translate the following text to ${targetLanguage}. Maintain restaurant names, local food names, and specific culinary terms or local expressions in their original form if their meaning cannot be fully translated. Focus only on accurate translation.`
                },
                { 
                    role: "user", 
                    content: text
                }
            ];
            
            console.log(`Translating text to ${targetLanguage}...`);
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: "gpt-4",
                    messages: messages,
                    temperature: 0.3,
                    max_tokens: 1500
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Translation API error: ${errorData.error?.message || 'Unknown error'}`);
            }

            const data = await response.json();
            const translatedContent = data.choices[0]?.message?.content;
            
            if (!translatedContent) {
                throw new Error('Empty response from translation API');
            }

            return translatedContent;
        } catch (error) {
            console.error('Translation API error:', error);
            throw error;
        }
    }

    async extractConcepts(text, prompt) {
        if (!this.apiKey) {
            throw new Error('OpenAI API key not set');
        }

        try {
            // Create parameters for the API call
            const messages = [
                { 
                    role: "system", 
                    content: `${prompt.system} Always format your response as valid JSON. All concepts, descriptions, and outputs must be in English, except for local food names and local expressions that cannot be fully translated. Preserve those in their original form.`
                },
                { 
                    role: "user", 
                    content: prompt.user.replace('{texto}', text)
                }
            ];
            
            console.log('Making API request to OpenAI...');
            
            // Direct fetch approach without using response_format parameter
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: "gpt-4",
                    messages: messages,
                    temperature: 0.2,
                    max_tokens: 1000
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`GPT-4 API error: ${errorData.error?.message || 'Unknown error'}`);
            }

            const data = await response.json();
            const responseContent = data.choices[0]?.message?.content;
            
            if (!responseContent) {
                throw new Error('Empty response from GPT-4');
            }

            // Find JSON in the response - the model might include some text outside the JSON
            let jsonContent = responseContent;
            const jsonStartIndex = responseContent.indexOf('{');
            const jsonEndIndex = responseContent.lastIndexOf('}');
            
            if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
                jsonContent = responseContent.substring(jsonStartIndex, jsonEndIndex + 1);
            }

            // Parse and validate the JSON response
            try {
                const parsedResponse = JSON.parse(jsonContent);
                console.log('Successfully parsed GPT-4 response:', parsedResponse);
                return parsedResponse;
            } catch (parseError) {
                console.error('Error parsing GPT-4 response:', parseError);
                console.error('Raw response was:', responseContent);
                throw new Error('Invalid response format from GPT-4');
            }
        } catch (error) {
            console.error('GPT-4 API error:', error);
            throw error;
        }
    }

    async resolveConceptAmbiguity(concept, similarConcepts, prompt) {
        if (!this.apiKey) {
            throw new Error('OpenAI API key not set');
        }

        try {
            // Format the ambiguity prompt
            const ambiguityPromptContent = `I need to decide if a new restaurant concept is truly unique or if it matches an existing one.

New concept: "${concept.value}" (Category: ${concept.category})

Existing similar concepts:
${similarConcepts.map(c => `- "${c.value}" (Category: ${c.category}, Similarity: ${c.similarity.toFixed(2)})`).join('\n')}

Should I:
1. Add as a new concept because it's truly unique
2. Use the most similar existing concept (specify which one)
3. Merge into a better phrasing (suggest the best wording)

All reasoning, decisions, and suggested phrasings must be in English, except for local food names and local expressions that cannot be fully translated. Preserve those in their original form.

Format your response as a JSON object with fields: "decision" (1, 2, or 3), "explanation", "chosen_concept" (if decision is 2), and "suggested_phrasing" (if decision is 3).`;

            const messages = [
                { 
                    role: "system", 
                    content: (prompt.system || "You are an expert in categorizing restaurant concepts with high precision.") + 
                             " Always format your response as valid JSON. All outputs must be in English, except for local food names and local expressions that cannot be fully translated. Preserve those in their original form."
                },
                { role: "user", content: ambiguityPromptContent }
            ];
            
            // Direct fetch approach without using response_format parameter
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: "gpt-4",
                    messages: messages,
                    temperature: 0.2,
                    max_tokens: 500
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`GPT-4 API error: ${errorData.error?.message || 'Unknown error'}`);
            }

            const data = await response.json();
            const responseContent = data.choices[0]?.message?.content;
            
            if (!responseContent) {
                throw new Error('Empty response from GPT-4');
            }

            // Find JSON in the response - the model might include some text outside the JSON
            let jsonContent = responseContent;
            const jsonStartIndex = responseContent.indexOf('{');
            const jsonEndIndex = responseContent.lastIndexOf('}');
            
            if (jsonStartIndex >= 0 && jsonEndIndex > jsonStartIndex) {
                jsonContent = responseContent.substring(jsonStartIndex, jsonEndIndex + 1);
            }

            // Parse and validate the JSON response
            try {
                const parsedResponse = JSON.parse(jsonContent);
                return parsedResponse;
            } catch (parseError) {
                console.error('Error parsing GPT-4 response:', parseError);
                console.error('Raw response was:', responseContent);
                throw new Error('Invalid response format from GPT-4');
            }
        } catch (error) {
            console.error('GPT-4 API error:', error);
            throw error;
        }
    }
});

// Create a global instance only once
window.apiHandler = ModuleWrapper.createInstance('apiHandler', 'ApiHandler');
