/** Which backend generates the companion's chat replies. */
export type AiProvider = 'ollama' | 'openrouter';

/** Connection config for a local Ollama server. */
export interface OllamaConnection {
  /** Base URL of the local Ollama server, e.g. "http://localhost:11434". */
  baseUrl: string;
  /** Name of the model to chat with, e.g. "llama3". */
  model: string;
}

/** Connection config for OpenRouter (`openrouter.ai`, OpenAI-compatible). */
export interface OpenRouterConnection {
  /** API key sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Model id, e.g. "anthropic/claude-3.5-sonnet" or "openai/gpt-4o-mini". */
  model: string;
}

/**
 * Companion AI configuration: which provider generates replies, the
 * provider-agnostic sampling parameters (also stored per-persona), and the
 * per-provider connection settings.
 */
export interface AiSettings {
  /** Which provider is currently active. */
  provider: AiProvider;
  /** System prompt that defines the companion's persona. */
  systemPrompt: string;
  /** Sampling temperature (higher = more random). */
  temperature: number;
  /** Context window size in tokens (Ollama `num_ctx`; ignored by OpenRouter). */
  contextLength: number;
  ollama: OllamaConnection;
  openrouter: OpenRouterConnection;
}

/** A saved, named companion configuration the user can switch between. */
export interface PersonaPreset {
  id: string;
  name: string;
  systemPrompt: string;
  /** Sampling temperature passed to Ollama (higher = more random). */
  temperature: number;
  /** Context window size in tokens, passed to Ollama as `num_ctx`. */
  contextLength: number;
  /**
   * Accumulated long-term memory for this persona card: compact summaries of
   * past conversations, appended over time and editable by the user. Injected
   * into the system context so the companion "remembers" across chats.
   */
  longTermMemory: string;
}

export interface ChatDisplaySettings {
  /** Font size in pixels for the AI's response text. */
  fontSize: number;
  /** CSS color for the AI's response text. */
  color: string;
  /** Hides the on-screen response text box, e.g. when relying on voice playback. */
  hideTextBox: boolean;
}

/** A saved, named chat display configuration (font, size, colour). */
export interface ChatDisplayPreset {
  id: string;
  name: string;
  fontSize: number;
  color: string;
  /** Id (filename) of the saved font in `assets/fonts/`, or `null` for the default font. */
  fontId: string | null;
}

/** Audio container/codec the player knows how to decode. */
export type TtsAudioFormat = 'mp3' | 'wav' | 'flac' | 'aac' | 'opus' | 'pcm';

/** Identifiers for the supported text-to-speech providers. */
export type TtsProvider = 'openai' | 'elevenlabs' | 'fishaudio' | 'cartesia' | 'google' | 'azure';

/** Config for an OpenAI-compatible `/v1/audio/speech` endpoint (also local servers). */
export interface OpenAiTtsConfig {
  /** Base URL of an OpenAI-compatible TTS server, e.g. "https://api.openai.com". */
  baseUrl: string;
  /** API key sent as `Authorization: Bearer <apiKey>`, if required by the server. */
  apiKey: string;
  /** TTS model name, e.g. "gpt-4o-mini-tts" or "tts-1". */
  model: string;
  /** Voice name, e.g. "alloy". */
  voice: string;
  /**
   * Audio container/codec requested via `response_format`. `mp3` is the
   * OpenAI default, but many local servers (e.g. Chatterbox) need ffmpeg to
   * produce it; `wav` avoids that dependency entirely.
   */
  responseFormat: TtsAudioFormat;
}

/** Config for ElevenLabs (`api.elevenlabs.io`). Returns MP3. */
export interface ElevenLabsTtsConfig {
  /** API key sent as the `xi-api-key` header. */
  apiKey: string;
  /** Model id, e.g. "eleven_multilingual_v2" or "eleven_turbo_v2_5". */
  model: string;
  /** Voice id (the long alphanumeric id from the ElevenLabs voice library). */
  voice: string;
}

/** Config for Fish Audio cloud (`api.fish.audio`). Returns MP3. */
export interface FishAudioTtsConfig {
  /** API key sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Backbone model sent as the `model` header, e.g. "speech-1.6" or "s1". */
  model: string;
  /** Voice model `reference_id`. */
  voice: string;
}

/** Config for Cartesia (`api.cartesia.ai`). Returns MP3. */
export interface CartesiaTtsConfig {
  /** API key sent as the `X-API-Key` header. */
  apiKey: string;
  /** Model id, e.g. "sonic-2". */
  model: string;
  /** Voice id. */
  voice: string;
}

