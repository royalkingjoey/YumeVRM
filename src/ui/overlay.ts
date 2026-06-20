import type { SavedAssetEntry } from '../storage/assetLibrary';
import type {
  AiProvider,
  CustomAnimationType,
  AzureTtsConfig,
  CartesiaTtsConfig,
  ElevenLabsTtsConfig,
  FishAudioTtsConfig,
  GoogleTtsConfig,
  OpenAiTtsConfig,
  TtsAudioFormat,
  TtsProvider,
  TtsProviderConfig,
} from '../storage/settings';

export type StatusKind = 'info' | 'error' | 'success';

/** The companion AI provider ids, in dropdown order. */
const AI_PROVIDERS: readonly AiProvider[] = ['ollama', 'openrouter'];

/** The provider ids, in dropdown order. */
const TTS_PROVIDERS: readonly TtsProvider[] = [
  'openai',
  'elevenlabs',
  'fishaudio',
  'cartesia',
  'google',
  'azure',
];

/** Per-provider input elements, grouped by provider id. */
interface TtsConfigInputs {
  openai: {
    baseUrl: HTMLInputElement;
    apiKey: HTMLInputElement;
    model: HTMLInputElement;
    voice: HTMLInputElement;
    format: HTMLSelectElement;
  };
  elevenlabs: { apiKey: HTMLInputElement; model: HTMLInputElement; voice: HTMLInputElement };
  fishaudio: { apiKey: HTMLInputElement; model: HTMLInputElement; voice: HTMLInputElement };
  cartesia: { apiKey: HTMLInputElement; model: HTMLInputElement; voice: HTMLInputElement };
  google: { apiKey: HTMLInputElement; language: HTMLInputElement; voice: HTMLInputElement };
  azure: { apiKey: HTMLInputElement; region: HTMLInputElement; voice: HTMLInputElement };
}

const PLACEHOLDER_VALUE = '';

/** How long a green (success) status stays fully visible before it starts fading out. */
const SUCCESS_HOLD_MS = 4000;
/** Duration of the fade-out for green status messages. Must match the `.status` opacity transition in style.css. */
const SUCCESS_FADE_MS = 1500;

/**
 * Wraps a `<select>` + delete `<button>` pair that lists saved assets
 * (saved VRM models, background images, or fonts). The VRM, background, and
 * font library controls in the UI all follow this same pattern.
 *
 * If `emitOnEmpty` is set, selecting the placeholder option is itself a
 * meaningful choice (e.g. "Default font") and is reported to `onSelect`
 * handlers as `null` instead of being ignored.
 */
class LibraryDropdown {
  private readonly select: HTMLSelectElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly emptyLabel: string;
  private readonly nonEmptyLabel: string;
  private readonly emitOnEmpty: boolean;

  constructor(
    selectId: string,
    deleteButtonId: string,
    emptyLabel: string,
    nonEmptyLabel: string,
    options: { emitOnEmpty?: boolean } = {},
  ) {
    this.select = requireElement<HTMLSelectElement>(selectId);
    this.deleteButton = requireElement<HTMLButtonElement>(deleteButtonId);
    this.emptyLabel = emptyLabel;
    this.nonEmptyLabel = nonEmptyLabel;
    this.emitOnEmpty = options.emitOnEmpty ?? false;

    this.select.addEventListener('change', () => {
      this.deleteButton.disabled = this.select.value === PLACEHOLDER_VALUE;
    });
  }

  /** Registers the handler invoked when the user picks a saved entry (or the placeholder, if `emitOnEmpty`). */
  onSelect(handler: (id: string | null) => void): void {
    this.select.addEventListener('change', () => {
      const id = this.select.value;
      if (id !== PLACEHOLDER_VALUE) {
        handler(id);
      } else if (this.emitOnEmpty) {
        handler(null);
      }
    });
  }

  /** Registers the handler invoked when the delete button is clicked. */
  onDelete(handler: (id: string) => void): void {
    this.deleteButton.addEventListener('click', () => {
      const id = this.select.value;
      if (id !== PLACEHOLDER_VALUE) {
        handler(id);
      }
    });
  }

  /** Repopulates the dropdown, preserving the current selection if it still exists. */
  setEntries(entries: SavedAssetEntry[]): void {
    const previousValue = this.select.value;
    this.select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = PLACEHOLDER_VALUE;
    placeholder.textContent = entries.length === 0 ? this.emptyLabel : this.nonEmptyLabel;
    this.select.appendChild(placeholder);

    for (const entry of entries) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      this.select.appendChild(option);
    }

    this.select.disabled = entries.length === 0 && !this.emitOnEmpty;

    const stillExists = entries.some((entry) => entry.id === previousValue);
    this.select.value = stillExists ? previousValue : PLACEHOLDER_VALUE;
    this.deleteButton.disabled = this.select.value === PLACEHOLDER_VALUE;
  }

  /** Selects the given entry in the dropdown, if it exists. */
  selectEntry(id: string): void {
    const exists = Array.from(this.select.options).some((option) => option.value === id);
    if (!exists) return;

    this.select.value = id;
    this.deleteButton.disabled = false;
  }

  /** Resets the dropdown back to its placeholder option. */
  clearSelection(): void {
    this.select.value = PLACEHOLDER_VALUE;
    this.deleteButton.disabled = true;
  }

  /** The id of the currently selected entry, or `null` if the placeholder is selected. */
  getSelectedId(): string | null {
    return this.select.value === PLACEHOLDER_VALUE ? null : this.select.value;
  }
}

/**
 * Thin wrapper around the static DOM overlay declared in index.html.
 * Centralizes element lookups and the small state transitions (loading,
 * status messages, settings panel, library dropdowns) so app.ts and
 * ChatPanel don't touch the DOM directly.
 */
