// DOM Elements
const messagesContainer = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-chat');
const statusEl = document.getElementById('status');

// Settings Elements
const modelSelectEl = document.getElementById('model-select');
const refreshModelsBtn = document.getElementById('refresh-models');
const systemPromptEl = document.getElementById('system-prompt');
const temperatureEl = document.getElementById('temperature');
const topPEl = document.getElementById('top-p');
const maxTokensEl = document.getElementById('max-tokens');
const frequencyPenaltyEl = document.getElementById('frequency-penalty');
const presencePenaltyEl = document.getElementById('presence-penalty');
const streamModeEl = document.getElementById('stream-mode');

// Value display elements
const tempValueEl = document.getElementById('temp-value');
const topPValueEl = document.getElementById('top-p-value');
const maxTokensValueEl = document.getElementById('max-tokens-value');
const freqPenaltyValueEl = document.getElementById('freq-penalty-value');
const presPenaltyValueEl = document.getElementById('pres-penalty-value');

// Conversation history
let conversationHistory = [];

// Fetch available models from LM Studio
async function fetchModels() {
    refreshModelsBtn.classList.add('loading');
    modelSelectEl.disabled = true;
    
    try {
        const response = await fetch('/api/models');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const models = data.data || [];
        
        modelSelectEl.innerHTML = '';
        
        if (models.length === 0) {
            modelSelectEl.innerHTML = '<option value="">No models loaded</option>';
        } else {
            // Add default option
            modelSelectEl.innerHTML = '<option value="">(LM Studio default)</option>';
            
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.id;
                modelSelectEl.appendChild(option);
            });
            
            // Restore saved model selection
            const saved = localStorage.getItem('lm-studio-chat-settings');
            if (saved) {
                try {
                    const settings = JSON.parse(saved);
                    if (settings.model) {
                        modelSelectEl.value = settings.model;
                    }
                } catch (e) {}
            }
        }
        
        console.log(`✅ Loaded ${models.length} model(s)`);
        
    } catch (error) {
        console.error('Failed to fetch models:', error);
        modelSelectEl.innerHTML = '<option value="">Error loading models</option>';
    }
    
    refreshModelsBtn.classList.remove('loading');
    modelSelectEl.disabled = false;
}

// Refresh models button
refreshModelsBtn.addEventListener('click', fetchModels);

// Update slider value displays
temperatureEl.addEventListener('input', () => {
    tempValueEl.textContent = temperatureEl.value;
});

topPEl.addEventListener('input', () => {
    topPValueEl.textContent = topPEl.value;
});

maxTokensEl.addEventListener('input', () => {
    maxTokensValueEl.textContent = maxTokensEl.value;
});

frequencyPenaltyEl.addEventListener('input', () => {
    freqPenaltyValueEl.textContent = frequencyPenaltyEl.value;
});

presencePenaltyEl.addEventListener('input', () => {
    presPenaltyValueEl.textContent = presencePenaltyEl.value;
});

// Auto-resize textarea
userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 192) + 'px';
});

// Handle Enter key (Shift+Enter for new line)
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
    }
});

// Clear chat
clearBtn.addEventListener('click', () => {
    conversationHistory = [];
    messagesContainer.innerHTML = `
        <div class="welcome-message">
            <p>👋 Start a conversation with your local LLM</p>
            <p class="hint">Make sure LM Studio is running with the local server enabled</p>
        </div>
    `;
});

// Add message to UI
function addMessage(role, content) {
    // Remove welcome message if present
    const welcomeMsg = messagesContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const roleLabel = document.createElement('div');
    roleLabel.className = 'message-role';
    roleLabel.textContent = role;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = content;
    
    messageDiv.appendChild(roleLabel);
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    return contentDiv;
}

// Set status
function setStatus(text, type = '') {
    statusEl.textContent = text;
    statusEl.className = `status ${type}`;
}

// Get current settings
function getSettings() {
    return {
        model: modelSelectEl.value || undefined,
        temperature: parseFloat(temperatureEl.value),
        top_p: parseFloat(topPEl.value),
        max_tokens: parseInt(maxTokensEl.value),
        frequency_penalty: parseFloat(frequencyPenaltyEl.value),
        presence_penalty: parseFloat(presencePenaltyEl.value)
    };
}

// Build messages array with system prompt
function buildMessages() {
    const messages = [];
    
    const systemPrompt = systemPromptEl.value.trim();
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.push(...conversationHistory);
    
    return messages;
}