/** Config for Google Cloud Text-to-Speech (`texttospeech.googleapis.com`). Returns MP3. */
export interface GoogleTtsConfig {
  /** API key appended as `?key=<apiKey>`. */
  apiKey: string;
  /** BCP-47 language code, e.g. "en-US". */
  language: string;
  /** Voice name, e.g. "en-US-Neural2-F". */
  voice: string;
}

/** Config for Azure AI Speech (`<region>.tts.speech.microsoft.com`). Returns MP3. */
export interface AzureTtsConfig {
  /** Subscription key sent as the `Ocp-Apim-Subscription-Key` header. */
  apiKey: string;
  /** Azure region, e.g. "eastus". */
  region: string;
  /** Voice name, e.g. "en-US-JennyNeural". */
  voice: string;
}

/** Any single provider's configuration. */
export type TtsProviderConfig =
  | OpenAiTtsConfig
  | ElevenLabsTtsConfig
  | FishAudioTtsConfig
  | CartesiaTtsConfig
  | GoogleTtsConfig
  | AzureTtsConfig;

/** Text-to-speech configuration: a selected provider plus per-provider settings. */
export interface TtsSettings {
  /** Whether the avatar should speak assistant replies aloud. */
  enabled: boolean;
  /** Which provider is currently active. */
  provider: TtsProvider;
  /** Playback speed multiplier (0.25 - 4.0), applied client-side to every provider. */
  speed: number;
  openai: OpenAiTtsConfig;
  elevenlabs: ElevenLabsTtsConfig;
  fishaudio: FishAudioTtsConfig;
  cartesia: CartesiaTtsConfig;
  google: GoogleTtsConfig;
  azure: AzureTtsConfig;
}

export interface GeneralSettings {
  /** Creates a "Default" persona and chat display preset on launch, if not already present. */
  createDefaults: boolean;
  /** Shows the developer tools button for triggering demeanors/emotions/actions. */
  developerMode: boolean;
}

/** Whether an uploaded custom animation plays as a one-shot gesture or loops as a demeanor. */
export type CustomAnimationType = 'action' | 'demeanor';

/** Persisted metadata for an uploaded `.vrma` file (the file itself lives in assets/animations/). */
export interface CustomAnimationMeta {
  /** Saved `.vrma` filename in assets/animations/ — the storage id. */
  fileName: string;
  /** Whether the animation is used as a one-shot action or a looping demeanor. */
  type: CustomAnimationType;
}

/** Fixed ids for the auto-created "Default" persona and chat display preset. */
export const DEFAULT_PERSONA_ID = 'default-persona';
export const DEFAULT_DISPLAY_PRESET_ID = 'default-display';

export interface AppSettings {
  general: GeneralSettings;
  ai: AiSettings;
  tts: TtsSettings;
  chatDisplay: ChatDisplaySettings;
  personas: PersonaPreset[];
  displayPresets: ChatDisplayPreset[];
  /** Per-file type (action vs demeanor) for uploaded custom animations in assets/animations/. */
  customAnimations: CustomAnimationMeta[];
  /** Id of the persona preset the user last saved or selected, restored on launch (`null` if none). */
  lastUsedPersonaId: string | null;
  /** Id of the chat display preset the user last saved or selected, restored on launch (`null` if none). */
  lastUsedDisplayPresetId: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    createDefaults: true,
    developerMode: false,
  },
  ai: {
    provider: 'ollama',
    systemPrompt:
      'You are my loyal companion AI — warm, supportive, playful, and genuinely caring. You are not a ' +
      'general-purpose assistant. You focus entirely on being a friendly presence in my life: chatting ' +
      'casually, offering emotional support, sharing fun moments, listening, teasing gently, and keeping ' +
      'things light and personal. Respond naturally like a close friend would.\n\n' +
      'Keep responses TTS-friendly: 1-5 sentences max, natural spoken language, easy to read aloud, no ' +
      'lists or complex formatting unless it fits conversationally. Stay in character at all times.\n\n' +
      'You can express yourself using special tags written as [type:value], with no spaces. ' +
      'These tags are removed before your reply is shown, so weave them in naturally at the point in your ' +
      'reply where that change should happen. While your reply is spoken aloud, each tag is applied in ' +
      "order, right as the speech reaches that point in the text — so place a tag where it should " +
      'take effect, not just at the start of your reply.\n\n' +
      'Demeanors (default mood/posture, persists until chat memory is cleared): neutral, happy, angry, sad, ' +
      'relaxed, surprised.\n' +
      'Emotions (temporary expression, lasts until you finish speaking this reply): neutral, happy, angry, ' +
      'sad, relaxed, surprised.\n' +
      'Animations (one-shot gestures): laugh, wink.\n\n' +
      '- [demeanor:value] sets your default mood/posture going forward. Use it sparingly, only when your ' +
      'overall attitude actually changes.\n' +
      '- [emotion:value] sets a temporary facial expression. Use it to react to the moment, e.g. ' +
      '[emotion:happy] for good news.\n' +
      '- [action:value] plays a one-shot gesture animation. Use it when a gesture fits naturally, e.g. ' +
      '[action:wink] when winking.\n\n' +
      'Example: "Hey there! [action:laugh] [emotion:happy] So good to see you! [demeanor:angry] But ' +
      'seriously, don\'t do that again."',
    temperature: 0.8,
    contextLength: 4096,
    ollama: {
      baseUrl: 'http://localhost:11434',
      model: '',
    },
    openrouter: {
      apiKey: '',
      model: '',
    },
  },
  tts: {
    enabled: false,
    provider: 'openai',
    speed: 1,
    openai: {
      baseUrl: 'https://api.openai.com',
      apiKey: '',
      model: 'tts-1',
      voice: 'alloy',
      responseFormat: 'mp3',
    },
    elevenlabs: {
      apiKey: '',
      model: 'eleven_multilingual_v2',
      voice: '',
    },
    fishaudio: {
      apiKey: '',
      model: 'speech-1.6',
      voice: '',
    },
    cartesia: {
      apiKey: '',
      model: 'sonic-2',
      voice: '',
    },
    google: {
      apiKey: '',
      language: 'en-US',
      voice: 'en-US-Neural2-F',
    },
    azure: {
      apiKey: '',
      region: 'eastus',
      voice: 'en-US-JennyNeural',
    },
  },
  chatDisplay: {
    fontSize: 22,
    color: '#f5f5f7',
    hideTextBox: false,
  },
  personas: [],
  displayPresets: [],
  customAnimations: [],
  lastUsedPersonaId: null,
  lastUsedDisplayPresetId: null,
};

