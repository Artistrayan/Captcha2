import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  LanguageCode,
  LanguageMeta,
  SUPPORTED_LANGUAGES,
  translations,
} from './translations.ts';
import { Globe, Check, ChevronDown } from 'lucide-react';

interface LanguageContextType {
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  t: (key: string) => string;
  meta: LanguageMeta;
  languages: LanguageMeta[];
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default language is English ('en') as requested
  const [lang, setLangState] = useState<LanguageCode>(() => {
    const saved = localStorage.getItem('shieldcaptcha_lang_v2') as LanguageCode;
    if (saved && SUPPORTED_LANGUAGES.some(l => l.code === saved)) {
      return saved;
    }
    return 'en';
  });

  const meta = SUPPORTED_LANGUAGES.find(l => l.code === lang) || SUPPORTED_LANGUAGES[0];

  const setLang = (newLang: LanguageCode) => {
    setLangState(newLang);
    localStorage.setItem('shieldcaptcha_lang_v2', newLang);
  };

  useEffect(() => {
    // Sync document direction and lang attribute
    document.documentElement.dir = meta.dir;
    document.documentElement.lang = meta.code;
  }, [meta]);

  const t = (key: string): string => {
    const langDict = translations[lang];
    if (langDict && langDict[key]) {
      return langDict[key];
    }
    // Fallback to English
    return translations.en[key] || key;
  };

  return (
    <LanguageContext.Provider
      value={{
        lang,
        setLang,
        t,
        meta,
        languages: SUPPORTED_LANGUAGES.filter(l => l.code === 'en' || l.code === 'fa'),
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useI18n must be used within a LanguageProvider');
  }
  return context;
}

export const LanguageSelector: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { lang, setLang, meta, languages, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 text-xs font-medium transition-all shadow-sm cursor-pointer hover:border-emerald-500/50"
        title={t('selectLanguage')}
      >
        <Globe className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-base leading-none">{meta.flag}</span>
        <span className="font-mono text-xs hidden sm:inline">{meta.nativeName}</span>
        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute ${meta.dir === 'rtl' ? 'left-0' : 'right-0'} mt-1.5 w-52 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl z-50 overflow-hidden py-1.5 backdrop-blur animate-in fade-in zoom-in-95 duration-100`}
        >
          <div className="px-3 py-1.5 text-[10px] font-mono text-slate-400 uppercase tracking-wider border-b border-slate-800/80 mb-1 flex items-center justify-between">
            <span>{t('selectLanguage')}</span>
            <span className="text-[9px] text-emerald-400">2 Languages</span>
          </div>

          <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/40">
            {languages.map(item => {
              const isSelected = item.code === lang;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setLang(item.code as LanguageCode);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-xs flex items-center justify-between transition-colors text-left cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-500/10 text-emerald-400 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base leading-none">{item.flag}</span>
                    <div className="flex flex-col">
                      <span className="font-medium text-xs text-slate-200">{item.nativeName}</span>
                      <span className="text-[10px] text-slate-400">{item.name}</span>
                    </div>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