// Send message
async function sendMessage(userMessage) {
    // Add user message to history and UI
    conversationHistory.push({ role: 'user', content: userMessage });
    addMessage('user', userMessage);
    
    // Disable input
    userInput.disabled = true;
    sendBtn.disabled = true;
    setStatus('Generating...', 'loading');
    
    const settings = getSettings();
    const messages = buildMessages();
    const useStream = streamModeEl.checked;
    
    // Log to browser console for debugging
    console.log('📤 Sending request:', {
        model: settings.model || '(LM Studio default)',
        messages: messages,
        settings: {
            temperature: settings.temperature,
            top_p: settings.top_p,
            max_tokens: settings.max_tokens,
            frequency_penalty: settings.frequency_penalty,
            presence_penalty: settings.presence_penalty
        },
        stream: useStream
    });
    
    try {
        if (useStream) {
            // Streaming mode
            const response = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages, ...settings })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }
            
            const contentDiv = addMessage('assistant', '');
            let fullContent = '';
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(data);
                            const delta = parsed.choices?.[0]?.delta?.content;
                            if (delta) {
                                fullContent += delta;
                                contentDiv.textContent = fullContent;
                                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }
            
            // Add to history
            conversationHistory.push({ role: 'assistant', content: fullContent });
            console.log('📥 Response received (stream):', fullContent.substring(0, 200) + (fullContent.length > 200 ? '...' : ''));
            
        } else {
            // Non-streaming mode
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages, ...settings })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }
            
            const data = await response.json();
            console.log('📥 Full API response:', data);
            
            const assistantMessage = data.choices?.[0]?.message?.content || 'No response';
            
            conversationHistory.push({ role: 'assistant', content: assistantMessage });
            addMessage('assistant', assistantMessage);
        }
        
        setStatus('Ready');
        
    } catch (error) {
        console.error('Error:', error);
        setStatus('Error', 'error');
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message error';
        errorDiv.textContent = `Error: ${error.message}`;
        messagesContainer.appendChild(errorDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Remove failed message from history
        conversationHistory.pop();
    }
    
    // Re-enable input
    userInput.disabled = false;
    sendBtn.disabled = false;
    userInput.focus();
}

// Form submit handler
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const message = userInput.value.trim();
    if (!message) return;
    
    userInput.value = '';
    userInput.style.height = 'auto';
    
    sendMessage(message);
});

// Load saved settings from localStorage
function loadSettings() {
    const saved = localStorage.getItem('lm-studio-chat-settings');
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            systemPromptEl.value = settings.systemPrompt || systemPromptEl.value;
            temperatureEl.value = settings.temperature ?? temperatureEl.value;
            topPEl.value = settings.topP ?? topPEl.value;
            maxTokensEl.value = settings.maxTokens ?? maxTokensEl.value;
            frequencyPenaltyEl.value = settings.frequencyPenalty ?? frequencyPenaltyEl.value;
            presencePenaltyEl.value = settings.presencePenalty ?? presencePenaltyEl.value;
            streamModeEl.checked = settings.streamMode ?? streamModeEl.checked;
            
            // Update displays
            tempValueEl.textContent = temperatureEl.value;
            topPValueEl.textContent = topPEl.value;
            maxTokensValueEl.textContent = maxTokensEl.value;
            freqPenaltyValueEl.textContent = frequencyPenaltyEl.value;
            presPenaltyValueEl.textContent = presencePenaltyEl.value;
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }
}

// Save settings to localStorage
function saveSettings() {
    const settings = {
        model: modelSelectEl.value,
        systemPrompt: systemPromptEl.value,
        temperature: temperatureEl.value,
        topP: topPEl.value,
        maxTokens: maxTokensEl.value,
        frequencyPenalty: frequencyPenaltyEl.value,
        presencePenalty: presencePenaltyEl.value,
        streamMode: streamModeEl.checked
    };
    localStorage.setItem('lm-studio-chat-settings', JSON.stringify(settings));
}

// Auto-save settings on change
[modelSelectEl, systemPromptEl, temperatureEl, topPEl, maxTokensEl, frequencyPenaltyEl, presencePenaltyEl, streamModeEl]
    .forEach(el => el.addEventListener('change', saveSettings));

// Initialize
loadSettings();
fetchModels();
