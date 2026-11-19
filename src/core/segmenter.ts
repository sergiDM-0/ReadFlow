const PROTECTED_DOT_TOKEN = '\uE000';
const DEFAULT_MAX_CHUNK_CHARS = 220;

const ABBREVIATION_RE =
  /\b(Sr|Sra|Srta|Dr|Dra|Prof|Ing|Lic|Arq|Mr|Mrs|Ms|St|Jr|vs|etc|fig|vol|no|núm|ej|p\.ej|e\.g|i\.e)\./gi;
const SEMVER_RE = /\b(v?\d+(?:\.\d+)+)\b/gi;
const DECIMAL_RE = /(\d)\.(\d)/g;

function maskProtectedDots(text: string): string {
  return text
    .replace(SEMVER_RE, (match) => match.replace(/\./g, PROTECTED_DOT_TOKEN))
    .replace(DECIMAL_RE, `$1${PROTECTED_DOT_TOKEN}$2`)
    .replace(ABBREVIATION_RE, (match) => match.replace(/\./g, PROTECTED_DOT_TOKEN));
}

function unmaskProtectedDots(text: string): string {
  return text.replaceAll(PROTECTED_DOT_TOKEN, '.');
}

function splitBySentenceBoundary(maskedLine: string, lang: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const normalizedLang = lang.trim().replace(/_/g, '-') || 'en';
      const segmenter = new Intl.Segmenter(normalizedLang, { granularity: 'sentence' });
      const pieces: string[] = [];
      for (const seg of segmenter.segment(maskedLine)) {
        const trimmed = seg.segment.trim();
        if (trimmed) {
          pieces.push(trimmed);
        }
      }
      if (pieces.length > 0) {
        return pieces;
      }
    } catch {
      // Fall back to punctuation regex when locale string is invalid.
    }
  }

  return maskedLine
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) {
    return [sentence];
  }

  const clauses = sentence.split(/(?<=[,;:])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
  };

  for (const clause of clauses) {
    if (clause.length > maxChars) {
      flush();
      const words = clause.split(/\s+/);
      let wordBuf = '';
      for (const word of words) {
        const candidate = wordBuf ? `${wordBuf} ${word}` : word;
        if (candidate.length > maxChars && wordBuf) {
          chunks.push(wordBuf);
          wordBuf = word;
        } else {
          wordBuf = candidate;
        }
      }
      if (wordBuf) {
        chunks.push(wordBuf);
      }
      continue;
    }

    const candidate = current ? `${current} ${clause}` : clause;
    if (candidate.length > maxChars && current) {
      flush();
      current = clause;
    } else {
      current = candidate;
    }
  }

  flush();
  return chunks;
}

export function segmentSentences(
  text: string,
  lang = 'en',
  maxChunkChars = DEFAULT_MAX_CHUNK_CHARS
): string[] {
  if (!text || !text.trim()) {
    return [];
  }

  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const results: string[] = [];
  for (const line of lines) {
    const masked = maskProtectedDots(line);
    const sentences = splitBySentenceBoundary(masked, lang);
    for (const maskedSentence of sentences) {
      const restored = unmaskProtectedDots(maskedSentence);
      results.push(...splitLongSentence(restored, maxChunkChars));
    }
  }

  return results;
}
