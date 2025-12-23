/**
 * i18n Utilities
 * Helper functions for internationalization
 */

import zhTW from './zh-tw.json';
import en from './en.json';

export type Locale = 'zh-tw' | 'en';

const translations = {
  'zh-tw': zhTW,
  'en': en,
} as const;

/**
 * Get the current locale from the URL
 */
export function getCurrentLocale(url: URL): Locale {
  const pathname = url.pathname;
  
  // Check if path starts with /en/
  if (pathname.startsWith('/en/') || pathname === '/en') {
    return 'en';
  }
  
  // Default to zh-tw
  return 'zh-tw';
}

/**
 * Get translations for a specific locale
 */
export function getTranslations(locale: Locale) {
  return translations[locale];
}

/**
 * Get a specific translation by key path (e.g., 'nav.home')
 */
export function t(locale: Locale, keyPath: string): string {
  const keys = keyPath.split('.');
  let value: any = translations[locale];
  
  for (const key of keys) {
    if (value && typeof value === 'object') {
      value = value[key];
    } else {
      return keyPath; // Return the key if translation not found
    }
  }
  
  return typeof value === 'string' ? value : keyPath;
}

/**
 * Get the localized path for a given path
 */
export function getLocalizedPath(path: string, locale: Locale): string {
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // For default locale (zh-tw), don't add prefix
  if (locale === 'zh-tw') {
    return `/${cleanPath}`;
  }
  
  // For other locales, add prefix
  return `/${locale}/${cleanPath}`;
}

/**
 * Get alternate language path for the current page
 */
export function getAlternatePath(currentPath: string, currentLocale: Locale): string {
  const targetLocale: Locale = currentLocale === 'zh-tw' ? 'en' : 'zh-tw';
  
  // Remove current locale prefix if it exists
  let cleanPath = currentPath;
  if (currentPath.startsWith('/en/')) {
    cleanPath = currentPath.replace('/en/', '/');
  } else if (currentPath.startsWith('/en')) {
    cleanPath = currentPath.replace('/en', '/');
  }
  
  return getLocalizedPath(cleanPath, targetLocale);
}

/**
 * Get language display name
 */
export function getLanguageName(locale: Locale): string {
  return locale === 'zh-tw' ? '繁體中文' : 'English';
}

/**
 * Get alternate language name
 */
export function getAlternateLanguageName(currentLocale: Locale): string {
  return currentLocale === 'zh-tw' ? 'English' : '繁體中文';
}
