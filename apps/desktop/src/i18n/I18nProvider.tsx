import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DisplayTextProvider } from '@industrial-agent-harness/viewer-builtin/text';
import {
  normalizePreference,
  readPreference,
  savePreference,
  systemLocale,
  translate,
  type LanguagePreference,
} from './core';

const LanguageContext = createContext<{
  preference: LanguagePreference;
  setPreference: (value: LanguagePreference) => void;
}>({ preference: 'system', setPreference: () => {} });

function initialPreference() {
  try {
    return readPreference(localStorage);
  } catch {
    return 'system' as const;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setLanguage] = useState(initialPreference);
  const [system, setSystem] = useState(() => systemLocale(navigator.languages));
  const locale = preference === 'system' ? system : preference;
  useEffect(() => {
    const changed = () => setSystem(systemLocale(navigator.languages));
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const text = useMemo(
    () => ({
      locale,
      t: (message: string, values?: Record<string, string | number | undefined>) =>
        translate(locale, message, values),
    }),
    [locale],
  );
  const language = useMemo(
    () => ({
      preference,
      setPreference(value: LanguagePreference) {
        const next = normalizePreference(value);
        try {
          savePreference(localStorage, next);
        } catch {}
        setLanguage(next);
      },
    }),
    [preference],
  );
  return (
    <LanguageContext.Provider value={language}>
      <DisplayTextProvider value={text}>{children}</DisplayTextProvider>
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
