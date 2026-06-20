import { defineConfig, type Connect, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { Readable } from 'node:stream';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.join(projectRoot, 'assets');
const settingsPath = path.join(projectRoot, 'settings.json');

const ASSET_TYPES = new Set(['models', 'backgrounds', 'fonts', 'animations']);
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

const MIME_TYPES: Record<string, string> = {
  '.vrm': 'application/octet-stream',
  '.vrma': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getMimeType(filename: string): string {
  return MIME_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

function isSafeFilename(name: string): boolean {
  return name.length > 0 && !name.includes('/') && !name.includes('\\') && name !== '..' && name !== '.';
}

async function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Dev/preview-only API for storing saved VRM models, background images, and
 * chat fonts as real files in the project's `assets/` folder, so they're
 * easy to find, back up, or share outside the app. Not available in static
 * production deployments — the app degrades gracefully when these endpoints
 * 404.
 */
function assetsApiPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    void (async () => {
      if (!req.url || !req.url.startsWith('/api/assets/')) {
        next();
        return;
      }

      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean); // ['api', 'assets', type, filename?]
      const type = parts[2];
      const rawFilename = parts[3];

      if (!type || !ASSET_TYPES.has(type)) {
        res.statusCode = 404;
        res.end('Unknown asset type');
        return;
      }

      const dir = path.join(assetsRoot, type);
      await fs.mkdir(dir, { recursive: true });

      try {
        if (req.method === 'GET' && !rawFilename) {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const files = await Promise.all(
            entries
              .filter((entry) => entry.isFile())
              .map(async (entry) => {
                const stat = await fs.stat(path.join(dir, entry.name));
                return { name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs };
              }),
          );
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
          return;
        }

        const filename = rawFilename ? decodeURIComponent(rawFilename) : '';
        if (!isSafeFilename(filename)) {
          res.statusCode = 400;
          res.end('Invalid filename');
          return;
        }

        const filePath = path.join(dir, filename);

        if (req.method === 'GET') {
          if (!fsSync.existsSync(filePath)) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }
          res.setHeader('Content-Type', getMimeType(filename));
          fsSync.createReadStream(filePath).pipe(res);
          return;
        }

        if (req.method === 'PUT') {
          await new Promise<void>((resolve, reject) => {
            const writeStream = fsSync.createWriteStream(filePath);
            req.pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            req.on('error', reject);
          });
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method === 'DELETE') {
          await fs.rm(filePath, { force: true });
          res.statusCode = 204;
          res.end();
          return;
        }

        next();
      } catch (error) {
        console.error('Assets API error:', error);
        res.statusCode = 500;
        res.end('Internal error');
      }
    })();
  };

  return {
    name: 'assets-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/**
 * Dev/preview-only API for persisting app settings (Ollama connection info,
 * chat display preferences) to `settings.json` at the project root, loaded
 * again on the next launch. Saved avatars/backgrounds/fonts are intentionally
 * NOT stored here — they live as files under `assets/`.
 */
function settingsApiPlugin(): Plugin {
  // Serializes concurrent PUTs so two near-simultaneous saves can't interleave
  // and corrupt the file (the client may fire several saves in quick succession,
  // e.g. when multiple settings change at once). Last write wins, which is what
  // we want since each PUT sends the full settings object.
  let writeChain: Promise<void> = Promise.resolve();

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    void (async () => {
      if (!req.url || !req.url.startsWith('/api/settings')) {
        next();
        return;
      }

      try {
        if (req.method === 'GET') {
          let contents = '{}';
          try {
            contents = await fs.readFile(settingsPath, 'utf-8');
          } catch {
            // No settings file yet — return an empty object.
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(contents);
          return;
        }

        if (req.method === 'PUT') {
          const body = await readBody(req);
          const parsed = JSON.parse(body.toString('utf-8'));
          const serialized = JSON.stringify(parsed, null, 2);
          const write = writeChain.then(() => fs.writeFile(settingsPath, serialized, 'utf-8'));
          // Keep the chain alive even if this write fails, so later writes still run.
          writeChain = write.catch(() => {});
          await write;
          res.statusCode = 204;
          res.end();
          return;
        }

        next();
      } catch (error) {
        console.error('Settings API error:', error);
        res.statusCode = 500;
        res.end('Internal error');
      }
    })();
  };

  return {
    name: 'settings-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/**
 * Dev/preview-only proxy that forwards `/api/ollama/*` requests to a local
 * Ollama server (`http://localhost:11434` by default). This avoids browser
 * CORS restrictions, since Ollama doesn't send permissive CORS headers by
 * default. The target base URL can be overridden per-request via the
 * `X-Ollama-Base-Url` header (used by the settings UI to test a connection
 * before saving it), otherwise it's read from `settings.json`.
 */
function ollamaProxyPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    void (async () => {
      if (!req.url || !req.url.startsWith('/api/ollama/')) {
        next();
        return;
      }

      let baseUrl = req.headers['x-ollama-base-url'];
      if (Array.isArray(baseUrl)) baseUrl = baseUrl[0];

      if (!baseUrl) {
        try {
          const contents = await fs.readFile(settingsPath, 'utf-8');
          const settings = JSON.parse(contents);
          baseUrl = settings?.ai?.ollama?.baseUrl;
        } catch {
          // Fall through to the default below.
        }
      }

      if (!baseUrl) baseUrl = DEFAULT_OLLAMA_BASE_URL;

      const targetPath = req.url.replace(/^\/api\/ollama/, '');
      const targetUrl = `${baseUrl.replace(/\/+$/, '')}${targetPath}`;

      try {
        const body =
          req.method && req.method !== 'GET' && req.method !== 'HEAD'
            ? await readBody(req)
            : undefined;

        const upstream = await fetch(targetUrl, {
          method: req.method,
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        res.statusCode = upstream.status;
        const contentType = upstream.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);

        if (!upstream.body) {
          res.end();
          return;
        }

        Readable.fromWeb(upstream.body as never).pipe(res);
      } catch (error) {
        console.error('Ollama proxy error:', error);
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Could not reach Ollama. Is it running?' }));
      }
    })();
  };

  return {
    name: 'ollama-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/**
 * Dev/preview-only proxy that forwards `/api/openrouter/*` requests to
 * OpenRouter (`https://openrouter.ai/*`, an OpenAI-compatible API). This keeps
 * the API key out of the client bundle and avoids browser CORS issues. The key
 * can be overridden per-request via the `X-OpenRouter-Api-Key` header (used by
 * the settings UI to test a key before saving it), otherwise it's read from
 * `settings.json`.
 */
function openrouterProxyPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    void (async () => {
      if (!req.url || !req.url.startsWith('/api/openrouter/')) {
        next();
        return;
      }

      let apiKey = req.headers['x-openrouter-api-key'];
      if (Array.isArray(apiKey)) apiKey = apiKey[0];

      if (!apiKey) {
        try {
          const contents = await fs.readFile(settingsPath, 'utf-8');
          const settings = JSON.parse(contents);
          apiKey = settings?.ai?.openrouter?.apiKey;
        } catch {
          // Fall through — listing models works without a key; chat will 401.
        }
      }

      const targetPath = req.url.replace(/^\/api\/openrouter/, '');
      const targetUrl = `https://openrouter.ai${targetPath}`;

      try {
        const body =
          req.method && req.method !== 'GET' && req.method !== 'HEAD'
            ? await readBody(req)
            : undefined;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          // OpenRouter uses these for attribution/rankings; harmless if ignored.
          'HTTP-Referer': 'http://localhost',
          'X-Title': 'VRM Companion',
        };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const upstream = await fetch(targetUrl, {
          method: req.method,
          headers,
          body,
        });

        res.statusCode = upstream.status;
        const contentType = upstream.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);

        if (!upstream.body) {
          res.end();
          return;
        }

        Readable.fromWeb(upstream.body as never).pipe(res);
      } catch (error) {
        console.error('OpenRouter proxy error:', error);
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Could not reach OpenRouter.' }));
      }
    })();
  };

  return {
    name: 'openrouter-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/** Escapes the five XML special characters, for embedding user text in Azure SSML. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface TtsUpstream {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** `json-base64` means the response is JSON with base64 audio in `audioContent` (Google). */
  decode: 'binary' | 'json-base64';
}

/**
 * Builds the provider-specific upstream HTTP request for a synthesis call.
 * Each provider has its own endpoint, auth header, and request body; this is
 * the single place that knows those differences. Returns `null` if the config
 * is missing something required (surfaced to the client as a 400).
 */
function buildTtsUpstream(
  provider: string,
  config: Record<string, unknown>,
  input: string,
): TtsUpstream | { error: string } {
  const str = (key: string): string => (typeof config[key] === 'string' ? (config[key] as string) : '');

  switch (provider) {
    case 'openai': {
      const baseUrl = str('baseUrl').replace(/\/+$/, '');
      if (!baseUrl) return { error: 'No OpenAI-compatible server URL is configured.' };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (str('apiKey')) headers['Authorization'] = `Bearer ${str('apiKey')}`;
      return {
        url: `${baseUrl}/v1/audio/speech`,
        headers,
        body: JSON.stringify({
          model: str('model'),
          voice: str('voice'),
          input,
          response_format: str('responseFormat') || 'mp3',
        }),
        decode: 'binary',
      };
    }

    case 'elevenlabs': {
      const voice = str('voice');
      if (!voice) return { error: 'Enter an ElevenLabs voice id.' };
      return {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
        headers: { 'Content-Type': 'application/json', 'xi-api-key': str('apiKey') },
        body: JSON.stringify({ text: input, model_id: str('model') || 'eleven_multilingual_v2' }),
        decode: 'binary',
      };
    }

    case 'fishaudio': {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${str('apiKey')}`,
      };
      if (str('model')) headers['model'] = str('model');
      return {
        url: 'https://api.fish.audio/v1/tts',
        headers,
        body: JSON.stringify({ text: input, reference_id: str('voice') || undefined, format: 'mp3' }),
        decode: 'binary',
      };
    }

    case 'cartesia': {
      return {
        url: 'https://api.cartesia.ai/tts/bytes',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': str('apiKey'),
          'Cartesia-Version': '2024-11-13',
        },
        body: JSON.stringify({
          model_id: str('model') || 'sonic-2',
          transcript: input,
          voice: { mode: 'id', id: str('voice') },
          output_format: { container: 'mp3', sample_rate: 44100, bit_rate: 128000 },
        }),
        decode: 'binary',
      };
    }

    case 'google': {
      const key = str('apiKey');
      if (!key) return { error: 'Enter a Google Cloud API key.' };
      const language = str('language') || 'en-US';
      const voiceName = str('voice');
      return {
        url: `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: input },
          voice: { languageCode: language, ...(voiceName ? { name: voiceName } : {}) },
          audioConfig: { audioEncoding: 'MP3' },
        }),
        decode: 'json-base64',
      };
    }

    case 'azure': {
      const region = str('region').trim();
      if (!region) return { error: 'Enter an Azure region, e.g. "eastus".' };
      const voice = str('voice').trim() || 'en-US-JennyNeural';
      const lang = voice.split('-').slice(0, 2).join('-') || 'en-US';
      const ssml =
        `<speak version='1.0' xml:lang='${lang}'>` +
        `<voice xml:lang='${lang}' name='${escapeXml(voice)}'>${escapeXml(input)}</voice>` +
        `</speak>`;
      return {
        url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        headers: {
          'Content-Type': 'application/ssml+xml',
          'Ocp-Apim-Subscription-Key': str('apiKey'),
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'vrm-companion',
        },
        body: ssml,
        decode: 'binary',
      };
    }

    default:
      return { error: `Unknown TTS provider: ${provider}` };
  }
}

