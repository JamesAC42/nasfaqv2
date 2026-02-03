const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

// LM Studio default endpoint
const LM_STUDIO_BASE = 'http://localhost:1234/v1';
const LM_STUDIO_CHAT_URL = `${LM_STUDIO_BASE}/chat/completions`;
const LM_STUDIO_MODELS_URL = `${LM_STUDIO_BASE}/models`;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to format messages for logging
function formatMessagesForLog(messages) {
    return messages.map((m, i) => {
        const content = m.content.length > 100 
            ? m.content.substring(0, 100) + '...' 
            : m.content;
        return `  [${i}] ${m.role}: "${content}"`;
    }).join('\n');
}

// Helper to log request details
function logRequest(endpoint, payload, isStream) {
    const timestamp = new Date().toISOString();
    console.log('\n' + '='.repeat(60));
    console.log(`📤 REQUEST [${timestamp}]`);
    console.log('='.repeat(60));
    console.log(`Endpoint: ${endpoint}`);
    console.log(`Stream: ${isStream}`);
    console.log(`Model: ${payload.model || '(using LM Studio default)'}`);
    console.log('\n📋 PARAMETERS:');
    console.log(`  temperature: ${payload.temperature}`);
    console.log(`  top_p: ${payload.top_p}`);
    console.log(`  max_tokens: ${payload.max_tokens}`);
    console.log(`  frequency_penalty: ${payload.frequency_penalty}`);
    console.log(`  presence_penalty: ${payload.presence_penalty}`);
    console.log('\n💬 MESSAGES:');
    console.log(formatMessagesForLog(payload.messages));
    console.log('-'.repeat(60));
}

// Helper to log response details
function logResponse(data, isStream) {
    const timestamp = new Date().toISOString();
    console.log('\n' + '='.repeat(60));
    console.log(`📥 RESPONSE [${timestamp}]`);
    console.log('='.repeat(60));
    
    if (data.model) {
        console.log(`Model used: ${data.model}`);
    }
    if (data.usage) {
        console.log(`Tokens - prompt: ${data.usage.prompt_tokens}, completion: ${data.usage.completion_tokens}, total: ${data.usage.total_tokens}`);
    }
    if (data.choices?.[0]?.message?.content) {
        const content = data.choices[0].message.content;
        const preview = content.length > 200 
            ? content.substring(0, 200) + '...' 
            : content;
        console.log(`Response preview: "${preview}"`);
    }
    console.log('='.repeat(60) + '\n');
}

// Get available models from LM Studio
app.get('/api/models', async (req, res) => {
    try {
        console.log(`\n🔍 Fetching available models from LM Studio...`);
        const response = await fetch(LM_STUDIO_MODELS_URL);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`✅ Found ${data.data?.length || 0} model(s):`);
        data.data?.forEach(m => console.log(`  - ${m.id}`));
        
        res.json(data);
    } catch (error) {
        console.error('❌ Error fetching models:', error.message);
        res.status(500).json({ error: `Failed to fetch models: ${error.message}` });
    }
});

// Proxy endpoint for LM Studio (non-streaming)
app.post('/api/chat', async (req, res) => {
    const { messages, model, temperature, top_p, max_tokens, frequency_penalty, presence_penalty } = req.body;

    const payload = {
        messages,
        model: model || undefined, // Let LM Studio use default if not specified
        temperature: temperature ?? 0.7,
        top_p: top_p ?? 0.9,
        max_tokens: max_tokens ?? 1024,
        frequency_penalty: frequency_penalty ?? 0,
        presence_penalty: presence_penalty ?? 0,
        stream: false
    };

    logRequest(LM_STUDIO_CHAT_URL, payload, false);

    try {
        const response = await fetch(LM_STUDIO_CHAT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ LM Studio error:', errorText);
            return res.status(response.status).json({ error: errorText });
        }

        const data = await response.json();
        logResponse(data, false);
        res.json(data);
    } catch (error) {
        console.error('❌ Error connecting to LM Studio:', error.message);
        res.status(500).json({ error: `Failed to connect to LM Studio: ${error.message}` });
    }
});

// Streaming endpoint for LM Studio
app.post('/api/chat/stream', async (req, res) => {
    const { messages, model, temperature, top_p, max_tokens, frequency_penalty, presence_penalty } = req.body;

    const payload = {
        messages,
        model: model || undefined,
        temperature: temperature ?? 0.7,
        top_p: top_p ?? 0.9,
        max_tokens: max_tokens ?? 1024,
        frequency_penalty: frequency_penalty ?? 0,
        presence_penalty: presence_penalty ?? 0,
        stream: true
    };

    logRequest(LM_STUDIO_CHAT_URL, payload, true);

    try {
        const response = await fetch(LM_STUDIO_CHAT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ LM Studio error:', errorText);
            return res.status(response.status).json({ error: errorText });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let modelUsed = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
            
            // Try to parse chunks for logging
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    try {
                        const parsed = JSON.parse(line.slice(6));
                        if (parsed.model && !modelUsed) {
                            modelUsed = parsed.model;
                        }
                        if (parsed.choices?.[0]?.delta?.content) {
                            fullResponse += parsed.choices[0].delta.content;
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            }
        }

        // Log stream completion
        console.log('\n' + '='.repeat(60));
        console.log(`📥 STREAM COMPLETE [${new Date().toISOString()}]`);
        console.log('='.repeat(60));
        if (modelUsed) console.log(`Model used: ${modelUsed}`);
        const preview = fullResponse.length > 200 
            ? fullResponse.substring(0, 200) + '...' 
            : fullResponse;
        console.log(`Response preview: "${preview}"`);
        console.log(`Total response length: ${fullResponse.length} chars`);
        console.log('='.repeat(60) + '\n');

        res.end();
    } catch (error) {
        console.error('❌ Error connecting to LM Studio:', error.message);
        res.status(500).json({ error: `Failed to connect to LM Studio: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 LM Studio Chat Server');
    console.log('='.repeat(60));
    console.log(`Server running at: http://localhost:${PORT}`);
    console.log(`LM Studio API at: ${LM_STUDIO_BASE}`);
    console.log('\nMake sure LM Studio is running with the local server enabled!');
    console.log('='.repeat(60) + '\n');
});
