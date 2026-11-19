import { describe, it, expect } from 'vitest';
import { segmentSentences } from '../../src/core/segmenter';

describe('segmentSentences', () => {
  it('splits standard punctuation into clean sentences', () => {
    const result = segmentSentences('Hola mundo. ¿Cómo estás? ¡Todo bien!');
    expect(result).toEqual(['Hola mundo.', '¿Cómo estás?', '¡Todo bien!']);
  });

  it('does not split common abbreviations or semantic versions', () => {
    const result = segmentSentences('El Dr. García y el Sr. Pérez usan v1.2.3, etc. en producción.');
    expect(result).toEqual(['El Dr. García y el Sr. Pérez usan v1.2.3, etc. en producción.']);
  });

  it('handles English abbreviations e.g. and i.e. without premature splits', () => {
    const result = segmentSentences('Use modern APIs, e.g. Web Speech API, i.e. local voices. Next sentence.');
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
});