/**
 * Dev/preview-only proxy that synthesizes speech for `POST /api/tts/synthesize`.
 * The browser sends `{ provider, config, input }`; this handler builds the
 * provider-specific upstream request (OpenAI-compatible, ElevenLabs, Fish
 * Audio, Cartesia, Google, or Azure), forwards it with the right auth headers,
 * and streams the audio back. Routing through the server avoids browser CORS
 * restrictions, which most of these APIs don't relax for browser origins.
 * Google returns base64-wrapped JSON, which is decoded to raw MP3 here.
 */
function ttsProxyPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    void (async () => {
      if (!req.url || !req.url.startsWith('/api/tts/synthesize')) {
        next();
        return;
      }

      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('Method not allowed');
        return;
      }

      const fail = (status: number, error: string): void => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error }));
      };

      let payload: { provider?: string; config?: Record<string, unknown>; input?: string };
      try {
        payload = JSON.parse((await readBody(req)).toString('utf-8'));
      } catch {
        fail(400, 'Invalid request body.');
        return;
      }

      const provider = payload.provider ?? '';
      const config = payload.config ?? {};
      const input = typeof payload.input === 'string' ? payload.input : '';
      if (!input) {
        fail(400, 'No text to synthesize.');
        return;
      }

      const built = buildTtsUpstream(provider, config, input);
      if ('error' in built) {
        fail(400, built.error);
        return;
      }

      try {
        const upstream = await fetch(built.url, {
          method: 'POST',
          headers: built.headers,
          body: built.body,
        });

        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          fail(upstream.status, detail.slice(0, 500) || `Upstream error (${upstream.status}).`);
          return;
        }

        if (built.decode === 'json-base64') {
          const data = (await upstream.json()) as { audioContent?: string };
          if (!data.audioContent) {
            fail(502, 'Provider returned no audio.');
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'audio/mpeg');
          res.end(Buffer.from(data.audioContent, 'base64'));
          return;
        }

        res.statusCode = 200;
        const responseContentType = upstream.headers.get('content-type');
        res.setHeader('Content-Type', responseContentType ?? 'audio/mpeg');

        if (!upstream.body) {
          res.end();
          return;
        }
        Readable.fromWeb(upstream.body as never).pipe(res);
      } catch (error) {
        console.error('TTS proxy error:', error);
        fail(502, 'Could not reach the text-to-speech provider.');
      }
    })();
  };

  return {
    name: 'tts-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    assetsApiPlugin(),
    settingsApiPlugin(),
    ollamaProxyPlugin(),
    openrouterProxyPlugin(),
    ttsProxyPlugin(),
  ],
  server: {
    port: 5173,
    watch: {
      ignored: ['**/settings.json', '**/assets/**'],
    },
  },
  build: {
    target: 'es2020',
  },
});
