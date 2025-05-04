/**
 * Handles API requests to OpenAI (Whisper and GPT-4)
 */
class ApiHandler {
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
            return data.text;
        } catch (error) {
            console.error('Transcription error:', error);
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
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user.replace('{texto}', text) }
            ];
            
            // Direct fetch approach without using any client library
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
                    max_tokens: 1000,
                    response_format: { type: "json_object" }
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

            // Parse and validate the JSON response
            try {
                const parsedResponse = JSON.parse(responseContent);
                return parsedResponse;
            } catch (parseError) {
                console.error('Error parsing GPT-4 response:', parseError);
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

Format your response as a JSON object with fields: "decision" (1, 2, or 3), "explanation", "chosen_concept" (if decision is 2), and "suggested_phrasing" (if decision is 3).`;

            const messages = [
                { role: "system", content: prompt.system || "You are an expert in categorizing restaurant concepts with high precision." },
                { role: "user", content: ambiguityPromptContent }
            ];
            
            // Direct fetch approach without using any client library
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
                    max_tokens: 500,
                    response_format: { type: "json_object" }
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

            // Parse and validate the JSON response
            try {
                const parsedResponse = JSON.parse(responseContent);
                return parsedResponse;
            } catch (parseError) {
                console.error('Error parsing GPT-4 response:', parseError);
                throw new Error('Invalid response format from GPT-4');
            }
        } catch (error) {
            console.error('GPT-4 API error:', error);
            throw error;
        }
    }
}

// Create a global instance
const apiHandler = new ApiHandler();
