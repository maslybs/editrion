type Dict = Record<string, string>;

type Locale = 'en' | 'uk' | 'es' | 'fr' | 'ja' | 'de';

const dictionaries: Record<string, Dict> = {
  en: {},
  uk: {},
  es: {},
  fr: {},
  ja: {},
  de: {},
};

let currentLocale: Locale = 'en';

function loadDictionaries() {
  // Static import to avoid async complexity; Vite supports JSON imports, but keeping
  // translations co-located and small here for simplicity.
  // These will be replaced at runtime by applyTranslations using data-i18n.
}

export function initI18n() {
  loadDictionaries();
  const saved = localStorage.getItem('editrion.locale');
  const nav = (navigator.language || 'en').toLowerCase();
  const candidates: Locale[] = ['uk', 'es', 'fr', 'ja', 'de', 'en'];
  const guess: Locale = (['en', 'uk', 'es', 'fr', 'ja', 'de'] as const).includes((saved as any))
    ? (saved as Locale)
    : (candidates.find(c => nav.startsWith(c)) || 'en');
  setLocale(guess);
}

export function setLocale(locale: Locale) {
  currentLocale = locale;
  localStorage.setItem('editrion.locale', locale);
  document.documentElement.lang = locale;
  applyTranslations();
  const select = document.getElementById('lang-select') as HTMLSelectElement | null;
  if (select) select.value = locale;
}

export function getLocale() {
  return currentLocale;
}

export function registerDictionaries(locale: Locale, dict: Dict) {
  dictionaries[locale] = dict;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = dictionaries[currentLocale] || {};
  let val = dict[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return val;
}

// Apply translations to any elements marked up in the DOM
export function applyTranslations(root: Document | HTMLElement = document) {
  // Text content
  root.querySelectorAll<HTMLElement>('[data-i18n]')
    .forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });

  // Attribute translations: data-i18n-attr="placeholder:search.placeholder;title:..."
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]')
    .forEach(el => {
      const spec = el.getAttribute('data-i18n-attr') || '';
      spec.split(';').map(s => s.trim()).filter(Boolean).forEach(pair => {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (attr && key) {
          const val = t(key);
          // @ts-ignore
          el.setAttribute(attr, val);
        }
      });
    });

  // Document title
  const titleKey = (document.querySelector('title')?.getAttribute('data-i18n')) || '';
  if (titleKey) {
    document.title = t(titleKey);
  }
}
