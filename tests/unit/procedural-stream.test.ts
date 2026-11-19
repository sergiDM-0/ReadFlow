import { describe, it, expect } from 'vitest';
import { createProceduralTextStream } from '../../src/core/procedural-stream';

describe('createProceduralTextStream', () => {
  it('delivers large multi-paragraph texts incrementally in batches with a fast opening chunk', () => {
    const paragraphs = Array.from(
      { length: 8 },
      (_, idx) =>
        `Párrafo número ${idx + 1}, diseñado para probar la lectura procedural por partes sin bloquear el navegador mientras el usuario escucha el contenido con fluidez.`
    ).join('\n\n');

    const stream = createProceduralTextStream(paragraphs, {
      lang: 'es',
      omitCodeBlocks: true,
      stripUrls: true,
      maxChunkChars: 175,
      firstChunkMaxChars: 48,
      batchWindowChars: 350,
    });

    expect(stream.hasMore()).toBe(true);
    const firstBatch = stream.nextBatch();
    expect(firstBatch.length).toBeGreaterThanOrEqual(2);
    // First micro-chunk is short for ultra-fast time-to-first-audio
    expect(firstBatch[0]!.length).toBeLessThanOrEqual(48);
    // Remaining text was not processed eagerly yet
    expect(stream.hasMore()).toBe(true);

    const allChunks = [...firstBatch];
    let batchCount = 1;
    while (stream.hasMore()) {
      const batch = stream.nextBatch();
      if (batch.length > 0) {
        allChunks.push(...batch);
        batchCount += 1;
      }
    }

    expect(batchCount).toBeGreaterThanOrEqual(3);
    expect(allChunks.join(' ')).toContain('Párrafo número 1');
    expect(allChunks.join(' ')).toContain('Párrafo número 8');
    expect(stream.nextBatch()).toEqual([]);
  });

  it('does not split fenced code blocks mid-fence and skips code-only batches cleanly', () => {
    const text =
      'Introducción breve al ejemplo.\n\n' +
      '```ts\n' +
      'const a = 1;\n'.repeat(30) +
      '```\n\n' +
      'Conclusión final después del código.';

    const stream = createProceduralTextStream(text, {
      lang: 'es',
      omitCodeBlocks: true,
      stripUrls: true,
      maxChunkChars: 175,
      batchWindowChars: 220,
    });

    const collected: string[] = [];
    while (stream.hasMore()) {
      collected.push(...stream.nextBatch());
    }

    const combined = collected.join(' ');
    expect(combined).toContain('Introducción breve');
    expect(combined).toContain('Conclusión final');
    expect(combined).not.toContain('const a = 1');
  });

  it('handles empty text and punctuation-free long strings without cutting words', () => {
    const empty = createProceduralTextStream('   \n  ', {
      lang: 'es',
      omitCodeBlocks: true,
      stripUrls: true,
      maxChunkChars: 175,
    });
    expect(empty.hasMore()).toBe(false);
    expect(empty.nextBatch()).toEqual([]);

    const noPunct = Array.from({ length: 60 }, (_, i) => `termino${i}`).join(' ');
    const stream = createProceduralTextStream(noPunct, {
      lang: 'es',
      omitCodeBlocks: true,
      stripUrls: true,
      maxChunkChars: 120,
      firstChunkMaxChars: 48,
      batchWindowChars: 240,
    });

    const parts: string[] = [];
    while (stream.hasMore()) {
      parts.push(...stream.nextBatch());
    }
    expect(parts.join(' ')).toBe(noPunct);
  });
});
