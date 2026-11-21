import type { VoiceInfo } from '../shared/types';

export interface RemoteLanguageDetection {
  readonly lang: string;
  readonly confidence: number;
  readonly isReliable: boolean;
}

export interface DetectLanguageOptions {
  readonly remoteDetect?: (text: string) => Promise<RemoteLanguageDetection | null>;
  readonly fallbackLang?: string;
  readonly preferFastLocal?: boolean;
}

const LANGUAGE_STOPWORDS: Readonly<Record<string, readonly string[]>> = {
  es: [
    'el',
    'la',
    'los',
    'las',
    'de',
    'que',
    'en',
    'para',
    'con',
    'una',
    'por',
    'este',
    'esta',
    'como',
    'voz',
    'texto',
  ],
  en: [
    'the',
    'and',
    'for',
    'that',
    'this',
    'with',
    'from',
    'have',
    'are',
    'reads',
    'text',
    'selected',
    'browser',
  ],
  pt: ['que', 'não', 'para', 'com', 'uma', 'você', 'isso', 'texto', 'como'],
  fr: ['les', 'des', 'une', 'pour', 'dans', 'avec', 'cette', 'vous', 'est'],
  de: ['der', 'die', 'das', 'und', 'für', 'mit', 'nicht', 'eine', 'ist'],
  it: [
    'che',
    'non',
    'per',
    'con',
    'una',
    'sono',
    'questo',
    'questa',
    'della',
    'anche',
    'testo',
    'come',
  ],
};

const WORD_TO_LANGS: ReadonlyMap<string, readonly string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const [lang, stopwords] of Object.entries(LANGUAGE_STOPWORDS)) {
    for (const word of stopwords) {
      const list = index.get(word);
      if (list) {
        list.push(lang);
      } else {
        index.set(word, [lang]);
      }
    }
  }
  return index;
})();

const SPANISH_CHARS_RE = /[ñáéíóúü¿¡]/i;
const PORTUGUESE_CHARS_RE = /[ãõç]/i;
const FRENCH_CHARS_RE = /[àâçèêëîïôùûœ]/i;
const GERMAN_CHARS_RE = /[äöüß]/i;
const ITALIAN_CHARS_RE = /[ìò]/i;
const WORD_TOKEN_RE = /[a-záéíóúüñãõçàâèêëîïôùûœäößì]+/gi;
const MAX_HEURISTIC_WORDS = 64;

/** Normalizes a language tag to lowercase hyphenated format (e.g. `'es_MX'` -> `'es-mx'`). */
export function normalizeLangCode(lang: string): string {
  return lang.trim().toLowerCase().replace(/_/g, '-');
}

/** Extracts the primary ISO-639-1 subtag from a BCP-47 tag (e.g. `'es-MX'` -> `'es'`). */
export function getPrimaryLang(lang: string): string {
  const normalized = normalizeLangCode(lang);
  return normalized.split('-')[0] || 'en';
}

function scoreHeuristic(
  text: string,
  fallbackLang: string
): { readonly lang: string; readonly bestScore: number; readonly margin: number } {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = { es: 0, en: 0, pt: 0, fr: 0, de: 0, it: 0 };

  WORD_TOKEN_RE.lastIndex = 0;
  let matchedWords = 0;
  let match: RegExpExecArray | null;
  while (matchedWords < MAX_HEURISTIC_WORDS && (match = WORD_TOKEN_RE.exec(lower)) !== null) {
    const word = match[0];
    if (word.length < 2) continue;
    matchedWords += 1;
    const langs = WORD_TO_LANGS.get(word);
    if (langs) {
      for (let i = 0; i < langs.length; i += 1) {
        const lang = langs[i]!;
        scores[lang] = (scores[lang] ?? 0) + 2;
      }
    }
  }

  if (matchedWords === 0) {
    return { lang: getPrimaryLang(fallbackLang), bestScore: 0, margin: 0 };
  }

  if (SPANISH_CHARS_RE.test(text)) scores.es = (scores.es ?? 0) + 3;
  if (PORTUGUESE_CHARS_RE.test(text)) scores.pt = (scores.pt ?? 0) + 3;
  if (FRENCH_CHARS_RE.test(text)) scores.fr = (scores.fr ?? 0) + 2;
  if (GERMAN_CHARS_RE.test(text)) scores.de = (scores.de ?? 0) + 3;
  if (ITALIAN_CHARS_RE.test(text)) scores.it = (scores.it ?? 0) + 3;

  let bestLang = getPrimaryLang(fallbackLang);
  let bestScore = 0;
  let secondScore = 0;

  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestLang = lang;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  return { lang: bestLang, bestScore, margin: bestScore - secondScore };
}

