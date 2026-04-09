import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './en.json';
import es from './es.json';
import fr from './fr.json';
import de from './de.json';
import ar from './ar.json';
import ja from './ja.json';
import zh from './zh.json';
import ko from './ko.json';
import pt from './pt.json';
import ru from './ru.json';

export const supportedLanguages = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Espanol' },
  { value: 'fr', label: 'Francais' },
  { value: 'de', label: 'Deutsch' },
  { value: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
  { value: 'ja', label: '\u65e5\u672c\u8a9e' },
  { value: 'zh', label: '\u4e2d\u6587' },
  { value: 'ko', label: '\ud55c\uad6d\uc5b4' },
  { value: 'pt', label: 'Portugues' },
  { value: 'ru', label: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' },
] as const;

export const RTL_LANGUAGES = ['ar', 'he', 'fa'];

const resources = {
  en: { translation: en },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  ar: { translation: ar },
  ja: { translation: ja },
  zh: { translation: zh },
  ko: { translation: ko },
  pt: { translation: pt },
  ru: { translation: ru },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'dataset-builder-language',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
