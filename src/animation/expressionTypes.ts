/**
 * VRM 1.0 standard emotion expression presets (excluding visemes/look-at/blink),
 * shared by the `[emotion:...]` and `[demeanor:...]` tag syntax and the
 * developer panel.
 */
export const EMOTIONS = ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised'] as const;
export type EmotionName = (typeof EMOTIONS)[number];

export function isEmotionName(value: string): value is EmotionName {
  return (EMOTIONS as readonly string[]).includes(value);
}

/** One-shot gesture animations triggerable via `[action:...]`. */
export const ACTIONS = ['laugh', 'wink'] as const;
export type ActionName = (typeof ACTIONS)[number];

export function isActionName(value: string): value is ActionName {
  return (ACTIONS as readonly string[]).includes(value);
}