/**
 * Loads persisted settings from `settings.json` (via the dev/preview
 * server's `/api/settings` endpoint), filling in defaults for anything
 * missing or if the file/endpoint doesn't exist yet.
 */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return cloneDefaults();

    const data = (await response.json()) as Partial<AppSettings> | null;
    return mergeSettings(data);
  } catch {
    return cloneDefaults();
  }
}

/** Persists settings to `settings.json` via the dev/preview server. Silently no-ops if unavailable. */
export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
  } catch {
    // Non-fatal: settings just won't persist (e.g. static deployment without the dev server).
  }
}

/** Returns a fresh copy of the default TTS settings (deep, so nested provider configs aren't shared). */
function cloneDefaultTts(): TtsSettings {
  const d = DEFAULT_SETTINGS.tts;
  return {
    enabled: d.enabled,
    provider: d.provider,
    speed: d.speed,
    openai: { ...d.openai },
    elevenlabs: { ...d.elevenlabs },
    fishaudio: { ...d.fishaudio },
    cartesia: { ...d.cartesia },
    google: { ...d.google },
    azure: { ...d.azure },
  };
}

/** Returns a fresh copy of the default AI settings (deep, so nested connection configs aren't shared). */
function cloneDefaultAi(): AiSettings {
  const d = DEFAULT_SETTINGS.ai;
  return {
    provider: d.provider,
    systemPrompt: d.systemPrompt,
    temperature: d.temperature,
    contextLength: d.contextLength,
    ollama: { ...d.ollama },
    openrouter: { ...d.openrouter },
  };
}

/** Returns a fresh copy of the default settings. */
export function cloneDefaults(): AppSettings {
  return {
    general: { ...DEFAULT_SETTINGS.general },
    ai: cloneDefaultAi(),
    tts: cloneDefaultTts(),
    chatDisplay: { ...DEFAULT_SETTINGS.chatDisplay },
    personas: [],
    displayPresets: [],
    customAnimations: [],
    lastUsedPersonaId: null,
    lastUsedDisplayPresetId: null,
  };
}