/**
 * Fast synchronous stopword and diacritic heuristic for offline language detection.
 * @param text Sample text to inspect.
 * @param fallbackLang Fallback language tag when no markers match.
 */
export function detectLanguageHeuristic(text: string, fallbackLang = 'en'): string {
  return scoreHeuristic(text, fallbackLang).lang;
}

/**
 * Detects the language of `text`, skipping remote IPC roundtrips when `preferFastLocal`
 * is enabled and local heuristic confidence is high (`score >= 6` and `margin >= 4`).
 */
export async function detectLanguage(
  text: string,
  options: DetectLanguageOptions = {}
): Promise<string> {
  const fallbackLang = normalizeLangCode(options.fallbackLang ?? 'en') || 'en';
  const sample = text.trim().slice(0, 600);
  if (!sample) {
    return fallbackLang;
  }

  if (options.preferFastLocal) {
    const local = scoreHeuristic(sample, fallbackLang);
    if (local.bestScore >= 6 && local.margin >= 4) {
      return local.lang;
    }
  }

  if (options.remoteDetect) {
    try {
      const remote = await options.remoteDetect(sample);
      if (remote && remote.lang && remote.isReliable && remote.confidence >= 50) {
        return normalizeLangCode(remote.lang) || fallbackLang;
      }
    } catch {
      // Fall back to local heuristic when background detection is unavailable.
    }
  }

  return detectLanguageHeuristic(sample, fallbackLang);
}

const ROBOTIC_VOICE_RE = /espeak|festival|mbrola|speech-dispatcher|demonic|whisper|\+/i;
const NATURAL_VOICE_RE =
  /natural|neural|online|enhanced|premium|wavenet|studio|siri|claude|dalia|elvira|helena|sabina|paulina|monica|samantha|ava|aria|jenny|hfc|lessac|sharvard|davefx|ald/i;
const QUALITY_VENDOR_RE = /google|microsoft|apple/i;

function scoreVoiceQuality(voice: VoiceInfo, normalizedLang: string, primaryLang: string): number {
  const voiceLang = normalizeLangCode(voice.lang);
  const voicePrimary = getPrimaryLang(voice.lang);
  let score = 0;

  if (voiceLang === normalizedLang) {
    score += 40;
  } else if (voicePrimary === primaryLang) {
    score += 30;
  } else {
    return -1000;
  }

  if (voice.engine === 'piper-neural') {
    score += 60;
    if (voice.isDefault) score += 10;
  }

  const label = `${voice.name} ${voice.id}`;
  if (NATURAL_VOICE_RE.test(label)) score += 35;
  if (QUALITY_VENDOR_RE.test(label)) score += 15;
  if (ROBOTIC_VOICE_RE.test(label)) score -= 50;
  if (voice.isLocal && !ROBOTIC_VOICE_RE.test(label)) score += 5;

  return score;
}

/**
 * Selects the best matching voice for `lang`, honoring explicit user preferences first
 * and ranking neural/natural voices above robotic eSpeak/Speech-Dispatcher voices.
 */
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

  let bestVoice: VoiceInfo | undefined;
  let bestScore = -Infinity;

  for (const voice of voices) {
    const score = scoreVoiceQuality(voice, normalizedLang, primaryLang);
    if (score > bestScore && score > -500) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  return bestVoice ?? voices.find((v) => v.isDefault) ?? voices[0];
}
