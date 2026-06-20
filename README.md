# YumeVRM

A browser-based **VRM avatar companion**. Load a `.vrm` character, chat with it through a local or cloud LLM, and watch it respond with lip-synced speech, facial expressions, gaze, idle motion, and one-shot gestures. Everything — the AI, the voice, the avatar, animations, and backgrounds — is configurable from an in-app settings panel, and your setup is saved as real files in the project folder.

Built with **Vite + TypeScript + Three.js** and [`@pixiv/three-vrm`](https://github.com/pixiv/three-vrm).

---

## Features

### Avatar & rendering
- **Load any VRM model** (`.vrm`) — drag in your own character.
- **Saved avatar library** — upload once, re-select later; the last-used avatar reloads automatically on launch.
- **Idle animation** — natural breathing/sway so the character never feels frozen.
- **Gaze control** — the avatar's eyes track and shift naturally.
- **Lip sync** — the mouth moves in time with spoken TTS audio.
- **Spring physics** — secondary motion (hair, accessories) via VRM spring bones.
- **Reset view** — re-center the camera on the avatar at any time.

### AI companion (chat)
- **Two chat backends:**
  - **Ollama** (local, private, free) — runs models on your own machine.
  - **OpenRouter** (cloud) — access hosted models (Claude, GPT, Llama, etc.) with an API key.
- **Personas** — save named companion configurations (system prompt, temperature, context length) and switch between them.
- **Long-term memory** — summarize past conversations into a persona's memory card so the companion "remembers" across sessions. Editable by hand.
- **Chat memory** — running conversation context, clearable at any time.
- **Expression tags** — the AI controls its own body language inline in its replies:
  - `[demeanor:value]` — sets a persistent mood/posture (until chat memory is cleared).
  - `[emotion:value]` — a temporary facial expression for the current reply.
  - `[action:value]` — a one-shot gesture.
  - Tags are stripped before the text is shown and applied *in order, timed to the speech* as it's read aloud.
  - Built-in moods/emotions: `neutral`, `happy`, `angry`, `sad`, `relaxed`, `surprised`. Built-in actions: `laugh`, `wink`.

### Voice (text-to-speech)
Speak the companion's replies aloud, with lip sync. Six provider options:
- **OpenAI-compatible** (works with the real OpenAI API **and** local servers like Chatterbox; supports WAV/MP3/FLAC/AAC/Opus/PCM)
- **ElevenLabs**
- **Fish Audio** (cloud)
- **Cartesia**
- **Google Cloud Text-to-Speech**
- **Azure AI Speech**

Playback speed is adjustable (0.25×–4×), and there's a **Test voice** button to verify your config.

### Custom animations
- Upload your own **VRM animations** (`.vrma`) and assign each as either:
  - an **action** (one-shot gesture, triggered by `[action:name]`), or
  - a **demeanor** (looping mood, triggered by `[demeanor:name]`).
- Preview any uploaded animation on the avatar.

### Backgrounds & display
- **Custom backgrounds** — upload any image; saved background library with reset.
- **Custom chat fonts** — upload `.ttf` / `.otf` / `.woff` / `.woff2`.
- **Chat display presets** — save named combinations of font, text size, and colour.
- **Hide the text box** entirely if you only want voice.

### Developer tools
A separate dev panel (toggleable) lets you:
- Manually trigger any demeanor, emotion, or action (built-in and custom).
- **"Speak as AI"** — inject a message so the avatar speaks and animates it as if the model produced it (supports the `[demeanor:]` / `[emotion:]` / `[action:]` tags).
- View a built-in debug console.

---

## Requirements

- **[Node.js](https://nodejs.org/) 18+** and npm.
- **For chat**, one of:
  - **[Ollama](https://ollama.com/)** installed and running locally (recommended for privacy/cost), **or**
  - an **[OpenRouter](https://openrouter.ai/) API key**.
- **For voice (optional):** an account/API key with one of the supported TTS providers, or a local OpenAI-compatible TTS server.
- A **`.vrm` avatar file** — get free ones from [VRoid Hub](https://hub.vroid.com/) or make your own in [VRoid Studio](https://vroid.com/en/studio).

---

## Installation & setup

### 1. Clone and install
```bash
git clone https://github.com/royalkingjoey/YumeVRM.git
cd YumeVRM
npm install
```

### 2. Run the app
```bash
npm run dev
```
Then open the URL Vite prints (usually <http://localhost:5173>).

> **Important:** Run the app through the Vite dev (or preview) server — **don't** open `index.html` as a static file. The server provides the local API that persists your settings/assets and proxies AI/TTS requests to avoid browser CORS issues.

### 3. Set up an AI backend

**Option A — Ollama (local):**
1. [Install Ollama](https://ollama.com/) and start it (it listens on `http://localhost:11434` by default).
2. Pull a model, e.g.:
   ```bash
   ollama pull llama3
   ```
3. In the app, click the **⚙ Settings** button → **Companion** tab → choose **Ollama**, confirm the server URL, hit **refresh** and pick your model.

**Option B — OpenRouter (cloud):**
1. Get an API key from <https://openrouter.ai/keys>.
2. **Settings → Companion → OpenRouter**, paste your key, and enter a model id (e.g. `anthropic/claude-3.5-sonnet`).

### 4. Load an avatar
**Settings → Avatars → Choose .vrm file.** It's saved to your library and reloads next launch.

### 5. (Optional) Enable voice
**Settings → Voice** → tick **Speak assistant replies aloud**, pick a provider, fill in its key/model/voice, and click **Test voice**.

### 6. Chat
Type in the chat bar at the bottom and press enter. The avatar replies, emotes, and (if enabled) speaks.

---

## How your data is stored

This app saves your configuration as **real files in the project folder** (served via the dev server's local API), so they're easy to find, back up, or edit:

| What | Where |
|------|-------|
| All settings, personas, display presets, memory | `settings.json` |
| Saved avatars | `assets/models/` |
| Backgrounds | `assets/backgrounds/` |
| Fonts | `assets/fonts/` |
| Custom animations | `assets/animations/` |

> **Note:** `settings.json` and the `assets/` folder are listed in [`.gitignore`](.gitignore) — they hold your personal setup, API keys, and large media files, so they are **not** committed to the repo. A fresh clone starts with sensible defaults and creates these on first use. Keep your own backup if you want to preserve a setup.

API keys you enter live only in your local `settings.json` and are sent directly to the provider you configured (proxied through the local dev server). Nothing is sent anywhere else.

---

## Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the dev server with hot reload (use this normally). |
| `npm run build` | Type-check and build a production bundle into `dist/`. |
| `npm run preview` | Serve the production build locally — still includes the settings/asset/proxy API. |

---

## Tech stack

- [Vite](https://vitejs.dev/) — dev server & bundler (plus custom plugins for the settings/asset/AI/TTS local API)
- [TypeScript](https://www.typescriptlang.org/)
- [Three.js](https://threejs.org/)
- [`@pixiv/three-vrm`](https://github.com/pixiv/three-vrm) & [`@pixiv/three-vrm-animation`](https://github.com/pixiv/three-vrm)

---

## Troubleshooting

- **"Could not reach Ollama. Is it running?"** — Start Ollama and confirm the server URL in Settings → Companion. Make sure you've pulled at least one model.
- **No models in the Ollama dropdown** — Click the refresh (↻) button; if still empty, run `ollama list` to confirm models are installed.
- **Voice does nothing / errors** — Use **Test voice** to isolate the issue. For local OpenAI-compatible servers, prefer the **WAV** audio format (MP3 often needs ffmpeg installed).
- **Settings/avatars don't persist** — You're likely viewing `index.html` statically. Run through `npm run dev` or `npm run preview` instead.
