const PROTECTED_DOT_TOKEN = '\uE000';
const DEFAULT_MAX_CHUNK_CHARS = 220;
const DEFAULT_STREAMING_FIRST_CHARS = 75;
const DEFAULT_STREAMING_SECOND_CHARS = 140;
const DEFAULT_MIN_LEAD_CHARS = 18;

export interface StreamingSegmentOptions {
  readonly firstChunkMaxChars?: number;
  readonly secondChunkMaxChars?: number;
  readonly maxChunkChars?: number;
  readonly minLeadChars?: number;
}

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

function splitLeadFragment(
  text: string,
  maxChars: number,
  minLeadChars: number
): readonly [string, string] | null {
  if (text.length <= maxChars) {
    return null;
  }

  const windowSlice = text.slice(0, maxChars + 1);

  // Prefer natural clause punctuation (comma, semicolon, colon, dash) within [minLeadChars, maxChars].
  const clauseRegex = /[,;:\u2014\u2013]\s+/g;
  let bestClauseEnd = -1;
  let match: RegExpExecArray | null = clauseRegex.exec(windowSlice);
  while (match !== null) {
    const endPos = match.index + 1;
    if (endPos >= minLeadChars && endPos <= maxChars) {
      bestClauseEnd = endPos;
    }
    match = clauseRegex.exec(windowSlice);
  }

  if (bestClauseEnd > 0) {
    const lead = text.slice(0, bestClauseEnd).trim();
    const rest = text.slice(bestClauseEnd).trim();
    if (lead && rest) {
      return [lead, rest];
    }
  }

  // Fall back to the last word boundary within maxChars.
  const spaceIdx = windowSlice.lastIndexOf(' ');
  if (spaceIdx >= minLeadChars) {
    const lead = text.slice(0, spaceIdx).trim();
    const rest = text.slice(spaceIdx + 1).trim();
    if (lead && rest) {
      return [lead, rest];
    }
  }

  return null;
}

export function segmentForStreaming(
  text: string,
  lang = 'en',
  options: StreamingSegmentOptions = {}
): string[] {
  const maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const firstChunkMaxChars = Math.min(
    options.firstChunkMaxChars ?? DEFAULT_STREAMING_FIRST_CHARS,
    maxChunkChars
  );
  const secondChunkMaxChars = Math.min(
    options.secondChunkMaxChars ?? DEFAULT_STREAMING_SECOND_CHARS,
    maxChunkChars
  );
  const minLeadChars = options.minLeadChars ?? DEFAULT_MIN_LEAD_CHARS;

  const baseSentences = segmentSentences(text, lang, maxChunkChars);
  if (baseSentences.length === 0) {
    return [];
  }

  const [first, ...rest] = baseSentences;
  const output: string[] = [];

  const firstSplit = splitLeadFragment(first!, firstChunkMaxChars, minLeadChars);
  if (!firstSplit) {
    output.push(first!);
    return [...output, ...rest];
  }

  const [leadChunk, remainder] = firstSplit;
  output.push(leadChunk);

  const secondSplit = splitLeadFragment(remainder, secondChunkMaxChars, minLeadChars);
  if (secondSplit) {
    output.push(secondSplit[0]);
    output.push(...splitLongSentence(secondSplit[1], maxChunkChars));
  } else {
    output.push(remainder);
  }

  return [...output, ...rest];
}
