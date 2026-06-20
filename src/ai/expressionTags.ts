/**
 * Parses the companion's `[action:laugh]` / `[demeanor:happy]` / `[emotion:happy]`
 * tag syntax out of chat replies. Tags are stripped from the text shown to
 * the user and spoken by TTS, and dispatched to the expression controller.
 */

export type TagKind = 'action' | 'demeanor' | 'emotion';

export interface ParsedTag {
  kind: TagKind;
  value: string;
}

// Values cover both built-in names and uploaded custom-animation ids, which
// may contain digits, hyphens, and underscores (e.g. `[action:wave-hello]`).
const TAG_PATTERN = /\[(action|demeanor|emotion):([a-zA-Z0-9_-]+)\]/g;

/** Longest tag we hold a partial buffer for while streaming (custom ids can be longer). */
const MAX_PARTIAL_TAG_LENGTH = 48;

/** Removes all recognized tags from `text`, returning the cleaned text and the tags found. */
export function extractTags(text: string): { text: string; tags: ParsedTag[] } {
  const tags: ParsedTag[] = [];
  const cleaned = text.replace(TAG_PATTERN, (_match, kind: string, value: string) => {
    tags.push({ kind: kind.toLowerCase() as TagKind, value: value.toLowerCase() });
    return '';
  });
  return { text: cleaned, tags };
}

/**
 * Incrementally strips tags from a token stream. Complete tags are removed
 * and reported via `tags`; a trailing fragment that could be the start of a
 * tag (e.g. `"[emo"`) is held back until either it completes or it grows too
 * long to plausibly be a tag.
 */
export class TagStreamFilter {
  private buffer = '';

  push(chunk: string): { text: string; tags: ParsedTag[] } {
    this.buffer += chunk;

    const { text: withoutTags, tags } = extractTags(this.buffer);
    this.buffer = withoutTags;

    const openIndex = this.buffer.lastIndexOf('[');
    if (openIndex === -1) {
      const text = this.buffer;
      this.buffer = '';
      return { text, tags };
    }

    const tail = this.buffer.slice(openIndex);
    if (tail.length <= MAX_PARTIAL_TAG_LENGTH) {
      const text = this.buffer.slice(0, openIndex);
      this.buffer = tail;
      return { text, tags };
    }

    // Too long to be a tag — release it as plain text.
    const text = this.buffer;
    this.buffer = '';
    return { text, tags };
  }

  /** Returns any held-back text once streaming is done. */
  flush(): string {
    const text = this.buffer;
    this.buffer = '';
    return text;
  }
}