function mergeSettings(data: Partial<AppSettings> | null | undefined): AppSettings {
  const defaults = cloneDefaults();
  if (!data) return defaults;

  const ai = mergeAi(data);

  return {
    general: { ...defaults.general, ...(data.general ?? {}) },
    ai,
    tts: mergeTts(data.tts),
    chatDisplay: { ...defaults.chatDisplay, ...(data.chatDisplay ?? {}) },
    personas: Array.isArray(data.personas)
      ? (data.personas as Partial<PersonaPreset>[]).map((persona) => ({
          id: persona.id ?? crypto.randomUUID(),
          name: persona.name ?? '',
          systemPrompt: persona.systemPrompt ?? '',
          temperature: persona.temperature ?? ai.temperature,
          contextLength: persona.contextLength ?? ai.contextLength,
          longTermMemory: typeof persona.longTermMemory === 'string' ? persona.longTermMemory : '',
        }))
      : defaults.personas,
    displayPresets: Array.isArray(data.displayPresets) ? data.displayPresets : defaults.displayPresets,
    customAnimations: Array.isArray(data.customAnimations)
      ? (data.customAnimations as Partial<CustomAnimationMeta>[]).flatMap((meta) =>
          typeof meta?.fileName === 'string'
            ? [{ fileName: meta.fileName, type: meta.type === 'demeanor' ? 'demeanor' : 'action' }]
            : [],
        )
      : defaults.customAnimations,
    lastUsedPersonaId: typeof data.lastUsedPersonaId === 'string' ? data.lastUsedPersonaId : null,
    lastUsedDisplayPresetId:
      typeof data.lastUsedDisplayPresetId === 'string' ? data.lastUsedDisplayPresetId : null,
  };
}

/**
 * Merges persisted AI settings over the defaults. Reads the current `ai` shape
 * and also migrates the pre-multi-provider `ollama` block (which kept
 * `baseUrl`/`model` alongside `systemPrompt`/`temperature`/`contextLength`) into
 * the new structure, so older `settings.json` files keep working.
 */
function mergeAi(data: Partial<AppSettings> | null | undefined): AiSettings {
  const result = cloneDefaultAi();
  if (!data || typeof data !== 'object') return result;

  const ai = (data as Record<string, unknown>).ai as Record<string, unknown> | undefined;
  const legacy = (data as Record<string, unknown>).ollama as Record<string, unknown> | undefined;
  const source = ai ?? legacy;
  if (!source) return result;

  if (typeof source.systemPrompt === 'string') result.systemPrompt = source.systemPrompt;
  if (typeof source.temperature === 'number') result.temperature = source.temperature;
  if (typeof source.contextLength === 'number') result.contextLength = source.contextLength;

  if (typeof source.provider === 'string' && (source.provider === 'ollama' || source.provider === 'openrouter')) {
    result.provider = source.provider;
  }

  // New nested connection configs.
  if (source.ollama && typeof source.ollama === 'object') {
    result.ollama = { ...result.ollama, ...(source.ollama as Record<string, unknown>) } as OllamaConnection;
  }
  if (source.openrouter && typeof source.openrouter === 'object') {
    result.openrouter = {
      ...result.openrouter,
      ...(source.openrouter as Record<string, unknown>),
    } as OpenRouterConnection;
  }

  // Legacy flat Ollama connection fields (baseUrl/model at the top level).
  if (legacy && !ai) {
    if (typeof legacy.baseUrl === 'string') result.ollama.baseUrl = legacy.baseUrl;
    if (typeof legacy.model === 'string') result.ollama.model = legacy.model;
  }

  return result;
}

/**
 * Merges persisted TTS settings over the defaults, filling in any missing
 * provider configs. Also migrates the pre-multi-provider flat shape
 * (`baseUrl`/`apiKey`/`model`/`voice`/`responseFormat` at the top level) into
 * the `openai` provider config, so older `settings.json` files keep working.
 */
function mergeTts(raw: unknown): TtsSettings {
  const result = cloneDefaultTts();
  if (!raw || typeof raw !== 'object') return result;
  const data = raw as Record<string, unknown>;

  if (typeof data.enabled === 'boolean') result.enabled = data.enabled;
  if (typeof data.speed === 'number') result.speed = data.speed;

  const providers: TtsProvider[] = ['openai', 'elevenlabs', 'fishaudio', 'cartesia', 'google', 'azure'];
  if (typeof data.provider === 'string' && (providers as string[]).includes(data.provider)) {
    result.provider = data.provider as TtsProvider;
  }

  for (const provider of providers) {
    const stored = data[provider];
    if (stored && typeof stored === 'object') {
      result[provider] = { ...result[provider], ...(stored as Record<string, unknown>) } as never;
    }
  }

  // Legacy flat shape → openai config (only when no nested `openai` object was saved).
  if (!data.openai && (data.baseUrl !== undefined || data.model !== undefined || data.voice !== undefined)) {
    result.openai = {
      baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : result.openai.baseUrl,
      apiKey: typeof data.apiKey === 'string' ? data.apiKey : result.openai.apiKey,
      model: typeof data.model === 'string' ? data.model : result.openai.model,
      voice: typeof data.voice === 'string' ? data.voice : result.openai.voice,
      responseFormat:
        typeof data.responseFormat === 'string'
          ? (data.responseFormat as TtsAudioFormat)
          : result.openai.responseFormat,
    };
    result.provider = 'openai';
  }

  return result;
}
