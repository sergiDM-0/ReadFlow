import type { VoiceInfo } from '../shared/types';

export interface RemoteLanguageDetection {
  readonly lang: string;
  readonly confidence: number;
  readonly isReliable: boolean;
}

export interface DetectLanguageOptions {
  readonly remoteDetect?: (text: string) => Promise<RemoteLanguageDetection | null>;
  readonly fallbackLang?: string;
}

const LANGUAGE_STOPWORDS: Readonly<Record<string, readonly string[]>> = {
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'en', 'para', 'con', 'una', 'por', 'este', 'esta', 'como', 'voz', 'texto'],
  en: ['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'reads', 'text', 'selected', 'browser'],
  pt: ['que', 'não', 'para', 'com', 'uma', 'você', 'isso', 'texto', 'como'],
  fr: ['les', 'des', 'une', 'pour', 'dans', 'avec', 'cette', 'vous', 'est'],
  de: ['der', 'die', 'das', 'und', 'für', 'mit', 'nicht', 'eine', 'ist'],
};

const SPANISH_CHARS_RE = /[ñáéíóúü¿¡]/i;
const PORTUGUESE_CHARS_RE = /[ãõç]/i;
const FRENCH_CHARS_RE = /[àâçèêëîïôùûœ]/i;
const GERMAN_CHARS_RE = /[äöüß]/i;

export function normalizeLangCode(lang: string): string {
  return lang.trim().toLowerCase().replace(/_/g, '-');
}

export function getPrimaryLang(lang: string): string {
  const normalized = normalizeLangCode(lang);
  return normalized.split('-')[0] || 'en';
}

export function detectLanguageHeuristic(text: string, fallbackLang = 'en'): string {
  const words = text
    .toLowerCase()
    .split(/[^a-záéíóúüñãõçàâèêëîïôùûœäöß]+/i)
    .filter((w) => w.length >= 2);

  if (words.length === 0) {
    return getPrimaryLang(fallbackLang);
  }

  const scores: Record<string, number> = { es: 0, en: 0, pt: 0, fr: 0, de: 0 };

  for (const word of words) {
    for (const [lang, stopwords] of Object.entries(LANGUAGE_STOPWORDS)) {
      if (stopwords.includes(word)) {
        scores[lang] = (scores[lang] ?? 0) + 2;
      }
    }
  }

  if (SPANISH_CHARS_RE.test(text)) scores.es = (scores.es ?? 0) + 3;
  if (PORTUGUESE_CHARS_RE.test(text)) scores.pt = (scores.pt ?? 0) + 3;
  if (FRENCH_CHARS_RE.test(text)) scores.fr = (scores.fr ?? 0) + 2;
  if (GERMAN_CHARS_RE.test(text)) scores.de = (scores.de ?? 0) + 3;

  let bestLang = getPrimaryLang(fallbackLang);
  let bestScore = 0;

  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }

  return bestLang;
}

export async function detectLanguage(
  text: string,
  options: DetectLanguageOptions = {}
): Promise<string> {
  const fallbackLang = options.fallbackLang ?? 'en';
  const sample = text.trim().slice(0, 600);
  if (!sample) {
    return fallbackLang;
  }

  if (options.remoteDetect) {
    try {
      const remote = await options.remoteDetect(sample);
      if (remote && remote.lang && remote.isReliable && remote.confidence >= 50) {
        return remote.lang;
      }
    } catch {
      // Fall back to local heuristic when background detection is unavailable.
    }
  }

  return detectLanguageHeuristic(sample, fallbackLang);
}

export function selectPreferredVoice(
  voices: readonly VoiceInfo[],
  lang: string,
  voicePreferences: Readonly<Record<string, string>>
): VoiceInfo | undefined {
  if (voices.length === 0) {
    return undefined;
  }

  const normalizedLang = normalizeLangCode(lang);
  const primaryLang = getPrimaryLang(lang);

  const preferredId = voicePreferences[normalizedLang] ?? voicePreferences[primaryLang];
  if (preferredId) {
    const exactPref = voices.find((v) => v.id === preferredId);
    if (exactPref) {
      return exactPref;
    }
  }

  const exactLocal = voices.find((v) => v.isLocal && normalizeLangCode(v.lang) === normalizedLang);
  if (exactLocal) return exactLocal;

  const primaryLocal = voices.find((v) => v.isLocal && getPrimaryLang(v.lang) === primaryLang);
  if (primaryLocal) return primaryLocal;

  const primaryAny = voices.find((v) => getPrimaryLang(v.lang) === primaryLang);
  if (primaryAny) return primaryAny;

  return voices.find((v) => v.isDefault) ?? voices[0];
}
