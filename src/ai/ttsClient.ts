import type { TtsAudioFormat, TtsProvider, TtsProviderConfig, TtsSettings } from '../storage/settings';

/**
 * Client for the dev/preview server's provider-aware TTS proxy (see
 * `vite.config.ts`). The browser POSTs the selected provider, that provider's
 * config, and the text to `/api/tts/synthesize`; the proxy builds the
 * provider-specific upstream request (OpenAI-compatible, ElevenLabs, Fish
 * Audio, Cartesia, Google, or Azure), forwards it with the right auth headers,
 * and streams normalized audio back. Routing through the proxy avoids browser
 * CORS restrictions, which most of these APIs don't relax for browser origins.
 */

/** The active provider plus that provider's configuration — everything needed for one request. */
export interface TtsRequest {
  provider: TtsProvider;
  config: TtsProviderConfig;
}

/** Builds a {@link TtsRequest} from saved settings by picking the active provider's config. */
export function ttsRequestFromSettings(tts: TtsSettings): TtsRequest {
  return { provider: tts.provider, config: tts[tts.provider] };
}

/**
 * The audio container the proxy returns for a given request. Every provider is
 * asked for MP3 except the OpenAI-compatible one, which honours its own
 * `responseFormat` (so local servers can return WAV, etc.).
 */
export function activeTtsFormat(request: TtsRequest): TtsAudioFormat {
  if (request.provider === 'openai') {
    return (request.config as { responseFormat?: TtsAudioFormat }).responseFormat ?? 'mp3';
  }
  return 'mp3';
}

/**
 * Strips characters that TTS engines tend to read aloud literally or
 * mispronounce — markdown markers (`*`, `_`, `#`, backticks), brackets,
 * emoji, and other symbols — while keeping letters and numbers (in any
 * language), whitespace, and ordinary sentence punctuation. Applied only to
 * the text sent to the speech endpoint; the on-screen chat text is left
 * exactly as the model wrote it.
 */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/[^\p{L}\p{N}\s.,!?;:'"()\-…]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Requests synthesized speech for `text`. Returns the raw `Response` so the
 * caller can stream the audio body as it arrives.
 */
export async function requestSpeech(text: string, request: TtsRequest): Promise<Response> {
  const response = await fetch('/api/tts/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: request.provider,
      config: request.config,
      input: sanitizeForSpeech(text),
    }),
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(`Text-to-speech request failed (${response.status}).${detail ? ` ${detail}` : ''}`);
  }

  return response;
}

/** Synthesizes a short test phrase and discards the result, to verify the TTS settings work. */
export async function testTtsConnection(request: TtsRequest): Promise<void> {
  const response = await requestSpeech('Voice check.', request);
  await response.body?.cancel();
}

async function safeReadError(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const data = JSON.parse(text) as { error?: { message?: string } | string; detail?: unknown };
      if (typeof data.error === 'string') return data.error;
      if (data.error?.message) return data.error.message;
      if (typeof data.detail === 'string') return data.detail;
      if (data.detail) return JSON.stringify(data.detail);
    } catch {
      // Not JSON — fall through to returning the raw text.
    }
    return text.slice(0, 200);
  } catch {
    return null;
  }
}
