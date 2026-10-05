import { createContext, useContext, type ReactNode } from 'react';

export type DisplayText = (
  message: string,
  values?: Record<string, string | number | undefined>,
) => string;

export function interpolate(message: string, values?: Record<string, string | number | undefined>) {
  return message.replace(/\{(\w+)\}/g, (token, name: string) =>
    values && Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}

// A presentation-only boundary. Hosts own language preferences; viewers retain their state.
const DisplayTextContext = createContext<{ t: DisplayText; locale: string }>({
  t: interpolate,
  locale: 'en',
});

export function DisplayTextProvider({
  value,
  children,
}: {
  value: { t: DisplayText; locale: string };
  children: ReactNode;
}) {
  return <DisplayTextContext.Provider value={value}>{children}</DisplayTextContext.Provider>;
}

export const useDisplayText = () => useContext(DisplayTextContext);