export class UiOverlay {
  private readonly toastEl: HTMLElement;
  private readonly loadingOverlay: HTMLElement;
  private readonly loadingText: HTMLElement;

  private readonly generalCreateDefaultsInput: HTMLInputElement;
  private readonly generalDeveloperModeInput: HTMLInputElement;

  private readonly settingsButton: HTMLButtonElement;
  private readonly settingsOverlay: HTMLElement;
  private readonly settingsCloseButton: HTMLButtonElement;
  private readonly settingsStatusEl: HTMLElement;
  private readonly tabButtons: HTMLButtonElement[];
  private readonly tabPanels: Map<string, HTMLElement>;

  private readonly devButton: HTMLButtonElement;
  private readonly devOverlay: HTMLElement;
  private readonly devCloseButton: HTMLButtonElement;
  private readonly devConsoleEl: HTMLElement;
  private readonly devConsoleClearButton: HTMLButtonElement;
  private readonly devDemeanorButtons: HTMLButtonElement[];
  private readonly devEmotionButtons: HTMLButtonElement[];
  private readonly devActionButtons: HTMLButtonElement[];
  private readonly devInsertMessageInput: HTMLTextAreaElement;
  private readonly devInsertMessageButton: HTMLButtonElement;
  private readonly devCustomDemeanorContainer: HTMLElement;
  private readonly devCustomActionContainer: HTMLElement;
  private devCustomDemeanorHandler: ((id: string) => void) | null = null;
  private devCustomActionHandler: ((id: string) => void) | null = null;

  private readonly fileInput: HTMLInputElement;
  private readonly resetButton: HTMLButtonElement;

  private readonly backgroundFileInput: HTMLInputElement;
  private readonly resetBackgroundButton: HTMLButtonElement;

  private readonly fontFileInput: HTMLInputElement;

  private readonly animationFileInput: HTMLInputElement;
  private readonly animationTypeSelect: HTMLSelectElement;
  private readonly animationPreviewButton: HTMLButtonElement;

  private readonly aiProviderSelect: HTMLSelectElement;
  /** Per-provider field-group containers, shown/hidden as the provider changes. */
  private readonly aiProviderFields: Map<AiProvider, HTMLElement>;
  private readonly ollamaBaseUrlInput: HTMLInputElement;
  private readonly ollamaModelSelect: HTMLSelectElement;
  private readonly ollamaRefreshButton: HTMLButtonElement;
  private readonly openrouterApiKeyInput: HTMLInputElement;
  private readonly openrouterModelInput: HTMLInputElement;
  private readonly ollamaSystemPromptInput: HTMLTextAreaElement;
  private readonly ollamaStatusEl: HTMLElement;
  private readonly ollamaTemperatureInput: HTMLInputElement;
  private readonly ollamaTemperatureValue: HTMLElement;
  private readonly ollamaContextLengthInput: HTMLInputElement;
  private readonly chatMemoryClearButton: HTMLButtonElement;

  private readonly personaNameInput: HTMLInputElement;
  private readonly personaSaveButton: HTMLButtonElement;

  private readonly memoryPersonaSelect: HTMLSelectElement;
  private readonly memoryContentInput: HTMLTextAreaElement;
  private readonly memorySaveButton: HTMLButtonElement;
  private readonly memoryStatusEl: HTMLElement;

  private readonly chatFontSizeInput: HTMLInputElement;
  private readonly chatFontSizeValue: HTMLElement;
  private readonly chatFontColorInput: HTMLInputElement;
  private readonly chatHideTextBoxInput: HTMLInputElement;

  private readonly displayPresetNameInput: HTMLInputElement;
  private readonly displayPresetSaveButton: HTMLButtonElement;

  private readonly ttsEnabledInput: HTMLInputElement;
  private readonly ttsProviderSelect: HTMLSelectElement;
  private readonly ttsSpeedInput: HTMLInputElement;
  private readonly ttsSpeedValue: HTMLElement;
  private readonly ttsTestButton: HTMLButtonElement;
  private readonly ttsStatusEl: HTMLElement;
  /** Per-provider field-group containers, shown/hidden as the provider changes. */
  private readonly ttsProviderFields: Map<TtsProvider, HTMLElement>;
  /** Per-provider input elements, for reading/writing each provider's config. */
  private readonly ttsConfigInputs: TtsConfigInputs;

  readonly vrmLibrary: LibraryDropdown;
  readonly backgroundLibrary: LibraryDropdown;
  readonly fontLibrary: LibraryDropdown;
  readonly animationLibrary: LibraryDropdown;
  readonly personaLibrary: LibraryDropdown;
  readonly displayPresetLibrary: LibraryDropdown;

  /** Pending fade/hide timers per status element, so a new message cancels the old auto-dismiss. */
  private readonly fadeTimers = new Map<HTMLElement, number[]>();

