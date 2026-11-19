import { describe, it, expect } from 'vitest';
import { segmentForStreaming, segmentSentences } from '../../src/core/segmenter';

describe('segmentSentences', () => {
  it('splits standard punctuation into clean sentences', () => {
    const result = segmentSentences('Hola mundo. ¿Cómo estás? ¡Todo bien!');
    expect(result).toEqual(['Hola mundo.', '¿Cómo estás?', '¡Todo bien!']);
  });

  it('does not split common abbreviations or semantic versions', () => {
    const result = segmentSentences(
      'El Dr. García y el Sr. Pérez usan v1.2.3, etc. en producción.'
    );
    expect(result).toEqual(['El Dr. García y el Sr. Pérez usan v1.2.3, etc. en producción.']);
  });

  it('handles English abbreviations e.g. and i.e. without premature splits', () => {
    const result = segmentSentences(
      'Use modern APIs, e.g. Web Speech API, i.e. local voices. Next sentence.'
    );
    expect(result).toEqual([
      'Use modern APIs, e.g. Web Speech API, i.e. local voices.',
      'Next sentence.',
    ]);
  });

  it('sub-splits overly long sentences at clause boundaries to prevent Chromium 15s cutoff', () => {
    const longClause =
      'Esta es una oración extremadamente extensa sobre accesibilidad en navegadores modernos, ' +
      'que continúa describiendo el aislamiento con Shadow DOM y variables CSS adaptables, ' +
      'además de explicar cómo evitar bloqueos del motor nativo de síntesis de voz en Chromium; ' +
      'por eso el segmentador la divide en fragmentos manejables para baja latencia inicial.';
    const result = segmentSentences(longClause, 'es', 140);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(160);
    }
    expect(result.join(' ')).toContain('baja latencia inicial.');
  });

  it('returns empty array for empty or whitespace-only text', () => {
    expect(segmentSentences('')).toEqual([]);
    expect(segmentSentences('   \n\t  ')).toEqual([]);
  });

  it('splits by newlines when sentences lack terminal punctuation', () => {
    const result = segmentSentences('First heading\nSecond heading\nThird line');
    expect(result).toEqual(['First heading', 'Second heading', 'Third line']);
  });

  it('falls back to word-boundary splitting for long punctuation-free text', () => {
    const words = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(' ');
    const chunks = segmentSentences(words, 'es', 80);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(80);
    }
  });

  it('handles malformed locale strings gracefully via regex fallback', () => {
    expect(segmentSentences('First. Second!', 'invalid_locale_!!!')).toEqual(['First.', 'Second!']);
  });
});

describe('segmentForStreaming', () => {
  it('splits a long opening sentence at a natural clause boundary for ultra-fast first audio', () => {
    const paragraph =
      'Cuando seleccionas un texto largo en el navegador, el motor neuronal empieza a hablar ' +
      'de inmediato con una primera cláusula corta mientras prepara el resto del párrafo en segundo plano. ' +
      'La segunda oración se mantiene intacta para prosodia fluida.';

    const chunks = segmentForStreaming(paragraph, 'es', {
      firstChunkMaxChars: 75,
      secondChunkMaxChars: 140,
      maxChunkChars: 220,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks[0]).toBe('Cuando seleccionas un texto largo en el navegador,');
    expect(chunks[0]!.length).toBeLessThanOrEqual(75);
    expect(chunks[chunks.length - 1]).toBe(
      'La segunda oración se mantiene intacta para prosodia fluida.'
    );
  });

  it('falls back to word boundaries when opening sentence has no clause punctuation', () => {
    const text =
      'Esta es una frase continua sin ninguna coma pero lo bastante larga para activar el corte inicial rápido en modo streaming.';
    const chunks = segmentForStreaming(text, 'es', { firstChunkMaxChars: 60 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.length).toBeLessThanOrEqual(60);
    expect(chunks.join(' ')).toBe(text);
  });

  it('keeps short sentences untouched and handles empty text', () => {
    expect(segmentForStreaming('Hola mundo.', 'es')).toEqual(['Hola mundo.']);
    expect(segmentForStreaming('   ', 'es')).toEqual([]);
  });
});
