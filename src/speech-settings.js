export const SPEECH_SETTING_DEFINITIONS = Object.freeze({
  wordCount: Object.freeze({ defaultValue: 5, min: 1, max: 10, step: 1 }),
  cooldownMs: Object.freeze({ defaultValue: 300, min: 50, max: 2000, step: 50 }),
});

export const DEFAULT_SPEECH_SETTINGS = Object.freeze(
  Object.fromEntries(
    Object.entries(SPEECH_SETTING_DEFINITIONS).map(([key, definition]) => [
      key,
      definition.defaultValue,
    ]),
  ),
);

export const DEFAULT_MANUAL_MODE = false;
