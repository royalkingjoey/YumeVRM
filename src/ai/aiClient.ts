import type { AiProvider } from '../storage/settings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * The provider plus its connection config — everything needed to send a chat
 * request. Structurally a subset of {@link AiSettings}, so the saved settings
 * can be passed directly.
 */
export interface AiConnection {
  provider: AiProvider;
  ollama: { baseUrl: string; model: string };
  openrouter: { apiKey: string; model: string };
}

/** Returns the model id for the connection's active provider. */
export function activeModel(connection: AiConnection): string {
  return connection.provider === 'openrouter'
    ? connection.openrouter.model
    : connection.ollama.model;
}

export interface ChatOptions {
  /** Sampling temperature (higher = more random). */
  temperature?: number;
  /** Context window size in tokens (Ollama only). */
  contextLength?: number;
}

// -- Ollama ----------------------------------------------------------------

interface OllamaTagsResponse {
  models?: { name: string }[];
}

interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
}

function ollamaHeaders(baseUrl?: string): HeadersInit | undefined {
  return baseUrl ? { 'X-Ollama-Base-Url': baseUrl } : undefined;
}

/**
 * Checks whether the proxied Ollama server is reachable. If `baseUrl` is
 * given, it's sent so the dev server can test that address directly (used by
 * the settings UI before the URL has been saved); otherwise the proxy uses
 * the currently saved settings.
 */
export async function checkOllamaConnection(baseUrl?: string): Promise<boolean> {
  try {
    const response = await fetch('/api/ollama/api/tags', { headers: ollamaHeaders(baseUrl) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Lists model names available on the connected Ollama server. */
export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const response = await fetch('/api/ollama/api/tags', { headers: ollamaHeaders(baseUrl) });
  if (!response.ok) {
    throw new Error(`Could not reach Ollama (${response.status}).`);
  }
  const data = (await response.json()) as OllamaTagsResponse;
  return (data.models ?? []).map((model) => model.name);
}

async function streamOllamaChat(
  connection: AiConnection,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  options: ChatOptions,
): Promise<string> {
  const response = await fetch('/api/ollama/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.ollama.model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature,
        num_ctx: options.contextLength,
      },
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await safeReadError(response);
    throw new Error(`Ollama request failed (${response.status}).${detail ? ` ${detail}` : ''}`);
  }

  return readLineStream(response.body, (line) => {
    const chunk = JSON.parse(line) as OllamaChatChunk;
    return chunk.message?.content ?? '';
  }, onToken);
}

// -- OpenRouter (OpenAI-compatible) ----------------------------------------

interface OpenRouterModelsResponse {
  data?: { id: string }[];
}

interface OpenAiChatChunk {
  choices?: { delta?: { content?: string } }[];
}

function openRouterHeaders(apiKey?: string): HeadersInit | undefined {
  return apiKey ? { 'X-OpenRouter-Api-Key': apiKey } : undefined;
}

/**
 * Verifies an OpenRouter API key by querying the authenticated `/api/v1/key`
 * endpoint. If `apiKey` is given it's sent so the settings UI can test a key
 * before saving; otherwise the proxy uses the saved key.
 */
export async function checkOpenRouterConnection(apiKey?: string): Promise<boolean> {
  try {
    const response = await fetch('/api/openrouter/api/v1/key', { headers: openRouterHeaders(apiKey) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Lists model ids available on OpenRouter (a public endpoint; no key required). */
export async function listOpenRouterModels(apiKey?: string): Promise<string[]> {
  const response = await fetch('/api/openrouter/api/v1/models', { headers: openRouterHeaders(apiKey) });
  if (!response.ok) {
    throw new Error(`Could not reach OpenRouter (${response.status}).`);
  }
  const data = (await response.json()) as OpenRouterModelsResponse;
  return (data.data ?? []).map((model) => model.id);
}

async function streamOpenRouterChat(
  connection: AiConnection,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  options: ChatOptions,
): Promise<string> {
  const response = await fetch('/api/openrouter/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: connection.openrouter.model,
      messages,
      stream: true,
      temperature: options.temperature,
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await safeReadError(response);
    throw new Error(`OpenRouter request failed (${response.status}).${detail ? ` ${detail}` : ''}`);
  }

  // OpenAI-style Server-Sent Events: `data: {json}` lines, terminated by `data: [DONE]`.
  return readLineStream(response.body, (line) => {
    if (!line.startsWith('data:')) return '';
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return '';
    const chunk = JSON.parse(payload) as OpenAiChatChunk;
    return chunk.choices?.[0]?.delta?.content ?? '';
  }, onToken);
}

// -- Shared ----------------------------------------------------------------

/**
 * Reads a newline-delimited stream, passing each non-empty line to `extract`
 * to pull out the incremental text token, which is appended and forwarded to
 * `onToken`. Resolves with the full concatenated text. Lines that fail to
 * parse are skipped (e.g. SSE keep-alive comments).
 */
async function readLineStream(
  body: ReadableStream<Uint8Array>,
  extract: (line: string) => string,
  onToken: (token: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let token = '';
      try {
        token = extract(trimmed);
      } catch {
        continue;
      }
      if (token) {
        full += token;
        onToken(token);
      }
    }
  }

  return full;
}

/**
 * Sends a chat request to the connection's active provider and streams the
 * response, invoking `onToken` with each incremental chunk of text. Resolves
 * with the full response text once the stream completes.
 */
export async function sendChatMessage(
  connection: AiConnection,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  options: ChatOptions = {},
): Promise<string> {
  return connection.provider === 'openrouter'
    ? streamOpenRouterChat(connection, messages, onToken, options)
    : streamOllamaChat(connection, messages, onToken, options);
}

/**
 * Instruction appended after the raw conversation to steer the model toward
 * producing compact long-term memory notes rather than a chatty reply.
 */
const SUMMARY_INSTRUCTION =
  'Summarise the conversation above into compact long-term memory notes about the user and ' +
  'this relationship: key facts, preferences, recurring topics, important events, names, and ' +
  'anything worth remembering in future conversations. Write a short prose paragraph (or a ' +
  'couple of short paragraphs), not bullet points or a list. Clearly distinguish what the user ' +
  'said, did, or feels from what you (the AI companion) said or did, referring to the user as ' +
  '"the user" or by their name and to yourself as "I" or the companion\'s name. Omit greetings, ' +
  'pleasantries, and meta-commentary — output only the notes themselves. If there is nothing ' +
  'worth remembering, reply with an empty response.';

/**
 * Asks the active provider to condense a conversation into long-term memory
 * notes. The persona's system prompt is deliberately excluded — only the
 * actual user/assistant exchange is summarised — so the notes capture what was
 * said, not the companion's instructions. Returns the trimmed summary text
 * (possibly empty if there was nothing to remember).
 */
export async function summarizeConversation(
  connection: AiConnection,
  history: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const conversation = history.filter((message) => message.role !== 'system');
  if (conversation.length === 0) return '';

  const messages: ChatMessage[] = [
    ...conversation,
    { role: 'user', content: SUMMARY_INSTRUCTION },
  ];

  const summary = await sendChatMessage(connection, messages, () => {}, options);
  return summary.trim();
}

/** Reads a provider-shaped error body, returning a human-readable message if present. */
async function safeReadError(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.error?.message === 'string') return data.error.message;
    return null;
  } catch {
    return null;
  }
}
