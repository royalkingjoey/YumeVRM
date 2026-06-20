import type { VRM } from '@pixiv/three-vrm';
import { SceneManager } from './scene/sceneManager';
import { loadVrmFromFile, disposeVrm } from './vrm/vrmLoader';
import { applyNaturalRestPose } from './vrm/restPose';
import { ExpressionController } from './animation/expressionController';
import { isEmotionName, isActionName } from './animation/expressionTypes';
import { loadVrmAnimationFromFile } from './vrm/vrmaLoader';
import { LipSync } from './animation/lipSync';
import { TagStreamFilter, extractTags, type ParsedTag } from './ai/expressionTags';
import { UiOverlay } from './ui/overlay';
import { ChatPanel } from './ui/chatPanel';
import {
  saveVrmFile,
  listSavedVrms,
  loadSavedVrm,
  deleteSavedVrm,
  setLastUsedVrmId,
  getLastUsedVrmId,
  clearLastUsedVrmId,
} from './storage/vrmLibrary';
import {
  saveBackgroundFile,
  listSavedBackgrounds,
  loadSavedBackground,
  deleteSavedBackground,
  setLastUsedBackgroundId,
  getLastUsedBackgroundId,
  clearLastUsedBackgroundId,
} from './storage/backgroundLibrary';
import {
  saveFontFile,
  listSavedFonts,
  loadSavedFont,
  deleteSavedFont,
  setLastUsedFontId,
  getLastUsedFontId,
  clearLastUsedFontId,
} from './storage/fontLibrary';
import {
  saveAnimationFile,
  listSavedAnimations,
  loadSavedAnimation,
  deleteSavedAnimation,
  type SavedAnimationEntry,
} from './storage/animationLibrary';
import {
  loadSettings,
  saveSettings,
  cloneDefaults,
  DEFAULT_SETTINGS,
  DEFAULT_PERSONA_ID,
  DEFAULT_DISPLAY_PRESET_ID,
  type AppSettings,
  type PersonaPreset,
  type ChatDisplayPreset,
  type CustomAnimationType,
  type TtsProvider,
  type AiProvider,
} from './storage/settings';
import {
  checkOllamaConnection,
  checkOpenRouterConnection,
  listOllamaModels,
  sendChatMessage,
  summarizeConversation,
  activeModel,
  type ChatMessage,
} from './ai/aiClient';
import {
  requestSpeech,
  testTtsConnection,
  ttsRequestFromSettings,
  activeTtsFormat,
} from './ai/ttsClient';
import { playAudioResponse, type PlaybackHandle } from './audio/ttsPlayer';

/** Provider ids, used to load every provider's saved config into the UI on startup. */
const TTS_PROVIDERS: readonly TtsProvider[] = [
  'openai',
  'elevenlabs',
  'fishaudio',
  'cartesia',
  'google',
  'azure',
];

const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB safety cap
const MAX_IMAGE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB safety cap
const MAX_FONT_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB safety cap
const MAX_ANIMATION_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB safety cap
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'];

/**
 * Turns an uploaded `.vrma` filename into a lowercase, tag-safe animation id
 * the AI can reference (e.g. "Wave Hello.vrma" -> "wave-hello"), matching the
 * `[a-zA-Z0-9_-]` tag grammar in `expressionTags.ts`.
 */
