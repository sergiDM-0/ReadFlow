import { cleanText } from './cleaner';
import { segmentForStreaming, segmentSentences } from './segmenter';

export interface ProceduralStreamOptions {
  readonly lang: string;
  readonly omitCodeBlocks: boolean;
  readonly omitFileNames?: boolean;
  readonly stripUrls: boolean;
  readonly maxChunkChars: number;
  readonly firstChunkMaxChars?: number;
  readonly batchWindowChars?: number;
}

export interface ProceduralTextStream {
  hasMore(): boolean;
  nextBatch(): string[];
}

const DEFAULT_BATCH_WINDOW_CHARS = 640;
const MIN_SPLIT_RATIO = 0.45;

function findSafeWindowEnd(text: string, start: number, maxWindow: number): number {
  const remaining = text.length - start;
  if (remaining <= maxWindow) {
    return text.length;
  }

  const endLimit = start + maxWindow;
  const minBreak = start + Math.floor(maxWindow * MIN_SPLIT_RATIO);
  const slice = text.slice(start, endLimit);

  // Never split inside an unclosed fenced code block; extend through its closing fence when present.
  const fenceMatches = slice.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 === 1) {
    const closingFence = text.indexOf('```', endLimit);
    if (closingFence !== -1) {
      return Math.min(text.length, closingFence + 3);
    }
    return text.length;
  }

  // 1. Prefer paragraph boundary
  const paraBreak = text.lastIndexOf('\n\n', endLimit);
  if (paraBreak >= minBreak) {
    return paraBreak + 2;
  }

  // 2. Prefer newline boundary
  const lineBreak = text.lastIndexOf('\n', endLimit);
  if (lineBreak >= minBreak) {
    return lineBreak + 1;
  }

  // 3. Prefer sentence boundary (. ! ? followed by whitespace)
  for (let i = endLimit - 1; i >= minBreak; i -= 1) {
    const ch = text[i];
    const next = text[i + 1];
    if ((ch === '.' || ch === '!' || ch === '?') && next && /\s/.test(next)) {
      return i + 2;
    }
  }

  // 4. Fall back to whitespace boundary so words are never cut in half
  const spaceBreak = text.lastIndexOf(' ', endLimit);
  if (spaceBreak >= minBreak) {
    return spaceBreak + 1;
  }

  return endLimit;
}

/**
 * Creates a lazy, on-demand procedural text stream that slices large documents into
 * ~640-character windows at safe paragraph/sentence/word boundaries and applies
 * `cleanText` + `segmentForStreaming` incrementally (`O(1)` startup time).
 * @param rawText Full raw text selected or triggered by the user.
 * @param options Language, sanitization, and chunk-size configuration.
 */
export function createProceduralTextStream(
  rawText: string,
  options: ProceduralStreamOptions
): ProceduralTextStream {
  const source = rawText.trim();
  const batchWindow = Math.max(200, options.batchWindowChars ?? DEFAULT_BATCH_WINDOW_CHARS);
  let cursor = 0;
  let isFirstBatch = true;

  return {
    hasMore(): boolean {
      return cursor < source.length;
    },

    nextBatch(): string[] {
      while (cursor < source.length) {
        const end = findSafeWindowEnd(source, cursor, batchWindow);
        const rawSlice = source.slice(cursor, end);
        cursor = end;

        // Skip leading whitespace before the next batch so hasMore() is accurate.
        while (cursor < source.length && /\s/.test(source[cursor] ?? '')) {
          cursor += 1;
        }

        const cleaned = cleanText(rawSlice, {
          lang: options.lang,
          omitCodeBlocks: options.omitCodeBlocks,
          omitFileNames: options.omitFileNames,
          stripUrls: options.stripUrls,
        });

        if (!cleaned) {
          continue;
        }

        const chunks =
          isFirstBatch && options.firstChunkMaxChars
            ? segmentForStreaming(cleaned, options.lang, {
                firstChunkMaxChars: options.firstChunkMaxChars,
                maxChunkChars: options.maxChunkChars,
              })
            : segmentSentences(cleaned, options.lang, options.maxChunkChars);

        isFirstBatch = false;
        if (chunks.length > 0) {
          return chunks;
        }
      }

      return [];
    },
  };
}