  constructor() {
    this.toastEl = requireElement<HTMLElement>('toast');
    this.loadingOverlay = requireElement<HTMLElement>('loading-overlay');
    this.loadingText = requireElement<HTMLElement>('loading-text');

    this.generalCreateDefaultsInput = requireElement<HTMLInputElement>('general-create-defaults');
    this.generalDeveloperModeInput = requireElement<HTMLInputElement>('general-developer-mode');

    this.settingsButton = requireElement<HTMLButtonElement>('settings-btn');
    this.settingsOverlay = requireElement<HTMLElement>('settings-overlay');
    this.settingsCloseButton = requireElement<HTMLButtonElement>('settings-close-btn');
    this.settingsStatusEl = requireElement<HTMLElement>('settings-status');

    this.devButton = requireElement<HTMLButtonElement>('dev-btn');
    this.devOverlay = requireElement<HTMLElement>('dev-overlay');
    this.devCloseButton = requireElement<HTMLButtonElement>('dev-close-btn');
    this.devConsoleEl = requireElement<HTMLElement>('dev-console');
    this.devConsoleClearButton = requireElement<HTMLButtonElement>('dev-console-clear-btn');
    this.devDemeanorButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dev-demeanor]'));
    this.devEmotionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dev-emotion]'));
    this.devActionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dev-action]'));
    this.devInsertMessageInput = requireElement<HTMLTextAreaElement>('dev-insert-message');
    this.devInsertMessageButton = requireElement<HTMLButtonElement>('dev-insert-message-btn');
    this.devCustomDemeanorContainer = requireElement<HTMLElement>('dev-custom-demeanors');
    this.devCustomActionContainer = requireElement<HTMLElement>('dev-custom-actions');

    this.fileInput = requireElement<HTMLInputElement>('vrm-file-input');
    this.resetButton = requireElement<HTMLButtonElement>('reset-view-btn');

    this.backgroundFileInput = requireElement<HTMLInputElement>('background-file-input');
    this.resetBackgroundButton = requireElement<HTMLButtonElement>('reset-background-btn');

    this.fontFileInput = requireElement<HTMLInputElement>('font-file-input');

    this.animationFileInput = requireElement<HTMLInputElement>('animation-file-input');
    this.animationTypeSelect = requireElement<HTMLSelectElement>('animation-type');
    this.animationPreviewButton = requireElement<HTMLButtonElement>('animation-preview-btn');

    this.aiProviderSelect = requireElement<HTMLSelectElement>('ai-provider');
    this.aiProviderFields = new Map(
      AI_PROVIDERS.map((provider) => [
        provider,
        requireQuery<HTMLElement>(`[data-ai-provider="${provider}"]`),
      ]),
    );
    this.ollamaBaseUrlInput = requireElement<HTMLInputElement>('ollama-base-url');
    this.ollamaModelSelect = requireElement<HTMLSelectElement>('ollama-model-select');
    this.ollamaRefreshButton = requireElement<HTMLButtonElement>('ollama-refresh-btn');
    this.openrouterApiKeyInput = requireElement<HTMLInputElement>('openrouter-api-key');
    this.openrouterModelInput = requireElement<HTMLInputElement>('openrouter-model');
    this.ollamaSystemPromptInput = requireElement<HTMLTextAreaElement>('ollama-system-prompt');
    this.ollamaStatusEl = requireElement<HTMLElement>('ollama-status');
    this.ollamaTemperatureInput = requireElement<HTMLInputElement>('ollama-temperature');
    this.ollamaTemperatureValue = requireElement<HTMLElement>('ollama-temperature-value');
    this.ollamaContextLengthInput = requireElement<HTMLInputElement>('ollama-context-length');
    this.chatMemoryClearButton = requireElement<HTMLButtonElement>('chat-memory-clear-btn');

    this.personaNameInput = requireElement<HTMLInputElement>('persona-name-input');
    this.personaSaveButton = requireElement<HTMLButtonElement>('persona-save-btn');

    this.memoryPersonaSelect = requireElement<HTMLSelectElement>('memory-persona-select');
    this.memoryContentInput = requireElement<HTMLTextAreaElement>('memory-content');
    this.memorySaveButton = requireElement<HTMLButtonElement>('memory-save-btn');
    this.memoryStatusEl = requireElement<HTMLElement>('memory-status');

    this.chatFontSizeInput = requireElement<HTMLInputElement>('chat-font-size');
    this.chatFontSizeValue = requireElement<HTMLElement>('chat-font-size-value');
    this.chatFontColorInput = requireElement<HTMLInputElement>('chat-font-color');
    this.chatHideTextBoxInput = requireElement<HTMLInputElement>('chat-hide-textbox');

    this.displayPresetNameInput = requireElement<HTMLInputElement>('display-preset-name-input');
    this.displayPresetSaveButton = requireElement<HTMLButtonElement>('display-preset-save-btn');

    this.ttsEnabledInput = requireElement<HTMLInputElement>('tts-enabled');
    this.ttsProviderSelect = requireElement<HTMLSelectElement>('tts-provider');
    this.ttsSpeedInput = requireElement<HTMLInputElement>('tts-speed');
    this.ttsSpeedValue = requireElement<HTMLElement>('tts-speed-value');
    this.ttsTestButton = requireElement<HTMLButtonElement>('tts-test-btn');
    this.ttsStatusEl = requireElement<HTMLElement>('tts-status');

    this.ttsProviderFields = new Map(
      TTS_PROVIDERS.map((provider) => [
        provider,
        requireQuery<HTMLElement>(`[data-tts-provider="${provider}"]`),
      ]),
    );
    this.ttsConfigInputs = {
      openai: {
        baseUrl: requireElement<HTMLInputElement>('tts-openai-base-url'),
        apiKey: requireElement<HTMLInputElement>('tts-openai-api-key'),
        model: requireElement<HTMLInputElement>('tts-openai-model'),
        voice: requireElement<HTMLInputElement>('tts-openai-voice'),
        format: requireElement<HTMLSelectElement>('tts-openai-format'),
      },
      elevenlabs: {
        apiKey: requireElement<HTMLInputElement>('tts-elevenlabs-api-key'),
        model: requireElement<HTMLInputElement>('tts-elevenlabs-model'),
        voice: requireElement<HTMLInputElement>('tts-elevenlabs-voice'),
      },
      fishaudio: {
        apiKey: requireElement<HTMLInputElement>('tts-fishaudio-api-key'),
        model: requireElement<HTMLInputElement>('tts-fishaudio-model'),
        voice: requireElement<HTMLInputElement>('tts-fishaudio-voice'),
      },
      cartesia: {
        apiKey: requireElement<HTMLInputElement>('tts-cartesia-api-key'),
        model: requireElement<HTMLInputElement>('tts-cartesia-model'),
        voice: requireElement<HTMLInputElement>('tts-cartesia-voice'),
      },
      google: {
        apiKey: requireElement<HTMLInputElement>('tts-google-api-key'),
        language: requireElement<HTMLInputElement>('tts-google-language'),
        voice: requireElement<HTMLInputElement>('tts-google-voice'),
      },
      azure: {
        apiKey: requireElement<HTMLInputElement>('tts-azure-api-key'),
        region: requireElement<HTMLInputElement>('tts-azure-region'),
        voice: requireElement<HTMLInputElement>('tts-azure-voice'),
      },
    };

    this.vrmLibrary = new LibraryDropdown(
      'vrm-library-select',
      'delete-saved-btn',
      'No saved models',
      'Saved models…',
    );

    this.backgroundLibrary = new LibraryDropdown(
      'background-library-select',
      'delete-background-btn',
      'No saved backgrounds',
      'Saved backgrounds…',
    );

    this.fontLibrary = new LibraryDropdown(
      'font-library-select',
      'delete-font-btn',
      'Default font',
      'Default font',
      { emitOnEmpty: true },
    );

    this.animationLibrary = new LibraryDropdown(
      'animation-library-select',
      'delete-animation-btn',
      'No saved animations',
      'Saved animations…',
    );

    this.personaLibrary = new LibraryDropdown(
      'persona-select',
      'persona-delete-btn',
      'No saved personas',
      'Saved personas…',
    );

    this.displayPresetLibrary = new LibraryDropdown(
      'display-preset-select',
      'display-preset-delete-btn',
      'No saved displays',
      'Saved displays…',
    );

    this.tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-btn'));
    this.tabPanels = new Map(
      Array.from(document.querySelectorAll<HTMLElement>('[data-tab-panel]')).map((el) => [
        el.dataset.tabPanel ?? '',
        el,
      ]),
    );

    this.setupSettingsPanel();
    this.setupDevPanel();
  }

  private setupSettingsPanel(): void {
    this.settingsButton.addEventListener('click', () => this.openSettings());
    this.settingsCloseButton.addEventListener('click', () => this.closeSettings());
    this.settingsOverlay.addEventListener('click', (event) => {
      if (event.target === this.settingsOverlay) {
        this.closeSettings();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.settingsOverlay.hidden) {
        this.closeSettings();
      }
    });

    for (const button of this.tabButtons) {
      button.addEventListener('click', () => this.selectTab(button.dataset.tab ?? ''));
    }

    if (this.tabButtons.length > 0) {
      this.selectTab(this.tabButtons[0].dataset.tab ?? '');
    }
  }

  private setupDevPanel(): void {
    this.devButton.addEventListener('click', () => this.openDevPanel());
    this.devCloseButton.addEventListener('click', () => this.closeDevPanel());
    this.devOverlay.addEventListener('click', (event) => {
      if (event.target === this.devOverlay) {
        this.closeDevPanel();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.devOverlay.hidden) {
        this.closeDevPanel();
      }
    });

    this.devConsoleClearButton.addEventListener('click', () => {
      this.devConsoleEl.innerHTML = '';
    });
  }

  openDevPanel(): void {
    this.devOverlay.hidden = false;
  }

  closeDevPanel(): void {
    this.devOverlay.hidden = true;
  }

  /** Registers handlers for the developer panel's demeanor/emotion/action buttons. */
  onDevDemeanorTrigger(handler: (name: string) => void): void {
    for (const button of this.devDemeanorButtons) {
      button.addEventListener('click', () => handler(button.dataset.devDemeanor ?? ''));
    }
  }

  onDevEmotionTrigger(handler: (name: string) => void): void {
    for (const button of this.devEmotionButtons) {
      button.addEventListener('click', () => handler(button.dataset.devEmotion ?? ''));
    }
  }

  onDevActionTrigger(handler: (name: string) => void): void {
    for (const button of this.devActionButtons) {
      button.addEventListener('click', () => handler(button.dataset.devAction ?? ''));
    }
  }

  /** Registers the handler invoked when the user submits a message via the developer panel's "Speak as AI" button. */
  onDevInsertMessage(handler: (message: string) => void): void {
    this.devInsertMessageButton.addEventListener('click', () => {
      const message = this.devInsertMessageInput.value.trim();
      if (!message) return;

      this.devInsertMessageInput.value = '';
      handler(message);
    });
  }

  /** Appends a timestamped line to the developer panel's debug console. */
  logDebug(message: string): void {
    const time = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = 'dev-console-entry';
    entry.textContent = `[${time}] ${message}`;
    this.devConsoleEl.appendChild(entry);
    this.devConsoleEl.scrollTop = this.devConsoleEl.scrollHeight;
  }

  private selectTab(tab: string): void {
    for (const button of this.tabButtons) {
      button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    }
    for (const [name, panel] of this.tabPanels) {
      panel.hidden = name !== tab;
    }
  }

  openSettings(): void {
    this.settingsOverlay.hidden = false;
  }

  closeSettings(): void {
    this.settingsOverlay.hidden = true;
  }

  /** Registers the handler invoked when a user selects a .vrm file. */
  onFileSelected(handler: (file: File) => void): void {
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) {
        handler(file);
      }
      // Allow re-selecting the same file twice in a row.
      this.fileInput.value = '';
    });
  }

  /** Registers the handler invoked when a user selects a background image file. */
  onBackgroundFileSelected(handler: (file: File) => void): void {
    this.backgroundFileInput.addEventListener('change', () => {
      const file = this.backgroundFileInput.files?.[0];
      if (file) {
        handler(file);
      }
      this.backgroundFileInput.value = '';
    });
  }

  /** Registers the handler invoked when a user selects a font file. */
  onFontFileSelected(handler: (file: File) => void): void {
    this.fontFileInput.addEventListener('change', () => {
      const file = this.fontFileInput.files?.[0];
      if (file) {
        handler(file);
      }
      this.fontFileInput.value = '';
    });
  }

  /** Registers the handler invoked when a user selects a .vrma animation file. */
  onAnimationFileSelected(handler: (file: File) => void): void {
    this.animationFileInput.addEventListener('change', () => {
      const file = this.animationFileInput.files?.[0];
      if (file) {
        handler(file);
      }
      this.animationFileInput.value = '';
    });
  }

  /** The animation type currently chosen for the next upload. */
  getAnimationType(): CustomAnimationType {
    return this.animationTypeSelect.value === 'demeanor' ? 'demeanor' : 'action';
  }

  /** Registers the handler invoked when the "Preview selected" animation button is clicked. */
  onAnimationPreview(handler: (id: string | null) => void): void {
    this.animationPreviewButton.addEventListener('click', () => {
      handler(this.animationLibrary.getSelectedId());
    });
  }

  /** Registers the developer-panel custom demeanor trigger handler (one per uploaded animation). */
  onDevCustomDemeanorTrigger(handler: (id: string) => void): void {
    this.devCustomDemeanorHandler = handler;
  }

  /** Registers the developer-panel custom action trigger handler (one per uploaded animation). */
  onDevCustomActionTrigger(handler: (id: string) => void): void {
    this.devCustomActionHandler = handler;
  }

  /** Rebuilds the developer-panel buttons, listing each uploaded animation under its type. */
  setCustomAnimations(demeanorIds: string[], actionIds: string[]): void {
    this.renderCustomAnimationButtons(this.devCustomDemeanorContainer, demeanorIds, (id) =>
      this.devCustomDemeanorHandler?.(id),
    );
    this.renderCustomAnimationButtons(this.devCustomActionContainer, actionIds, (id) =>
      this.devCustomActionHandler?.(id),
    );
  }

  /** Renders one trigger button per animation id into `container`, or an empty-state hint. */
  private renderCustomAnimationButtons(
    container: HTMLElement,
    ids: string[],
    onClick: (id: string) => void,
  ): void {
    container.innerHTML = '';

    if (ids.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'dev-empty';
      empty.textContent = 'None uploaded yet.';
      container.appendChild(empty);
      return;
    }

    for (const id of ids) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id;
      button.addEventListener('click', () => onClick(id));
      container.appendChild(button);
    }
  }

  /** Registers the handler invoked when the reset view button is clicked. */
  onResetView(handler: () => void): void {
    this.resetButton.addEventListener('click', handler);
  }

  /** Registers the handler invoked when the reset background button is clicked. */
  onResetBackground(handler: () => void): void {
    this.resetBackgroundButton.addEventListener('click', handler);
  }

  setResetEnabled(enabled: boolean): void {
    this.resetButton.disabled = !enabled;
  }

  showLoading(message = 'Loading model…'): void {
    this.loadingText.textContent = message;
    this.loadingOverlay.hidden = false;
  }

  hideLoading(): void {
    this.loadingOverlay.hidden = true;
  }

  /** Shows a transient status message near the top of the screen. */
  setStatus(message: string, kind: StatusKind = 'info'): void {
    this.showStatus(this.toastEl, message, kind);
  }

  clearStatus(): void {
    this.hideStatus(this.toastEl);
  }

  /** Shows a status message inside the settings panel (e.g. library save/delete results). */
  setSettingsStatus(message: string, kind: StatusKind = 'info'): void {
    this.showStatus(this.settingsStatusEl, message, kind);
  }

  clearSettingsStatus(): void {
    this.hideStatus(this.settingsStatusEl);
  }

  /**
   * Shared status-message renderer. Green (success) messages auto-dismiss:
   * they stay fully visible for a moment, then slowly fade out and hide.
   * Info/error messages stay until replaced or explicitly cleared.
   */
  private showStatus(el: HTMLElement, message: string, kind: StatusKind): void {
    this.clearFadeTimers(el);
    el.classList.remove('status--fading');
    el.textContent = message;
    el.dataset.kind = kind;
    el.hidden = false;

    if (kind !== 'success') return;

    const fadeTimer = window.setTimeout(() => {
      el.classList.add('status--fading');
      const hideTimer = window.setTimeout(() => {
        this.hideStatus(el);
      }, SUCCESS_FADE_MS);
      this.fadeTimers.set(el, [hideTimer]);
    }, SUCCESS_HOLD_MS);
    this.fadeTimers.set(el, [fadeTimer]);
  }

  /** Hides a status element and cancels any pending fade so it can't reappear mid-transition. */
  private hideStatus(el: HTMLElement): void {
    this.clearFadeTimers(el);
    el.hidden = true;
    el.classList.remove('status--fading');
    el.textContent = '';
  }

  private clearFadeTimers(el: HTMLElement): void {
    const timers = this.fadeTimers.get(el);
    if (!timers) return;
    for (const id of timers) {
      window.clearTimeout(id);
    }
    this.fadeTimers.delete(el);
  }

  // -- General settings --------------------------------------------------

  getGeneralCreateDefaults(): boolean {
    return this.generalCreateDefaultsInput.checked;
  }

  setGeneralCreateDefaults(value: boolean): void {
    this.generalCreateDefaultsInput.checked = value;
  }

  onGeneralCreateDefaultsChange(handler: (value: boolean) => void): void {
    this.generalCreateDefaultsInput.addEventListener('change', () => handler(this.getGeneralCreateDefaults()));
  }

  getGeneralDeveloperMode(): boolean {
    return this.generalDeveloperModeInput.checked;
  }

  setGeneralDeveloperMode(value: boolean): void {
    this.generalDeveloperModeInput.checked = value;
  }

  onGeneralDeveloperModeChange(handler: (value: boolean) => void): void {
    this.generalDeveloperModeInput.addEventListener('change', () => handler(this.getGeneralDeveloperMode()));
  }

  /** Shows or hides the developer tools trigger button. */
  setDeveloperButtonVisible(visible: boolean): void {
    this.devButton.hidden = !visible;
  }

  // -- Companion AI settings -------------------------------------------

  getAiProvider(): AiProvider {
    return this.aiProviderSelect.value as AiProvider;
  }

  setAiProvider(value: AiProvider): void {
    this.aiProviderSelect.value = value;
    this.updateAiProviderVisibility(value);
  }

  onAiProviderChange(handler: (value: AiProvider) => void): void {
    this.aiProviderSelect.addEventListener('change', () => {
      const provider = this.getAiProvider();
      this.updateAiProviderVisibility(provider);
      handler(provider);
    });
  }

  /** Shows only the selected provider's field group, hiding the rest. */
  updateAiProviderVisibility(provider: AiProvider): void {
    for (const [p, container] of this.aiProviderFields) {
      container.hidden = p !== provider;
    }
  }

  getOpenRouterApiKey(): string {
    return this.openrouterApiKeyInput.value.trim();
  }

  setOpenRouterApiKey(value: string): void {
    this.openrouterApiKeyInput.value = value;
  }

  onOpenRouterApiKeyChange(handler: (value: string) => void): void {
    this.openrouterApiKeyInput.addEventListener('change', () => handler(this.getOpenRouterApiKey()));
  }

  getOpenRouterModel(): string {
    return this.openrouterModelInput.value.trim();
  }

  setOpenRouterModel(value: string): void {
    this.openrouterModelInput.value = value;
  }

  onOpenRouterModelChange(handler: (value: string) => void): void {
    this.openrouterModelInput.addEventListener('change', () => handler(this.getOpenRouterModel()));
  }

  // -- Ollama connection -----------------------------------------------

  getOllamaBaseUrl(): string {
    return this.ollamaBaseUrlInput.value.trim();
  }

  setOllamaBaseUrl(value: string): void {
    this.ollamaBaseUrlInput.value = value;
  }

  onOllamaBaseUrlChange(handler: (value: string) => void): void {
    this.ollamaBaseUrlInput.addEventListener('change', () => handler(this.getOllamaBaseUrl()));
  }

  getOllamaModel(): string {
    return this.ollamaModelSelect.value;
  }

  /** Repopulates the model dropdown, preserving `selected` if it's among `models`. */
  setOllamaModels(models: string[], selected: string): void {
    this.ollamaModelSelect.innerHTML = '';

    if (models.length === 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'No models found';
      this.ollamaModelSelect.appendChild(placeholder);
      this.ollamaModelSelect.disabled = true;
      return;
    }

    this.ollamaModelSelect.disabled = false;
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      this.ollamaModelSelect.appendChild(option);
    }

    if (models.includes(selected)) {
      this.ollamaModelSelect.value = selected;
    }
  }

  onOllamaModelChange(handler: (model: string) => void): void {
    this.ollamaModelSelect.addEventListener('change', () => handler(this.getOllamaModel()));
  }

  onOllamaRefresh(handler: () => void): void {
    this.ollamaRefreshButton.addEventListener('click', handler);
  }

  getOllamaSystemPrompt(): string {
    return this.ollamaSystemPromptInput.value;
  }

  setOllamaSystemPrompt(value: string): void {
    this.ollamaSystemPromptInput.value = value;
  }

  onOllamaSystemPromptChange(handler: (value: string) => void): void {
    this.ollamaSystemPromptInput.addEventListener('change', () => handler(this.getOllamaSystemPrompt()));
  }

  setOllamaStatus(message: string, kind: StatusKind = 'info'): void {
    this.showStatus(this.ollamaStatusEl, message, kind);
  }

  getOllamaTemperature(): number {
    return Number(this.ollamaTemperatureInput.value);
  }

  setOllamaTemperature(value: number): void {
    this.ollamaTemperatureInput.value = String(value);
    this.ollamaTemperatureValue.textContent = value.toFixed(2);
  }

  /** Fires continuously while dragging, for live display of the value. */
  onOllamaTemperatureChange(handler: (value: number) => void): void {
    this.ollamaTemperatureInput.addEventListener('input', () => {
      this.ollamaTemperatureValue.textContent = Number(this.ollamaTemperatureInput.value).toFixed(2);
      handler(this.getOllamaTemperature());
    });
  }

  /** Fires once the user releases the slider, for persisting the setting. */
  onOllamaTemperatureCommit(handler: (value: number) => void): void {
    this.ollamaTemperatureInput.addEventListener('change', () => handler(this.getOllamaTemperature()));
  }

  getOllamaContextLength(): number {
    return Number(this.ollamaContextLengthInput.value);
  }

  setOllamaContextLength(value: number): void {
    this.ollamaContextLengthInput.value = String(value);
  }

  onOllamaContextLengthChange(handler: (value: number) => void): void {
    this.ollamaContextLengthInput.addEventListener('change', () => handler(this.getOllamaContextLength()));
  }

  onChatMemoryClear(handler: () => void): void {
    this.chatMemoryClearButton.addEventListener('click', handler);
  }

  // -- Personas -----------------------------------------------------------

  getPersonaName(): string {
    return this.personaNameInput.value.trim();
  }

  setPersonaName(value: string): void {
    this.personaNameInput.value = value;
  }

  onPersonaSave(handler: () => void): void {
    this.personaSaveButton.addEventListener('click', handler);
  }

  // -- Long-term memory ----------------------------------------------------

  /**
   * Repopulates the persona-card dropdown in the Long-term Memory tab,
   * selecting `selectedId` if it's present. Selecting a card here drives which
   * card's memory is shown/edited; it does not change the active companion.
   */
  setMemoryPersonas(entries: { id: string; name: string }[], selectedId: string | null): void {
    this.memoryPersonaSelect.innerHTML = '';

    if (entries.length === 0) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'No saved personas';
      this.memoryPersonaSelect.appendChild(placeholder);
      this.memoryPersonaSelect.disabled = true;
      return;
    }

    this.memoryPersonaSelect.disabled = false;
    for (const entry of entries) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      this.memoryPersonaSelect.appendChild(option);
    }

    if (selectedId && entries.some((entry) => entry.id === selectedId)) {
      this.memoryPersonaSelect.value = selectedId;
    }
  }

  /** Id of the persona card currently selected in the Long-term Memory tab, or `null`. */
  getMemorySelectedPersonaId(): string | null {
    const value = this.memoryPersonaSelect.value;
    return value === PLACEHOLDER_VALUE ? null : value;
  }

  onMemoryPersonaChange(handler: (id: string | null) => void): void {
    this.memoryPersonaSelect.addEventListener('change', () => handler(this.getMemorySelectedPersonaId()));
  }

  getMemoryContent(): string {
    return this.memoryContentInput.value;
  }

  setMemoryContent(value: string): void {
    this.memoryContentInput.value = value;
  }

  /** Fires when the user commits an edit to the memory text (on blur / change). */
  onMemoryContentChange(handler: (value: string) => void): void {
    this.memoryContentInput.addEventListener('change', () => handler(this.getMemoryContent()));
  }

  onMemorySave(handler: () => void): void {
    this.memorySaveButton.addEventListener('click', handler);
  }

  /** Disables the save button (and reflects progress) while a summary is being generated. */
  setMemorySaving(saving: boolean): void {
    this.memorySaveButton.disabled = saving;
  }

  setMemoryStatus(message: string, kind: StatusKind = 'info'): void {
    this.showStatus(this.memoryStatusEl, message, kind);
  }

  // -- Display presets -----------------------------------------------------

  getDisplayPresetName(): string {
    return this.displayPresetNameInput.value.trim();
  }

  setDisplayPresetName(value: string): void {
    this.displayPresetNameInput.value = value;
  }

  onDisplayPresetSave(handler: () => void): void {
    this.displayPresetSaveButton.addEventListener('click', handler);
  }

  // -- Chat display settings --------------------------------------------

  getChatFontSize(): number {
    return Number(this.chatFontSizeInput.value);
  }

  setChatFontSize(px: number): void {
    this.chatFontSizeInput.value = String(px);
    this.chatFontSizeValue.textContent = String(px);
  }

  /** Fires continuously while dragging, for live preview. */
  onChatFontSizeChange(handler: (px: number) => void): void {
    this.chatFontSizeInput.addEventListener('input', () => {
      this.chatFontSizeValue.textContent = this.chatFontSizeInput.value;
      handler(this.getChatFontSize());
    });
  }

  /** Fires once the user releases the slider, for persisting the setting. */
  onChatFontSizeCommit(handler: (px: number) => void): void {
    this.chatFontSizeInput.addEventListener('change', () => handler(this.getChatFontSize()));
  }

  getChatFontColor(): string {
    return this.chatFontColorInput.value;
  }

  setChatFontColor(color: string): void {
    this.chatFontColorInput.value = color;
  }

  /** Fires continuously while picking a colour, for live preview. */
  onChatFontColorChange(handler: (color: string) => void): void {
    this.chatFontColorInput.addEventListener('input', () => handler(this.getChatFontColor()));
  }

  /** Fires once the colour picker is closed, for persisting the setting. */
  onChatFontColorCommit(handler: (color: string) => void): void {
    this.chatFontColorInput.addEventListener('change', () => handler(this.getChatFontColor()));
  }

  getChatHideTextBox(): boolean {
    return this.chatHideTextBoxInput.checked;
  }

  setChatHideTextBox(value: boolean): void {
    this.chatHideTextBoxInput.checked = value;
  }

  onChatHideTextBoxChange(handler: (value: boolean) => void): void {
    this.chatHideTextBoxInput.addEventListener('change', () => handler(this.getChatHideTextBox()));
  }

  // -- Voice / text-to-speech settings -----------------------------------

  getTtsEnabled(): boolean {
    return this.ttsEnabledInput.checked;
  }

  setTtsEnabled(value: boolean): void {
    this.ttsEnabledInput.checked = value;
  }

  onTtsEnabledChange(handler: (value: boolean) => void): void {
    this.ttsEnabledInput.addEventListener('change', () => handler(this.getTtsEnabled()));
  }

  getTtsProvider(): TtsProvider {
    return this.ttsProviderSelect.value as TtsProvider;
  }

  setTtsProvider(value: TtsProvider): void {
    this.ttsProviderSelect.value = value;
    this.updateTtsProviderVisibility(value);
  }

  onTtsProviderChange(handler: (value: TtsProvider) => void): void {
    this.ttsProviderSelect.addEventListener('change', () => {
      const provider = this.getTtsProvider();
      this.updateTtsProviderVisibility(provider);
      handler(provider);
    });
  }

  /** Shows only the selected provider's field group, hiding the rest. */
  updateTtsProviderVisibility(provider: TtsProvider): void {
    for (const [p, container] of this.ttsProviderFields) {
      container.hidden = p !== provider;
    }
  }

  /** Reads the on-screen fields for `provider` into a config object. */
  getTtsConfig(provider: TtsProvider): TtsProviderConfig {
    const i = this.ttsConfigInputs;
    switch (provider) {
      case 'openai':
        return {
          baseUrl: i.openai.baseUrl.value.trim(),
          apiKey: i.openai.apiKey.value.trim(),
          model: i.openai.model.value.trim(),
          voice: i.openai.voice.value.trim(),
          responseFormat: i.openai.format.value as TtsAudioFormat,
        } satisfies OpenAiTtsConfig;
      case 'elevenlabs':
        return {
          apiKey: i.elevenlabs.apiKey.value.trim(),
          model: i.elevenlabs.model.value.trim(),
          voice: i.elevenlabs.voice.value.trim(),
        } satisfies ElevenLabsTtsConfig;
      case 'fishaudio':
        return {
          apiKey: i.fishaudio.apiKey.value.trim(),
          model: i.fishaudio.model.value.trim(),
          voice: i.fishaudio.voice.value.trim(),
        } satisfies FishAudioTtsConfig;
      case 'cartesia':
        return {
          apiKey: i.cartesia.apiKey.value.trim(),
          model: i.cartesia.model.value.trim(),
          voice: i.cartesia.voice.value.trim(),
        } satisfies CartesiaTtsConfig;
      case 'google':
        return {
          apiKey: i.google.apiKey.value.trim(),
          language: i.google.language.value.trim(),
          voice: i.google.voice.value.trim(),
        } satisfies GoogleTtsConfig;
      case 'azure':
        return {
          apiKey: i.azure.apiKey.value.trim(),
          region: i.azure.region.value.trim(),
          voice: i.azure.voice.value.trim(),
        } satisfies AzureTtsConfig;
    }
  }

  /** Writes a provider's saved config into its on-screen fields. */
  setTtsConfig(provider: TtsProvider, config: TtsProviderConfig): void {
    const i = this.ttsConfigInputs;
    switch (provider) {
      case 'openai': {
        const c = config as OpenAiTtsConfig;
        i.openai.baseUrl.value = c.baseUrl;
        i.openai.apiKey.value = c.apiKey;
        i.openai.model.value = c.model;
        i.openai.voice.value = c.voice;
        i.openai.format.value = c.responseFormat;
        return;
      }
      case 'elevenlabs': {
        const c = config as ElevenLabsTtsConfig;
        i.elevenlabs.apiKey.value = c.apiKey;
        i.elevenlabs.model.value = c.model;
        i.elevenlabs.voice.value = c.voice;
        return;
      }
      case 'fishaudio': {
        const c = config as FishAudioTtsConfig;
        i.fishaudio.apiKey.value = c.apiKey;
        i.fishaudio.model.value = c.model;
        i.fishaudio.voice.value = c.voice;
        return;
      }
      case 'cartesia': {
        const c = config as CartesiaTtsConfig;
        i.cartesia.apiKey.value = c.apiKey;
        i.cartesia.model.value = c.model;
        i.cartesia.voice.value = c.voice;
        return;
      }
      case 'google': {
        const c = config as GoogleTtsConfig;
        i.google.apiKey.value = c.apiKey;
        i.google.language.value = c.language;
        i.google.voice.value = c.voice;
        return;
      }
      case 'azure': {
        const c = config as AzureTtsConfig;
        i.azure.apiKey.value = c.apiKey;
        i.azure.region.value = c.region;
        i.azure.voice.value = c.voice;
        return;
      }
    }
  }

  /** Fires when any field of any provider changes, passing which provider was edited. */
  onTtsConfigChange(handler: (provider: TtsProvider) => void): void {
    for (const [provider, container] of this.ttsProviderFields) {
      const inputs = container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select');
      inputs.forEach((el) => el.addEventListener('change', () => handler(provider)));
    }
  }

  getTtsSpeed(): number {
    return Number(this.ttsSpeedInput.value);
  }

  setTtsSpeed(value: number): void {
    this.ttsSpeedInput.value = String(value);
    this.ttsSpeedValue.textContent = value.toFixed(2);
  }

  /** Fires continuously while dragging, for live display of the value. */
  onTtsSpeedChange(handler: (value: number) => void): void {
    this.ttsSpeedInput.addEventListener('input', () => {
      this.ttsSpeedValue.textContent = Number(this.ttsSpeedInput.value).toFixed(2);
      handler(this.getTtsSpeed());
    });
  }

  /** Fires once the user releases the slider, for persisting the setting. */
  onTtsSpeedCommit(handler: (value: number) => void): void {
    this.ttsSpeedInput.addEventListener('change', () => handler(this.getTtsSpeed()));
  }

  onTtsTest(handler: () => void): void {
    this.ttsTestButton.addEventListener('click', handler);
  }

  setTtsStatus(message: string, kind: StatusKind = 'info'): void {
    this.showStatus(this.ttsStatusEl, message, kind);
  }
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Expected element #${id} to exist in the document.`);
  }
  return el as T;
}

function requireQuery<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Expected element matching "${selector}" to exist in the document.`);
  }
  return el;
}
