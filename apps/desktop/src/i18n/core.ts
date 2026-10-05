import { messages } from './messages.ts';
import { viewerMessages } from '@industrial-agent-harness/viewer-builtin/text-messages';

export type Locale = 'en' | 'zh-CN';
export type LanguagePreference = Locale | 'system';
export const languageStorageKey = 'ia-language';

export function normalizePreference(value: unknown): LanguagePreference {
  return value === 'en' || value === 'zh-CN' ? value : 'system';
}

export function systemLocale(languages: readonly string[]): Locale {
  return /^zh(?:-|$)/i.test(languages[0] || '') ? 'zh-CN' : 'en';
}

export function readPreference(storage: Pick<Storage, 'getItem'>): LanguagePreference {
  try {
    return normalizePreference(storage.getItem(languageStorageKey));
  } catch {
    return 'system';
  }
}

export function savePreference(storage: Pick<Storage, 'setItem'>, value: LanguagePreference) {
  try {
    storage.setItem(languageStorageKey, value);
  } catch {
    // An unavailable preference store must not prevent switching the current UI.
  }
}

export function translate(
  locale: Locale,
  message: string,
  values?: Record<string, string | number | undefined>,
): string {
  const prefix = message.startsWith('Error: ') ? 'Error: ' : '';
  const key = prefix ? message.slice(prefix.length) : message;
  const entry = messages[key] ?? viewerMessages[key];
  const result = entry?.[locale === 'zh-CN' ? 1 : 0] ?? key;
  return (
    prefix +
    result.replace(/\{(\w+)\}/g, (token, name: string) =>
      values && Object.hasOwn(values, name) ? String(values[name]) : token,
    )
  );
}