function animationIdFromFilename(name: string): string {
  const id = name
    .replace(/\.vrma$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || 'animation';
}

/** Human-friendly label for an uploaded animation: the filename without its `.vrma` extension. */
function animationDisplayName(fileName: string): string {
  return fileName.replace(/\.vrma$/i, '');
}

/** Fallback duration for `[emotion:...]` overrides when TTS is disabled (no playback to anchor to). */
const EMOTION_OVERRIDE_FALLBACK_MS = 4000;

/** A parsed expression tag, paired with the character offset in the spoken text where it occurred. */
interface TaggedEvent {
  tag: ParsedTag;
  offset: number;
}

/**
 * Top-level application: wires the scene, UI, loader, idle animation, the
 * local model/background/font libraries, persisted settings, and the Ollama
 * companion chat together. This is the only module that knows about all the
 * others.
 */
export class App {
  private readonly scene: SceneManager;
  private readonly ui: UiOverlay;
  private readonly chat: ChatPanel;
  private readonly expressionController = new ExpressionController();
  private readonly lipSync = new LipSync();
  /** Uploaded custom-animation ids mapped to their saved `.vrma` filename and type. */
  private readonly customAnimations = new Map<string, { fileName: string; type: CustomAnimationType }>();

  private currentVrm: VRM | null = null;
  private settings: AppSettings = cloneDefaults();
  private chatHistory: ChatMessage[] = [];
  private currentSpeech: PlaybackHandle | null = null;
  /** True while an `[emotion:...]` override is active and waiting to be cleared (TTS end or fallback timeout). */
  private pendingEmotionOverride = false;
  /** True while speech playback is paused for a one-shot gesture to play out. */
  private speechPausedForAction = false;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new SceneManager(canvas);
    this.ui = new UiOverlay();
    this.chat = new ChatPanel();

    this.ui.onFileSelected((file) => void this.handleFileUpload(file));
    this.ui.onResetView(() => this.scene.resetView());
    this.ui.vrmLibrary.onSelect((id) => void this.handleLibrarySelect(id));
    this.ui.vrmLibrary.onDelete((id) => void this.handleDeleteSaved(id));

    this.ui.onBackgroundFileSelected((file) => void this.handleBackgroundUpload(file));
    this.ui.onResetBackground(() => this.handleResetBackground());
    this.ui.backgroundLibrary.onSelect((id) => void this.handleBackgroundLibrarySelect(id));
    this.ui.backgroundLibrary.onDelete((id) => void this.handleDeleteBackgroundSaved(id));

    this.ui.onFontFileSelected((file) => void this.handleFontUpload(file));
    this.ui.fontLibrary.onSelect((id) => void this.handleFontLibrarySelect(id));
    this.ui.fontLibrary.onDelete((id) => void this.handleDeleteFontSaved(id));

    this.ui.onAnimationFileSelected((file) => void this.handleAnimationUpload(file));
    this.ui.animationLibrary.onDelete((id) => void this.handleDeleteAnimation(id));
    this.ui.onAnimationPreview((id) => this.handleAnimationPreview(id));

    this.ui.onGeneralCreateDefaultsChange((value) => void this.handleGeneralCreateDefaultsChange(value));
    this.ui.onGeneralDeveloperModeChange((value) => void this.handleGeneralDeveloperModeChange(value));

    this.ui.onChatFontSizeChange((px) => this.chat.setFontSize(px));
    this.ui.onChatFontSizeCommit((px) => void this.handleChatFontSizeCommit(px));
    this.ui.onChatFontColorChange((color) => this.chat.setColor(color));
    this.ui.onChatFontColorCommit((color) => void this.handleChatFontColorCommit(color));
    this.ui.onChatHideTextBoxChange((value) => void this.handleChatHideTextBoxChange(value));

    this.ui.onAiProviderChange((provider) => void this.handleAiProviderChange(provider));
    this.ui.onOllamaBaseUrlChange((value) => void this.handleOllamaBaseUrlChange(value));
    this.ui.onOllamaModelChange((model) => void this.handleOllamaModelChange(model));
    this.ui.onOpenRouterApiKeyChange((value) => void this.handleOpenRouterApiKeyChange(value));
    this.ui.onOpenRouterModelChange((value) => void this.handleOpenRouterModelChange(value));
    this.ui.onOllamaSystemPromptChange((value) => void this.handleOllamaSystemPromptChange(value));
    this.ui.onOllamaRefresh(() => void this.refreshOllamaModels());
    this.ui.onOllamaTemperatureCommit((value) => void this.handleOllamaTemperatureCommit(value));
    this.ui.onOllamaContextLengthChange((value) => void this.handleOllamaContextLengthCommit(value));
    this.ui.onChatMemoryClear(() => this.handleChatMemoryClear());

    this.ui.onPersonaSave(() => void this.handlePersonaSave());
    this.ui.personaLibrary.onSelect((id) => void this.handlePersonaSelect(id));
    this.ui.personaLibrary.onDelete((id) => void this.handlePersonaDelete(id));

    this.ui.onMemoryPersonaChange((id) => this.handleMemoryPersonaSelect(id));
    this.ui.onMemoryContentChange((value) => void this.handleMemoryContentEdit(value));
    this.ui.onMemorySave(() => void this.handleMemorySave());

    this.ui.onDisplayPresetSave(() => void this.handleDisplayPresetSave());
    this.ui.displayPresetLibrary.onSelect((id) => void this.handleDisplayPresetSelect(id));
    this.ui.displayPresetLibrary.onDelete((id) => void this.handleDisplayPresetDelete(id));

    this.ui.onTtsEnabledChange((value) => void this.handleTtsEnabledChange(value));
    this.ui.onTtsProviderChange((value) => void this.handleTtsProviderChange(value));
    this.ui.onTtsConfigChange((provider) => void this.handleTtsConfigChange(provider));
    this.ui.onTtsSpeedChange((value) => this.ui.setTtsSpeed(value));
    this.ui.onTtsSpeedCommit((value) => void this.handleTtsSpeedCommit(value));
    this.ui.onTtsTest(() => void this.handleTtsTest());

    this.chat.onSend((message) => void this.handleChatSend(message));

    this.ui.onDevDemeanorTrigger((name) => this.handleDevDemeanorTrigger(name));
    this.ui.onDevEmotionTrigger((name) => this.handleDevEmotionTrigger(name));
    this.ui.onDevActionTrigger((name) => this.handleDevActionTrigger(name));
    this.ui.onDevCustomDemeanorTrigger((id) => this.handleDevCustomDemeanorTrigger(id));
    this.ui.onDevCustomActionTrigger((id) => this.handleDevCustomActionTrigger(id));
    this.ui.onDevInsertMessage((message) => void this.handleDevInsertMessage(message));

    this.scene.onUpdate((delta, elapsed) => {
      if (this.currentVrm) {
        this.expressionController.update(this.currentVrm, delta, elapsed, this.currentSpeech !== null);
        this.lipSync.update(this.currentVrm);
        this.currentVrm.update(delta);
        this.syncSpeechWithActions();
      }
    });

    void this.initialize();
  }

  /** Loads persisted settings and saved assets, then applies them to the scene/UI. */
  private async initialize(): Promise<void> {
    this.settings = await loadSettings();
    await this.ensureDefaultPresets();
    this.applySettingsToUi();

    await Promise.all([
      this.loadInitialModel(),
      this.loadInitialBackground(),
      this.loadInitialFont(),
      this.refreshAnimationLibrary(),
    ]);

    void this.refreshAiConnection();
  }

  private applySettingsToUi(): void {
    this.ui.setGeneralCreateDefaults(this.settings.general.createDefaults);
    this.ui.setGeneralDeveloperMode(this.settings.general.developerMode);
    this.ui.setDeveloperButtonVisible(this.settings.general.developerMode);
    this.ui.setAiProvider(this.settings.ai.provider);
    this.ui.setOllamaBaseUrl(this.settings.ai.ollama.baseUrl);
    this.ui.setOpenRouterApiKey(this.settings.ai.openrouter.apiKey);
    this.ui.setOpenRouterModel(this.settings.ai.openrouter.model);
    this.ui.setOllamaSystemPrompt(this.settings.ai.systemPrompt);
    this.ui.setOllamaTemperature(this.settings.ai.temperature);
    this.ui.setOllamaContextLength(this.settings.ai.contextLength);
    this.ui.setTtsEnabled(this.settings.tts.enabled);
    this.ui.setTtsProvider(this.settings.tts.provider);
    for (const provider of TTS_PROVIDERS) {
      this.ui.setTtsConfig(provider, this.settings.tts[provider]);
    }
    this.ui.setTtsSpeed(this.settings.tts.speed);
    this.ui.setChatFontSize(this.settings.chatDisplay.fontSize);
    this.ui.setChatFontColor(this.settings.chatDisplay.color);
    this.ui.setChatHideTextBox(this.settings.chatDisplay.hideTextBox);
    this.chat.setFontSize(this.settings.chatDisplay.fontSize);
    this.chat.setColor(this.settings.chatDisplay.color);
    this.chat.setHideTextBox(this.settings.chatDisplay.hideTextBox);
    this.refreshPersonaLibrary();
    this.refreshDisplayPresetLibrary();
    this.refreshMemoryPersonas();
    this.restoreLastUsedPresets();
  }

  /**
   * On launch, re-selects the persona and chat display presets the user last
   * saved or chose, so the dropdowns reflect the active preset. The underlying
   * values (system prompt, font, size, colour) already persist in their own
   * settings, so this only restores the visible selection — it doesn't
   * overwrite any tweaks made since the preset was last applied.
   */
  private restoreLastUsedPresets(): void {
    const personaId = this.settings.lastUsedPersonaId;
    if (personaId && this.settings.personas.some((persona) => persona.id === personaId)) {
      this.ui.personaLibrary.selectEntry(personaId);
    }

    const displayId = this.settings.lastUsedDisplayPresetId;
    if (displayId && this.settings.displayPresets.some((preset) => preset.id === displayId)) {
      this.ui.displayPresetLibrary.selectEntry(displayId);
    }
  }

  // -- General settings ---------------------------------------------------

  private async handleGeneralCreateDefaultsChange(value: boolean): Promise<void> {
    this.settings.general.createDefaults = value;
    await saveSettings(this.settings);
  }

  private async handleGeneralDeveloperModeChange(value: boolean): Promise<void> {
    this.settings.general.developerMode = value;
    this.ui.setDeveloperButtonVisible(value);
    await saveSettings(this.settings);
  }

  /**
   * On launch, creates a "Default" persona and chat display preset if the
   * user hasn't disabled this and they don't already exist (e.g. from a
   * previous launch or because the user removed them).
   */
  private async ensureDefaultPresets(): Promise<void> {
    if (!this.settings.general.createDefaults) return;

    let changed = false;

    if (!this.settings.personas.some((persona) => persona.id === DEFAULT_PERSONA_ID)) {
      this.settings.personas.push({
        id: DEFAULT_PERSONA_ID,
        name: 'Default',
        systemPrompt: DEFAULT_SETTINGS.ai.systemPrompt,
        temperature: DEFAULT_SETTINGS.ai.temperature,
        contextLength: DEFAULT_SETTINGS.ai.contextLength,
        longTermMemory: '',
      });
      changed = true;
    }

    if (!this.settings.displayPresets.some((preset) => preset.id === DEFAULT_DISPLAY_PRESET_ID)) {
      this.settings.displayPresets.push({
        id: DEFAULT_DISPLAY_PRESET_ID,
        name: 'Default',
        fontSize: DEFAULT_SETTINGS.chatDisplay.fontSize,
        color: DEFAULT_SETTINGS.chatDisplay.color,
        fontId: null,
      });
      changed = true;
    }

    if (changed) {
      await saveSettings(this.settings);
    }
  }

  /**
   * On startup, automatically reload the last-used model from the local
   * library, if any. The camera stays at its default reset position rather
   * than auto-framing, so the view on launch always matches "Reset View".
   */
  private async loadInitialModel(): Promise<void> {
    await this.refreshLibrary();

    const lastUsedId = getLastUsedVrmId();
    if (!lastUsedId) return;

    try {
      const file = await loadSavedVrm(lastUsedId);
      const loaded = await this.loadAndDisplay(file, file.name, { frame: false });
      if (loaded) {
        this.ui.vrmLibrary.selectEntry(lastUsedId);
      }
    } catch (error) {
      console.error('Failed to auto-load last used model:', error);
      clearLastUsedVrmId();
    }
  }

  /** On startup, automatically reapply the last-used background, if any. */
  private async loadInitialBackground(): Promise<void> {
    await this.refreshBackgroundLibrary();

    const lastUsedId = getLastUsedBackgroundId();
    if (!lastUsedId) return;

    try {
      const file = await loadSavedBackground(lastUsedId);
      await this.applyBackground(file, file.name);
      this.ui.backgroundLibrary.selectEntry(lastUsedId);
    } catch (error) {
      console.error('Failed to auto-load last used background:', error);
      clearLastUsedBackgroundId();
    }
  }

  /** On startup, automatically reapply the last-used chat font, if any. */
  private async loadInitialFont(): Promise<void> {
    await this.refreshFontLibrary();

    const lastUsedId = getLastUsedFontId();
    if (!lastUsedId) return;

    try {
      const file = await loadSavedFont(lastUsedId);
      await this.chat.applyCustomFont(file);
      this.ui.fontLibrary.selectEntry(lastUsedId);
    } catch (error) {
      console.error('Failed to auto-load last used font:', error);
      clearLastUsedFontId();
    }
  }

  /** Handles a file picked via the file input: loads it and saves it to the local library. */
  private async handleFileUpload(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.vrm')) {
      this.ui.setStatus('Please select a .vrm file.', 'error');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      this.ui.setStatus('That file is too large (limit 200 MB).', 'error');
      return;
    }

    const loaded = await this.loadAndDisplay(file, file.name);
    if (!loaded) return;

    try {
      await saveVrmFile(file);
      await this.refreshLibrary();
    } catch (error) {
      console.error('Failed to save model to local library:', error);
      // Non-fatal: the model is loaded either way, just not persisted.
    }
  }

  /** Handles selecting a previously saved model from the dropdown. */
  private async handleLibrarySelect(id: string | null): Promise<void> {
    if (!id) return;

    try {
      const file = await loadSavedVrm(id);
      await this.loadAndDisplay(file, file.name);
    } catch (error) {
      console.error('Failed to load saved model:', error);
      this.ui.setStatus(formatLoadError(error, 'model'), 'error');
      this.ui.hideLoading();
    }
  }

  /** Handles deleting a saved model from the local library. */
  private async handleDeleteSaved(id: string): Promise<void> {
    try {
      await deleteSavedVrm(id);
      await this.refreshLibrary();
      this.ui.vrmLibrary.clearSelection();
      if (getLastUsedVrmId() === id) {
        clearLastUsedVrmId();
      }
      this.ui.setSettingsStatus(`Removed "${id}" from saved models.`, 'info');
    } catch (error) {
      console.error('Failed to delete saved model:', error);
      this.ui.setSettingsStatus('Could not remove the saved model.', 'error');
    }
  }

  /** Handles a background image picked via the file input. */
  private async handleBackgroundUpload(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      this.ui.setStatus('Please select an image file.', 'error');
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      this.ui.setStatus('That image is too large (limit 50 MB).', 'error');
      return;
    }

    const applied = await this.applyBackground(file, file.name);
    if (!applied) return;

    try {
      await saveBackgroundFile(file);
      await this.refreshBackgroundLibrary();
      this.ui.backgroundLibrary.selectEntry(file.name);
    } catch (error) {
      console.error('Failed to save background to local library:', error);
      // Non-fatal: the background is applied either way, just not persisted.
    }
  }

  /** Handles selecting a previously saved background from the dropdown. */
  private async handleBackgroundLibrarySelect(id: string | null): Promise<void> {
    if (!id) return;

    try {
      const file = await loadSavedBackground(id);
      await this.applyBackground(file, file.name);
    } catch (error) {
      console.error('Failed to load saved background:', error);
      this.ui.setStatus(formatLoadError(error, 'background'), 'error');
    }
  }

  /** Handles deleting a saved background from the local library. */
  private async handleDeleteBackgroundSaved(id: string): Promise<void> {
    try {
      await deleteSavedBackground(id);
      await this.refreshBackgroundLibrary();
      this.ui.backgroundLibrary.clearSelection();
      if (getLastUsedBackgroundId() === id) {
        clearLastUsedBackgroundId();
      }
      this.ui.setSettingsStatus(`Removed "${id}" from saved backgrounds.`, 'info');
    } catch (error) {
      console.error('Failed to delete saved background:', error);
      this.ui.setSettingsStatus('Could not remove the saved background.', 'error');
    }
  }

  /** Restores the default solid-color background. */
  private handleResetBackground(): void {
    this.scene.resetBackground();
    this.ui.backgroundLibrary.clearSelection();
    clearLastUsedBackgroundId();
    this.ui.setSettingsStatus('Background reset to default.', 'info');
  }

  /** Applies an image as the scene background and remembers it as last-used. */
  private async applyBackground(file: Blob, displayName: string): Promise<boolean> {
    try {
      await this.scene.setBackgroundImage(file);
      setLastUsedBackgroundId(displayName);
      this.ui.setSettingsStatus(`Background set to "${displayName}".`, 'success');
      return true;
    } catch (error) {
      console.error('Failed to apply background image:', error);
      this.ui.setStatus(formatLoadError(error, 'background'), 'error');
      return false;
    }
  }

  /** Handles a font file picked via the file input. */
  private async handleFontUpload(file: File): Promise<void> {
    const lowerName = file.name.toLowerCase();
    if (!FONT_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      this.ui.setSettingsStatus('Please select a .ttf, .otf, .woff, or .woff2 font file.', 'error');
      return;
    }

    if (file.size > MAX_FONT_SIZE_BYTES) {
      this.ui.setSettingsStatus('That font is too large (limit 20 MB).', 'error');
      return;
    }

    try {
      await this.chat.applyCustomFont(file);
      setLastUsedFontId(file.name);
      this.ui.setSettingsStatus(`Chat font set to "${file.name}".`, 'success');
    } catch (error) {
      console.error('Failed to apply font:', error);
      this.ui.setSettingsStatus('Could not load that font file.', 'error');
      return;
    }

    try {
      await saveFontFile(file);
      await this.refreshFontLibrary();
      this.ui.fontLibrary.selectEntry(file.name);
    } catch (error) {
      console.error('Failed to save font to local library:', error);
      // Non-fatal: the font is applied either way, just not persisted.
    }
  }

  /** Handles selecting a saved font (or "Default font") from the dropdown. */
  private async handleFontLibrarySelect(id: string | null): Promise<void> {
    if (!id) {
      await this.chat.applyCustomFont(null);
      clearLastUsedFontId();
      this.ui.setSettingsStatus('Chat font reset to default.', 'info');
      return;
    }

    try {
      const file = await loadSavedFont(id);
      await this.chat.applyCustomFont(file);
      setLastUsedFontId(id);
    } catch (error) {
      console.error('Failed to load saved font:', error);
      this.ui.setSettingsStatus('Could not load the saved font.', 'error');
    }
  }

  /** Handles deleting a saved font from the local library. */
  private async handleDeleteFontSaved(id: string): Promise<void> {
    try {
      await deleteSavedFont(id);
      await this.refreshFontLibrary();
      this.ui.fontLibrary.clearSelection();
      if (getLastUsedFontId() === id) {
        clearLastUsedFontId();
        await this.chat.applyCustomFont(null);
      }
      this.ui.setSettingsStatus(`Removed "${id}" from saved fonts.`, 'info');
    } catch (error) {
      console.error('Failed to delete saved font:', error);
      this.ui.setSettingsStatus('Could not remove the saved font.', 'error');
    }
  }

  // -- Custom animations --------------------------------------------------

  /** The persisted type (action vs demeanor) of an uploaded animation, or `null` if unknown. */
  private customAnimationType(id: string): CustomAnimationType | null {
    return this.customAnimations.get(id)?.type ?? null;
  }

  /** Ids of every uploaded animation of the given type, in upload order. */
  private customAnimationIds(type: CustomAnimationType): string[] {
    return [...this.customAnimations.entries()]
      .filter(([, meta]) => meta.type === type)
      .map(([id]) => id);
  }

  /** Handles a `.vrma` file picked via the file input: parses, registers, then saves it. */
  private async handleAnimationUpload(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.vrma')) {
      this.ui.setSettingsStatus('Please select a .vrma animation file.', 'error');
      return;
    }

    if (file.size > MAX_ANIMATION_SIZE_BYTES) {
      this.ui.setSettingsStatus('That animation is too large (limit 50 MB).', 'error');
      return;
    }

    const id = animationIdFromFilename(file.name);
    const type = this.ui.getAnimationType();

    // Parse first so we never persist a file we can't actually use.
    try {
      const animation = await loadVrmAnimationFromFile(file);
      this.expressionController.registerCustomAnimation(id, animation);
    } catch (error) {
      console.error('Failed to parse VRM animation:', error);
      this.ui.setSettingsStatus(
        error instanceof Error ? error.message : 'Could not read that .vrma file.',
        'error',
      );
      return;
    }

    // Record (or update) the file's type, so it's restored on the next launch.
    this.settings.customAnimations = this.settings.customAnimations.filter(
      (meta) => meta.fileName !== file.name,
    );
    this.settings.customAnimations.push({ fileName: file.name, type });

    try {
      await saveAnimationFile(file);
      await saveSettings(this.settings);
      await this.refreshAnimationLibrary();
      this.ui.animationLibrary.selectEntry(id);
      this.ui.setSettingsStatus(`Added custom ${type} "${animationDisplayName(file.name)}".`, 'success');
    } catch (error) {
      console.error('Failed to save animation to local library:', error);
      // Registered in memory either way — just not persisted to disk.
      this.customAnimations.set(id, { fileName: file.name, type });
      this.refreshCustomAnimationUi();
      this.ui.setSettingsStatus(
        `Loaded "${animationDisplayName(file.name)}" for this session (not saved to disk).`,
        'info',
      );
    }
  }

  /** Handles deleting a saved custom animation from the local library. */
  private async handleDeleteAnimation(id: string): Promise<void> {
    const meta = this.customAnimations.get(id);
    try {
      if (meta) await deleteSavedAnimation(meta.fileName);
      this.expressionController.unregisterCustomAnimation(id);
      this.customAnimations.delete(id);
      if (meta) {
        this.settings.customAnimations = this.settings.customAnimations.filter(
          (entry) => entry.fileName !== meta.fileName,
        );
        await saveSettings(this.settings);
      }
      await this.refreshAnimationLibrary();
      this.ui.animationLibrary.clearSelection();
      this.ui.setSettingsStatus(`Removed custom animation "${id}".`, 'info');
    } catch (error) {
      console.error('Failed to delete saved animation:', error);
      this.ui.setSettingsStatus('Could not remove the saved animation.', 'error');
    }
  }

  /** Plays the selected custom animation on the current avatar as a preview (looped for demeanors). */
  private handleAnimationPreview(id: string | null): void {
    if (!id) {
      this.ui.setSettingsStatus('Pick an animation to preview first.', 'error');
      return;
    }
    if (!this.currentVrm) {
      this.ui.setSettingsStatus('Load an avatar before previewing animations.', 'error');
      return;
    }
    const type = this.customAnimationType(id);
    if (!type || !this.expressionController.hasCustomAnimation(id)) {
      this.ui.setSettingsStatus('That animation is still loading or unavailable.', 'error');
      return;
    }
    if (type === 'demeanor') {
      this.expressionController.setCustomDemeanor(id);
    } else {
      this.expressionController.queueCustomAction(id);
    }
    this.ui.logDebug(`Animation preview (${type}): ${id}`);
  }

  /**
   * Lists saved `.vrma` files, (re)parsing and registering any not yet loaded
   * and dropping any whose files have disappeared, then refreshes the library
   * dropdown, the developer-panel buttons, and the system prompt.
   */
  private async refreshAnimationLibrary(): Promise<void> {
    let entries: SavedAnimationEntry[] = [];
    try {
      entries = await listSavedAnimations();
    } catch (error) {
      console.error('Failed to read local animation library:', error);
    }

    const typeFor = (fileName: string): CustomAnimationType =>
      this.settings.customAnimations.find((meta) => meta.fileName === fileName)?.type ?? 'action';

    const seenIds = new Set<string>();
    const uiEntries: SavedAnimationEntry[] = [];
    for (const entry of entries) {
      const id = animationIdFromFilename(entry.name);
      const type = typeFor(entry.name);
      seenIds.add(id);
      this.customAnimations.set(id, { fileName: entry.name, type });
      uiEntries.push({
        id,
        name: `${animationDisplayName(entry.name)} (${type})`,
        size: entry.size,
        savedAt: entry.savedAt,
      });

      if (!this.expressionController.hasCustomAnimation(id)) {
        try {
          const file = await loadSavedAnimation(entry.name);
          const animation = await loadVrmAnimationFromFile(file);
          this.expressionController.registerCustomAnimation(id, animation);
        } catch (error) {
          console.error(`Failed to load custom animation "${entry.name}":`, error);
        }
      }
    }

    // Forget animations whose backing files no longer exist.
    for (const id of [...this.customAnimations.keys()]) {
      if (!seenIds.has(id)) {
        this.customAnimations.delete(id);
        this.expressionController.unregisterCustomAnimation(id);
      }
    }

    this.ui.animationLibrary.setEntries(uiEntries);
    this.refreshCustomAnimationUi();
  }

  /** Pushes the current custom-animation set to the developer panel and the system prompt. */
  private refreshCustomAnimationUi(): void {
    this.ui.setCustomAnimations(
      this.customAnimationIds('demeanor'),
      this.customAnimationIds('action'),
    );
    this.syncSystemPromptAnimations();
  }

  private async handleChatFontSizeCommit(px: number): Promise<void> {
    this.settings.chatDisplay.fontSize = px;
    await saveSettings(this.settings);
  }

  private async handleChatFontColorCommit(color: string): Promise<void> {
    this.settings.chatDisplay.color = color;
    await saveSettings(this.settings);
  }

  private async handleChatHideTextBoxChange(value: boolean): Promise<void> {
    this.settings.chatDisplay.hideTextBox = value;
    this.chat.setHideTextBox(value);
    await saveSettings(this.settings);
  }

  // -- Companion AI settings --------------------------------------------

  private async handleAiProviderChange(provider: AiProvider): Promise<void> {
    this.settings.ai.provider = provider;
    await saveSettings(this.settings);
    await this.refreshAiConnection();
  }

  private async handleOllamaBaseUrlChange(value: string): Promise<void> {
    this.settings.ai.ollama.baseUrl = value;
    await saveSettings(this.settings);
    await this.refreshOllamaModels();
  }

  private async handleOllamaModelChange(model: string): Promise<void> {
    this.settings.ai.ollama.model = model;
    await saveSettings(this.settings);
  }

  private async handleOpenRouterApiKeyChange(value: string): Promise<void> {
    this.settings.ai.openrouter.apiKey = value;
    await saveSettings(this.settings);
    if (this.settings.ai.provider === 'openrouter') {
      await this.refreshAiConnection();
    }
  }

  private async handleOpenRouterModelChange(value: string): Promise<void> {
    this.settings.ai.openrouter.model = value;
    await saveSettings(this.settings);
  }

  private async handleOllamaSystemPromptChange(value: string): Promise<void> {
    this.settings.ai.systemPrompt = value;
    await saveSettings(this.settings);
    if (this.chatHistory.length > 0 && this.chatHistory[0].role === 'system') {
      this.chatHistory[0] = { role: 'system', content: this.buildSystemPrompt() };
    }
  }

  private async handleOllamaTemperatureCommit(value: number): Promise<void> {
    this.settings.ai.temperature = value;
    await saveSettings(this.settings);
  }

  private async handleOllamaContextLengthCommit(value: number): Promise<void> {
    this.settings.ai.contextLength = value;
    await saveSettings(this.settings);
  }

  // -- Voice / text-to-speech settings ------------------------------------

  private async handleTtsEnabledChange(value: boolean): Promise<void> {
    this.settings.tts.enabled = value;
    await saveSettings(this.settings);
    if (!value) {
      this.stopSpeaking();
    }
  }

  private async handleTtsProviderChange(provider: TtsProvider): Promise<void> {
    this.settings.tts.provider = provider;
    await saveSettings(this.settings);
  }

  private async handleTtsConfigChange(provider: TtsProvider): Promise<void> {
    this.settings.tts[provider] = this.ui.getTtsConfig(provider) as never;
    await saveSettings(this.settings);
  }

  private async handleTtsSpeedCommit(value: number): Promise<void> {
    this.settings.tts.speed = value;
    await saveSettings(this.settings);
  }

  /** Synthesizes a short test phrase with the current (possibly unsaved) Voice tab settings. */
  private async handleTtsTest(): Promise<void> {
    const provider = this.ui.getTtsProvider();
    this.ui.setTtsStatus('Testing…', 'info');
    try {
      await testTtsConnection({ provider, config: this.ui.getTtsConfig(provider) });
      this.ui.setTtsStatus('Connected. Voice synthesis is working.', 'success');
    } catch (error) {
      console.error('TTS test failed:', error);
      this.ui.setTtsStatus(
        error instanceof Error ? error.message : 'Could not reach the text-to-speech provider.',
        'error',
      );
    }
  }

  /** Stops any currently-playing speech and resets the avatar's mouth. */
  private stopSpeaking(): void {
    this.currentSpeech?.stop();
    this.currentSpeech = null;
    if (this.speechPausedForAction) {
      this.speechPausedForAction = false;
      this.lipSync.unmute();
    }
  }

  /**
   * Pauses speech playback (and mutes lip-sync) for as long as a one-shot
   * gesture is playing or queued, then resumes once it's done — so the
   * avatar doesn't keep talking over its own actions.
   */
  private syncSpeechWithActions(): void {
    const speech = this.currentSpeech;
    if (!speech) return;

    const actionActive = this.expressionController.hasPendingOrActiveAction();
    if (actionActive && !this.speechPausedForAction) {
      this.speechPausedForAction = true;
      speech.audio.pause();
      this.lipSync.mute();
    } else if (!actionActive && this.speechPausedForAction) {
      this.speechPausedForAction = false;
      this.lipSync.unmute();
      void speech.audio.play().catch((error) => {
        console.error('Failed to resume speech after action:', error);
      });
    }
  }

  /**
   * Synthesizes and plays speech for an assistant reply that has already
   * been sent to the user, driving the avatar's lip-sync during playback.
   *
   * `taggedEvents` are `[demeanor:...]`/`[emotion:...]`/`[action:...]` tags
   * the reply contained, each paired with the character offset in `text`
   * where it appeared. While speech plays, each tag is applied in order, at
   * the point in the audio corresponding to its position in the text — so
   * e.g. a later `[emotion:angry]` only takes effect once the avatar
   * actually starts speaking that part of the reply.
   */
  private async speakResponse(text: string, taggedEvents: TaggedEvent[] = []): Promise<void> {
    const trimmed = text.trim();

    if (!this.settings.tts.enabled || !trimmed) {
      // No speech to time tags against — apply them all immediately, in order.
      for (const { tag } of taggedEvents) {
        this.handleExpressionTag(tag);
      }
      // No speech to anchor an `[emotion:...]` override to — clear it after a short fallback delay.
      window.setTimeout(() => this.clearPendingEmotionOverride(), EMOTION_OVERRIDE_FALLBACK_MS);
      return;
    }

    this.stopSpeaking();

    try {
      const request = ttsRequestFromSettings(this.settings.tts);
      const response = await requestSpeech(trimmed, request);
      const handle = playAudioResponse(
        response,
        this.settings.tts.speed,
        activeTtsFormat(request),
        this.lipSync,
      );
      this.currentSpeech = handle;
      this.scheduleTaggedEvents(handle.audio, taggedEvents, text.length);
      await handle.finished;
    } catch (error) {
      console.error('TTS playback failed:', error);
      // Speech never started — apply any not-yet-applied tags immediately.
      for (const { tag } of taggedEvents) {
        this.handleExpressionTag(tag);
      }
    } finally {
      if (this.currentSpeech) {
        this.currentSpeech = null;
      }
      this.clearPendingEmotionOverride();
    }
  }

  /**
   * Applies each tagged event as `audio`'s playback reaches the point in the
   * reply corresponding to its character offset, in order. Any events still
   * unapplied when playback ends are applied immediately at that point.
   */
  private scheduleTaggedEvents(audio: HTMLAudioElement, events: TaggedEvent[], totalLength: number): void {
    if (events.length === 0) return;

    let nextIndex = 0;
    const applyDue = (progress: number): void => {
      while (nextIndex < events.length && events[nextIndex].offset / totalLength <= progress) {
        this.handleExpressionTag(events[nextIndex].tag);
        nextIndex++;
      }
    };

    const handleTimeUpdate = (): void => {
      const duration = audio.duration;
      if (!isFinite(duration) || duration <= 0) return;
      applyDue(audio.currentTime / duration);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', () => applyDue(1));
  }

  // -- Personas -------------------------------------------------------------

  /**
   * Builds the system message for the conversation: the active persona's
   * system prompt, plus that persona's accumulated long-term memory appended
   * as a clearly-labelled section, so the companion "remembers" across chats.
   */
  private buildSystemPrompt(): string {
    const sections = [this.settings.ai.systemPrompt];

    const memory = this.getActivePersonaMemory().trim();
    if (memory) {
      sections.push(
        '## Long-term memory\n' +
          'The following are things you remember about the user from past conversations. ' +
          'Treat them as established facts and draw on them naturally when relevant:\n\n' +
          memory,
      );
    }

    const customDemeanors = this.customAnimationIds('demeanor');
    const customActions = this.customAnimationIds('action');
    if (customDemeanors.length > 0 || customActions.length > 0) {
      const lines = ['## Custom animations', 'The user has uploaded these custom animations:'];
      if (customDemeanors.length > 0) {
        lines.push(
          'Custom demeanors (use as [demeanor:name], loops as a persistent mood): ' +
            customDemeanors.join(', ') + '.',
        );
      }
      if (customActions.length > 0) {
        lines.push(
          'Custom actions (use as [action:name], plays once as a one-shot gesture): ' +
            customActions.join(', ') + '.',
        );
      }
      sections.push(lines.join('\n'));
    }

    return sections.join('\n\n');
  }

  /** Re-syncs an in-flight conversation's system message after the available custom animations change. */
  private syncSystemPromptAnimations(): void {
    if (this.chatHistory.length > 0 && this.chatHistory[0].role === 'system') {
      this.chatHistory[0] = { role: 'system', content: this.buildSystemPrompt() };
    }
  }

  /** Returns the long-term memory of the currently active persona card, or an empty string. */
  private getActivePersonaMemory(): string {
    const id = this.settings.lastUsedPersonaId;
    if (!id) return '';
    return this.settings.personas.find((persona) => persona.id === id)?.longTermMemory ?? '';
  }

  /** Saves the current companion persona (system prompt) under a name for later reuse. */
  private async handlePersonaSave(): Promise<void> {
    const name = this.ui.getPersonaName();
    if (!name) {
      this.ui.setSettingsStatus('Enter a name for this persona before saving.', 'error');
      return;
    }

    const persona: PersonaPreset = {
      id: crypto.randomUUID(),
      name,
      systemPrompt: this.settings.ai.systemPrompt,
      temperature: this.settings.ai.temperature,
      contextLength: this.settings.ai.contextLength,
      longTermMemory: '',
    };
    this.settings.personas.push(persona);
    this.settings.lastUsedPersonaId = persona.id;
    await saveSettings(this.settings);

    this.refreshPersonaLibrary();
    this.refreshMemoryPersonas();
    this.ui.personaLibrary.selectEntry(persona.id);
    this.ui.setPersonaName('');
    this.ui.setSettingsStatus(`Saved persona "${name}".`, 'success');
  }

  /** Loads a saved persona's system prompt into the companion settings. */
  private async handlePersonaSelect(id: string | null): Promise<void> {
    if (!id) return;

    const persona = this.settings.personas.find((entry) => entry.id === id);
    if (!persona) return;

    this.settings.ai.systemPrompt = persona.systemPrompt;
    this.settings.ai.temperature = persona.temperature;
    this.settings.ai.contextLength = persona.contextLength;
    this.settings.lastUsedPersonaId = persona.id;
    this.ui.setOllamaSystemPrompt(persona.systemPrompt);
    this.ui.setOllamaTemperature(persona.temperature);
    this.ui.setOllamaContextLength(persona.contextLength);
    await saveSettings(this.settings);

    if (this.chatHistory.length > 0 && this.chatHistory[0].role === 'system') {
      this.chatHistory[0] = { role: 'system', content: this.buildSystemPrompt() };
    }

    this.ui.setSettingsStatus(`Loaded persona "${persona.name}".`, 'success');
  }

  /** Deletes a saved persona preset. */
  private async handlePersonaDelete(id: string): Promise<void> {
    const persona = this.settings.personas.find((entry) => entry.id === id);
    this.settings.personas = this.settings.personas.filter((entry) => entry.id !== id);
    if (this.settings.lastUsedPersonaId === id) {
      this.settings.lastUsedPersonaId = null;
    }
    await saveSettings(this.settings);

    this.refreshPersonaLibrary();
    this.refreshMemoryPersonas();
    this.ui.personaLibrary.clearSelection();
    this.ui.setSettingsStatus(`Removed persona "${persona?.name ?? id}".`, 'info');
  }

  private refreshPersonaLibrary(): void {
    const entries = this.settings.personas.map((persona) => ({
      id: persona.id,
      name: persona.name,
      size: 0,
      savedAt: 0,
    }));
    this.ui.personaLibrary.setEntries(entries);
  }

  // -- Long-term memory -----------------------------------------------------

  /**
   * Repopulates the persona-card dropdown in the Long-term Memory tab,
   * preserving the current selection if it still exists, otherwise defaulting
   * to the active persona (or the first card), then shows that card's memory.
   */
  private refreshMemoryPersonas(): void {
    const entries = this.settings.personas.map((persona) => ({ id: persona.id, name: persona.name }));

    const current = this.ui.getMemorySelectedPersonaId();
    const exists = (id: string | null): boolean => !!id && entries.some((entry) => entry.id === id);
    const selectedId = exists(current)
      ? current
      : exists(this.settings.lastUsedPersonaId)
        ? this.settings.lastUsedPersonaId
        : (entries[0]?.id ?? null);

    this.ui.setMemoryPersonas(entries, selectedId);
    this.showMemoryFor(selectedId);
  }

  /** Shows the long-term memory of the given persona card in the editable textarea. */
  private showMemoryFor(id: string | null): void {
    const persona = id ? this.settings.personas.find((entry) => entry.id === id) : null;
    this.ui.setMemoryContent(persona?.longTermMemory ?? '');
  }

  /** Handles picking a different persona card in the Long-term Memory tab. */
  private handleMemoryPersonaSelect(id: string | null): void {
    this.showMemoryFor(id);
  }

  /** Persists a hand-edit to the selected card's long-term memory. */
  private async handleMemoryContentEdit(value: string): Promise<void> {
    const id = this.ui.getMemorySelectedPersonaId();
    const persona = id ? this.settings.personas.find((entry) => entry.id === id) : null;
    if (!persona) return;

    persona.longTermMemory = value;
    await saveSettings(this.settings);

    // Keep an in-flight conversation's system context in sync if we just
    // edited the memory of the persona currently being chatted with.
    if (id === this.settings.lastUsedPersonaId && this.chatHistory[0]?.role === 'system') {
      this.chatHistory[0] = { role: 'system', content: this.buildSystemPrompt() };
    }
  }

  /**
   * Summarises the current conversation via Ollama (without the persona's
   * system prompt) and appends the result to the selected card's long-term
   * memory, rather than replacing it.
   */
  private async handleMemorySave(): Promise<void> {
    const id = this.ui.getMemorySelectedPersonaId();
    const persona = id ? this.settings.personas.find((entry) => entry.id === id) : null;
    if (!persona) {
      this.ui.setMemoryStatus('Save a persona card first, then pick it above.', 'error');
      return;
    }

    if (!activeModel(this.settings.ai)) {
      this.ui.setMemoryStatus('No model is configured. Set one up under Companion.', 'error');
      return;
    }

    if (!this.chatHistory.some((message) => message.role !== 'system')) {
      this.ui.setMemoryStatus('There is no conversation to summarise yet.', 'error');
      return;
    }

    this.ui.setMemorySaving(true);
    this.ui.setMemoryStatus('Summarising the conversation…', 'info');

    try {
      const summary = await summarizeConversation(this.settings.ai, this.chatHistory, {
        temperature: 0.3,
        contextLength: this.settings.ai.contextLength,
      });

      if (!summary) {
        this.ui.setMemoryStatus('Nothing notable to remember from this conversation yet.', 'info');
        return;
      }

      const stamp = new Date().toLocaleString();
      const block = `[${stamp}]\n${summary}`;
      const existing = persona.longTermMemory.trim();
      persona.longTermMemory = existing ? `${existing}\n\n${block}` : block;
      await saveSettings(this.settings);

      // Reflect the appended memory if this card is still the one on screen.
      if (this.ui.getMemorySelectedPersonaId() === persona.id) {
        this.ui.setMemoryContent(persona.longTermMemory);
      }

      // Sync the live conversation's system context if it's this persona.
      if (persona.id === this.settings.lastUsedPersonaId && this.chatHistory[0]?.role === 'system') {
        this.chatHistory[0] = { role: 'system', content: this.buildSystemPrompt() };
      }

      this.ui.setMemoryStatus(`Added a new summary to "${persona.name}".`, 'success');
    } catch (error) {
      console.error('Failed to summarise conversation for long-term memory:', error);
      this.ui.setMemoryStatus(
        error instanceof Error ? error.message : 'Could not summarise the conversation.',
        'error',
      );
    } finally {
      this.ui.setMemorySaving(false);
    }
  }

  // -- Chat display presets --------------------------------------------------

  /** Saves the current chat font/size/colour as a named preset for later reuse. */
  private async handleDisplayPresetSave(): Promise<void> {
    const name = this.ui.getDisplayPresetName();
    if (!name) {
      this.ui.setSettingsStatus('Enter a name for this display before saving.', 'error');
      return;
    }

    const preset: ChatDisplayPreset = {
      id: crypto.randomUUID(),
      name,
      fontSize: this.settings.chatDisplay.fontSize,
      color: this.settings.chatDisplay.color,
      fontId: getLastUsedFontId(),
    };
    this.settings.displayPresets.push(preset);
    this.settings.lastUsedDisplayPresetId = preset.id;
    await saveSettings(this.settings);

    this.refreshDisplayPresetLibrary();
    this.ui.displayPresetLibrary.selectEntry(preset.id);
    this.ui.setDisplayPresetName('');
    this.ui.setSettingsStatus(`Saved display "${name}".`, 'success');
  }

  /** Applies a saved display preset (font, size, colour). */
  private async handleDisplayPresetSelect(id: string | null): Promise<void> {
    if (!id) return;

    const preset = this.settings.displayPresets.find((entry) => entry.id === id);
    if (!preset) return;

    this.settings.chatDisplay.fontSize = preset.fontSize;
    this.settings.chatDisplay.color = preset.color;
    this.settings.lastUsedDisplayPresetId = preset.id;
    this.ui.setChatFontSize(preset.fontSize);
    this.ui.setChatFontColor(preset.color);
    this.chat.setFontSize(preset.fontSize);
    this.chat.setColor(preset.color);
    await saveSettings(this.settings);

    if (preset.fontId) {
      try {
        const file = await loadSavedFont(preset.fontId);
        await this.chat.applyCustomFont(file);
        setLastUsedFontId(preset.fontId);
        this.ui.fontLibrary.selectEntry(preset.fontId);
      } catch (error) {
        console.error('Failed to load font for display preset:', error);
      }
    } else {
      await this.chat.applyCustomFont(null);
      clearLastUsedFontId();
      this.ui.fontLibrary.clearSelection();
    }

    this.ui.setSettingsStatus(`Loaded display "${preset.name}".`, 'success');
  }

  /** Deletes a saved display preset. */
  private async handleDisplayPresetDelete(id: string): Promise<void> {
    const preset = this.settings.displayPresets.find((entry) => entry.id === id);
    this.settings.displayPresets = this.settings.displayPresets.filter((entry) => entry.id !== id);
    if (this.settings.lastUsedDisplayPresetId === id) {
      this.settings.lastUsedDisplayPresetId = null;
    }
    await saveSettings(this.settings);

    this.refreshDisplayPresetLibrary();
    this.ui.displayPresetLibrary.clearSelection();
    this.ui.setSettingsStatus(`Removed display "${preset?.name ?? id}".`, 'info');
  }

  private refreshDisplayPresetLibrary(): void {
    const entries = this.settings.displayPresets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      size: 0,
      savedAt: 0,
    }));
    this.ui.displayPresetLibrary.setEntries(entries);
  }

  /** Runs the connection check appropriate to the active provider. */
  private async refreshAiConnection(): Promise<void> {
    if (this.settings.ai.provider === 'openrouter') {
      await this.refreshOpenRouterConnection();
    } else {
      await this.refreshOllamaModels();
    }
  }

  /** Tests the Ollama connection and refreshes the available model list. */
  private async refreshOllamaModels(): Promise<void> {
    const baseUrl = this.settings.ai.ollama.baseUrl;

    const connected = await checkOllamaConnection(baseUrl);
    if (!connected) {
      this.ui.setOllamaModels([], this.settings.ai.ollama.model);
      this.ui.setOllamaStatus(
        `Could not reach Ollama at "${baseUrl}". Make sure it's running.`,
        'error',
      );
      return;
    }

    try {
      const models = await listOllamaModels(baseUrl);
      if (models.length === 0) {
        this.ui.setOllamaModels([], this.settings.ai.ollama.model);
        this.ui.setOllamaStatus('Connected, but no models are installed yet.', 'info');
        return;
      }

      if (!models.includes(this.settings.ai.ollama.model)) {
        this.settings.ai.ollama.model = models[0];
        await saveSettings(this.settings);
      }

      this.ui.setOllamaModels(models, this.settings.ai.ollama.model);
      this.ui.setOllamaStatus(`Connected. ${models.length} model(s) available.`, 'success');
    } catch (error) {
      console.error('Failed to list Ollama models:', error);
      this.ui.setOllamaModels([], this.settings.ai.ollama.model);
      this.ui.setOllamaStatus('Connected, but could not list models.', 'error');
    }
  }

  /** Verifies the OpenRouter API key and reflects the result in the shared status line. */
  private async refreshOpenRouterConnection(): Promise<void> {
    const apiKey = this.settings.ai.openrouter.apiKey;
    if (!apiKey) {
      this.ui.setOllamaStatus('Enter an OpenRouter API key to connect.', 'info');
      return;
    }

    const connected = await checkOpenRouterConnection(apiKey);
    if (!connected) {
      this.ui.setOllamaStatus('Could not authenticate with OpenRouter. Check the API key.', 'error');
      return;
    }

    const model = this.settings.ai.openrouter.model;
    this.ui.setOllamaStatus(
      model ? `Connected to OpenRouter. Using "${model}".` : 'Connected to OpenRouter. Enter a model id.',
      model ? 'success' : 'info',
    );
  }

  // -- Companion chat ------------------------------------------------------

  private async handleChatSend(message: string): Promise<void> {
    if (!activeModel(this.settings.ai)) {
      this.chat.setResponseText('No model is configured. Open Settings → Companion to set one up.');
      return;
    }

    if (this.chatHistory.length === 0) {
      this.chatHistory.push({ role: 'system', content: this.buildSystemPrompt() });
    }
    this.chatHistory.push({ role: 'user', content: message });

    this.stopSpeaking();
    this.chat.setSending(true);
    this.chat.clearResponse();

    const tagFilter = new TagStreamFilter();
    let cleanReply = '';
    const taggedEvents: TaggedEvent[] = [];

    try {
      const reply = await sendChatMessage(
        this.settings.ai,
        this.chatHistory,
        (token) => {
          const { text, tags } = tagFilter.push(token);
          if (text) {
            cleanReply += text;
            this.chat.appendResponseToken(text);
          }
          for (const tag of tags) {
            taggedEvents.push({ tag, offset: cleanReply.length });
          }
        },
        {
          temperature: this.settings.ai.temperature,
          contextLength: this.settings.ai.contextLength,
        },
      );

      const trailing = tagFilter.flush();
      if (trailing) {
        cleanReply += trailing;
        this.chat.appendResponseToken(trailing);
      }

      this.chatHistory.push({ role: 'assistant', content: reply });
      void this.speakResponse(cleanReply, taggedEvents);
    } catch (error) {
      console.error('Chat request failed:', error);
      this.chatHistory.pop(); // drop the unanswered user message
      this.chat.setResponseText(
        error instanceof Error ? error.message : 'Something went wrong talking to the AI provider.',
      );
    } finally {
      this.chat.setSending(false);
    }
  }

  /**
   * Wipes the conversation history, so the next message starts a fresh
   * context. Also clears the response textbox and cuts off any in-progress
   * speech, then resets the avatar back to its default demeanor/emotion/actions.
   */
  private handleChatMemoryClear(): void {
    this.chatHistory = [];
    this.stopSpeaking();
    this.clearPendingEmotionOverride();
    this.chat.clearResponse();
    this.expressionController.reset();
    this.ui.logDebug('Chat memory cleared — demeanor/emotion/actions reset.');
    this.ui.setOllamaStatus('Chat memory cleared.', 'success');
  }

  // -- Expression tags & developer panel -----------------------------------

  /** Applies a parsed `[action:...]` / `[demeanor:...]` / `[emotion:...]` tag from a chat reply. */
  private handleExpressionTag(tag: ParsedTag): void {
    switch (tag.kind) {
      case 'demeanor':
        if (isEmotionName(tag.value)) {
          this.expressionController.setDemeanor(tag.value);
          this.ui.logDebug(`[demeanor:${tag.value}] applied.`);
        } else if (this.customAnimationType(tag.value) === 'demeanor') {
          this.expressionController.setCustomDemeanor(tag.value);
          this.ui.logDebug(`[demeanor:${tag.value}] applied — custom animation.`);
        } else {
          this.ui.logDebug(`[demeanor:${tag.value}] ignored — not a recognized demeanor.`);
        }
        break;
      case 'emotion':
        if (isEmotionName(tag.value)) {
          this.expressionController.triggerEmotion(tag.value);
          this.pendingEmotionOverride = true;
          this.ui.logDebug(`[emotion:${tag.value}] applied — lasts until speech ends.`);
        } else {
          this.ui.logDebug(`[emotion:${tag.value}] ignored — not a recognized emotion.`);
        }
        break;
      case 'action':
        if (isActionName(tag.value)) {
          this.expressionController.queueAction(tag.value);
          this.ui.logDebug(`[action:${tag.value}] queued.`);
        } else if (this.customAnimationType(tag.value) === 'action') {
          this.expressionController.queueCustomAction(tag.value);
          this.ui.logDebug(`[action:${tag.value}] queued — custom animation.`);
        } else {
          this.ui.logDebug(`[action:${tag.value}] ignored — not a recognized action.`);
        }
        break;
    }
  }

  private handleDevDemeanorTrigger(name: string): void {
    if (!isEmotionName(name)) return;
    this.expressionController.setDemeanor(name);
    this.ui.logDebug(`Dev panel: demeanor -> ${name}`);
  }

  private handleDevEmotionTrigger(name: string): void {
    if (!isEmotionName(name)) return;
    this.expressionController.triggerEmotion(name);
    this.pendingEmotionOverride = true;
    window.setTimeout(() => this.clearPendingEmotionOverride(), EMOTION_OVERRIDE_FALLBACK_MS);
    this.ui.logDebug(`Dev panel: emotion -> ${name}`);
  }

  private handleDevActionTrigger(name: string): void {
    if (!isActionName(name)) return;
    this.expressionController.queueAction(name);
    this.ui.logDebug(`Dev panel: action -> ${name}`);
  }

  private handleDevCustomDemeanorTrigger(id: string): void {
    if (!this.expressionController.hasCustomAnimation(id)) return;
    this.expressionController.setCustomDemeanor(id);
    this.ui.logDebug(`Dev panel: custom demeanor -> ${id}`);
  }

  private handleDevCustomActionTrigger(id: string): void {
    if (!this.expressionController.hasCustomAnimation(id)) return;
    this.expressionController.queueCustomAction(id);
    this.ui.logDebug(`Dev panel: custom action -> ${id}`);
  }

  /**
   * Injects a developer-written message into the conversation as if it were
   * the AI's reply: displays it in the chat panel, applies any
   * `[demeanor:...]`/`[emotion:...]`/`[action:...]` tags, speaks it via TTS
   * (if enabled), and records it in the chat history.
   */
  private async handleDevInsertMessage(message: string): Promise<void> {
    const { text: cleanReply, tags } = extractTags(message);
    const taggedEvents: TaggedEvent[] = tags.map((tag) => ({ tag, offset: 0 }));

    if (this.chatHistory.length === 0) {
      this.chatHistory.push({ role: 'system', content: this.buildSystemPrompt() });
    }
    this.chatHistory.push({ role: 'assistant', content: message });

    this.stopSpeaking();
    this.chat.setResponseText(cleanReply);
    this.ui.logDebug(`Dev panel: inserted message "${message}"`);
    void this.speakResponse(cleanReply, taggedEvents);
  }

  /** Clears a pending `[emotion:...]` override, if one is still active. */
  private clearPendingEmotionOverride(): void {
    if (!this.pendingEmotionOverride) return;
    this.pendingEmotionOverride = false;
    this.expressionController.clearEmotionOverride();
  }

  // -- Shared model loading --------------------------------------------

  /** Shared load path: parses the VRM, swaps it into the scene, and updates UI state. */
  private async loadAndDisplay(
    file: Blob,
    displayName: string,
    options: { frame?: boolean } = {},
  ): Promise<boolean> {
    const frame = options.frame ?? true;

    this.ui.showLoading(`Loading "${displayName}"…`);
    this.ui.clearStatus();
    this.ui.setResetEnabled(false);

    try {
      const vrm = await loadVrmFromFile(file);
      this.replaceModel(vrm, frame);

      this.ui.setSettingsStatus(`Loaded "${displayName}".`, 'success');
      this.ui.setResetEnabled(true);
      setLastUsedVrmId(displayName);
      return true;
    } catch (error) {
      console.error('Failed to load VRM file:', error);
      this.ui.setStatus(formatLoadError(error, 'model'), 'error');
      return false;
    } finally {
      this.ui.hideLoading();
    }
  }

  private replaceModel(vrm: VRM, frame: boolean): void {
    if (this.currentVrm) {
      this.expressionController.resetVrm(this.currentVrm);
      disposeVrm(this.currentVrm);
      this.currentVrm = null;
    }

    applyNaturalRestPose(vrm);
    this.expressionController.captureRestPose(vrm);

    this.scene.scene.add(vrm.scene);
    this.currentVrm = vrm;

    if (frame) {
      this.scene.frameObject(vrm.scene);
    } else {
      this.scene.resetView();
    }
  }

  private async refreshLibrary(): Promise<void> {
    try {
      const entries = await listSavedVrms();
      this.ui.vrmLibrary.setEntries(entries);
    } catch (error) {
      console.error('Failed to read local model library:', error);
    }
  }

  private async refreshBackgroundLibrary(): Promise<void> {
    try {
      const entries = await listSavedBackgrounds();
      this.ui.backgroundLibrary.setEntries(entries);
    } catch (error) {
      console.error('Failed to read local background library:', error);
    }
  }

  private async refreshFontLibrary(): Promise<void> {
    try {
      const entries = await listSavedFonts();
      this.ui.fontLibrary.setEntries(entries);
    } catch (error) {
      console.error('Failed to read local font library:', error);
    }
  }
}

function formatLoadError(error: unknown, kind: 'model' | 'background'): string {
  const noun = kind === 'model' ? 'model' : 'background';
  if (error instanceof Error) {
    return `Could not load ${noun}: ${error.message}`;
  }
  return `Could not load ${noun}: unknown error.`;
}
