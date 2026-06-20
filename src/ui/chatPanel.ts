const CUSTOM_FONT_FAMILY = 'CompanionChatFont';

/**
 * The bottom-of-screen chat bar and the (initially hidden) response display
 * above it. The response box has no visible background — only the text
 * itself is rendered, in a font/size/colour the user can customize via
 * settings.
 */
export class ChatPanel {
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly responseEl: HTMLElement;

  private activeFont: FontFace | null = null;
  private hideTextBox = false;

  constructor() {
    this.form = requireElement<HTMLFormElement>('chat-form');
    this.input = requireElement<HTMLInputElement>('chat-input');
    this.sendButton = requireElement<HTMLButtonElement>('chat-send-btn');
    this.responseEl = requireElement<HTMLElement>('chat-response');
  }

  /** Registers the handler invoked when the user submits a chat message. */
  onSend(handler: (message: string) => void): void {
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const message = this.input.value.trim();
      if (!message) return;

      this.input.value = '';
      handler(message);
    });
  }

  /** Disables/enables the input and send button while a response is in flight. */
  setSending(sending: boolean): void {
    this.input.disabled = sending;
    this.sendButton.disabled = sending;
  }

  /** Replaces the response text outright. */
  setResponseText(text: string): void {
    this.responseEl.textContent = text;
    this.responseEl.hidden = this.hideTextBox || text.length === 0;
  }

  /** Appends a streamed token to the response text. */
  appendResponseToken(token: string): void {
    this.responseEl.textContent = (this.responseEl.textContent ?? '') + token;
    this.responseEl.hidden = this.hideTextBox;
    this.responseEl.scrollTop = this.responseEl.scrollHeight;
  }

  /** Hides and clears the response display. */
  clearResponse(): void {
    this.responseEl.textContent = '';
    this.responseEl.hidden = true;
  }

  /** Hides (or restores) the response text box, e.g. when relying on voice playback. */
  setHideTextBox(hide: boolean): void {
    this.hideTextBox = hide;
    if (hide) {
      this.responseEl.hidden = true;
    } else {
      this.responseEl.hidden = (this.responseEl.textContent ?? '').length === 0;
    }
  }

  setFontSize(px: number): void {
    this.responseEl.style.fontSize = `${px}px`;
  }

  setColor(color: string): void {
    this.responseEl.style.color = color;
  }

  /**
   * Loads a font file and applies it to the response text via the FontFace
   * API. Pass `null` to remove any custom font and fall back to the default.
   */
  async applyCustomFont(file: File | null): Promise<void> {
    if (this.activeFont) {
      document.fonts.delete(this.activeFont);
      this.activeFont = null;
    }

    if (!file) {
      this.responseEl.style.fontFamily = '';
      return;
    }

    const buffer = await file.arrayBuffer();
    const fontFace = new FontFace(CUSTOM_FONT_FAMILY, buffer);
    await fontFace.load();

    document.fonts.add(fontFace);
    this.activeFont = fontFace;
    this.responseEl.style.fontFamily = `"${CUSTOM_FONT_FAMILY}"`;
  }
}

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Expected element #${id} to exist in the document.`);
  }
  return el as T;
}
