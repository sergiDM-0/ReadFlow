import { describe, it, expect } from 'vitest';
import { cleanText, extractCleanTextFromElement } from '../../src/core/cleaner';

describe('cleaner', () => {
  it('replaces fenced markdown code blocks with spoken placeholder', () => {
    const raw = 'Mira este ejemplo:\n```ts\nconst x = 42;\n```\nContinúa leyendo.';
    const cleaned = cleanText(raw, { lang: 'es' });
    expect(cleaned).toContain('bloque de código omitido');
    expect(cleaned).not.toContain('const x = 42');
    expect(cleaned).toContain('Continúa leyendo.');
  });

  it('uses English placeholder when language is English', () => {
    const raw = 'Look here:\n```js\nconsole.log(1)\n```\nDone.';
    const cleaned = cleanText(raw, { lang: 'en' });
    expect(cleaned).toContain('code block omitted');
    expect(cleaned).not.toContain('console.log');
  });

  it('strips long URLs while preserving surrounding prose', () => {
    const raw = 'Visit https://example.com/very/long/path/with?query=12345&token=abcdef for info.';
    const cleaned = cleanText(raw);
    expect(cleaned).not.toContain('query=12345');
    expect(cleaned).toContain('Visit');
    expect(cleaned).toContain('for info.');
  });

  it('cleans noisy markdown syntax and repetitive emojis', () => {
    const raw =
      '### **Hello** __world__ with `inline` 🔥🔥🔥🔥🔥 and [a link](https://test.dev/a/b/c).';
    const cleaned = cleanText(raw);
    expect(cleaned).toBe('Hello world with inline and a link.');
  });

  it('normalizes extra whitespace and returns empty string for blank input', () => {
    expect(cleanText('   \n\t\n  ')).toBe('');
    expect(cleanText('Line one.\n\n\n   Line two.')).toBe('Line one. Line two.');
  });

  it('replaces <pre><code> nodes when extracting text from DOM element', () => {
    const container = document.createElement('div');
    const p1 = document.createElement('p');
    p1.textContent = 'First sentence.';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'function secret() { return 1; }';
    pre.appendChild(code);
    const p2 = document.createElement('p');
    p2.textContent = 'Second sentence.';
    container.append(p1, pre, p2);

    const text = extractCleanTextFromElement(container, { lang: 'en', omitCodeBlocks: true });
    expect(text).toContain('First sentence.');
    expect(text).toContain('code block omitted');
    expect(text).toContain('Second sentence.');
    expect(text).not.toContain('function secret');
  });

  it('preserves code text when omitCodeBlocks is false and keeps URLs when stripUrls is false', () => {
    const raw = 'Code:\n```\nlet a = 1;\n```\nhttps://example.com/docs';
    const cleaned = cleanText(raw, { omitCodeBlocks: false, stripUrls: false });
    expect(cleaned).toContain('let a = 1;');
    expect(cleaned).toContain('https://example.com/docs');

    const el = document.createElement('div');
    const script = document.createElement('script');
    script.textContent = 'alert(1)';
    const hidden = document.createElement('span');
    hidden.setAttribute('aria-hidden', 'true');
    hidden.textContent = 'hidden';
    const visible = document.createElement('span');
    visible.textContent = 'Visible text.';
    el.append(script, hidden, visible);
    expect(extractCleanTextFromElement(el)).toBe('Visible text.');
  });

  it('strips noisy uploaded image and document filenames (like image.3423543-4) and attachment chips by default', () => {
    const raw =
      'Basado en image.3423543-4 y [IMG_20261120_145504.jpg] o (reporte_final-2026.pdf), en la imagen 1 la respuesta es correcta.';
    const cleaned = cleanText(raw);
    expect(cleaned).not.toContain('image.3423543-4');
    expect(cleaned).not.toContain('IMG_20261120_145504.jpg');
    expect(cleaned).not.toContain('reporte_final-2026.pdf');
    expect(cleaned).toContain('Basado en');
    expect(cleaned).toContain('en la imagen 1 la respuesta es correcta.');

    const kept = cleanText(raw, { omitFileNames: false });
    expect(kept).toContain('image.3423543-4');
    expect(kept).toContain('IMG_20261120_145504.jpg');

    const dom = document.createElement('div');
    const chip = document.createElement('user-query-file-preview');
    chip.textContent = 'image.3423543-4.png 2.4 MB';
    const icon = document.createElement('mat-icon');
    icon.textContent = 'picture_as_pdf';
    const attach = document.createElement('div');
    attach.setAttribute('data-test-id', 'file-attachment-chip');
    attach.textContent = 'screenshot_998877.webp';
    const p = document.createElement('p');
    p.textContent = 'Aquí tienes el análisis de la gráfica.';
    dom.append(chip, icon, attach, p);

    expect(extractCleanTextFromElement(dom)).toBe('Aquí tienes el análisis de la gráfica.');

    // Ordinary prose with numbered references, empty code brackets and URLs is preserved
    expect(cleanText('See Document 1 and Image 2 for details.')).toBe(
      'See Document 1 and Image 2 for details.'
    );
    expect(cleanText('Revisa el archivo 2 y la foto 3.')).toBe('Revisa el archivo 2 y la foto 3.');
    expect(cleanText('You must file 1099 forms.')).toBe('You must file 1099 forms.');
    expect(cleanText('Call init() and pass items[] now.')).toBe(
      'Call init() and pass items[] now.'
    );
    expect(cleanText('Logo: https://example.com/assets/logo.png', { stripUrls: false })).toBe(
      'Logo: https://example.com/assets/logo.png'
    );
    expect(cleanText('Ver ([image.3423543-4]) ahora.')).not.toContain('image.3423543-4');

    // <figure>/<figcaption> captions stay readable
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = 'Tabla 1: resultados trimestrales.';
    fig.appendChild(cap);
    expect(extractCleanTextFromElement(fig)).toBe('Tabla 1: resultados trimestrales.');
    expect(extractCleanTextFromElement(dom, { omitFileNames: false })).toContain(
      'image.3423543-4.png'
    );
  });

  it('does not read KaTeX/MathML equations twice (annotation + rendered math) and verbalizes >3 = algo once', () => {
    const katex = document.createElement('span');
    katex.className = 'katex';
    const mathml = document.createElement('span');
    mathml.className = 'katex-mathml';
    const math = document.createElement('math');
    const semantics = document.createElement('semantics');
    const mrow = document.createElement('mrow');
    mrow.textContent = '>3 = algo';
    const annotation = document.createElement('annotation');
    annotation.setAttribute('encoding', 'application/x-tex');
    annotation.textContent = '>3 = algo';
    semantics.append(mrow, annotation);
    math.appendChild(semantics);
    mathml.appendChild(math);

    const katexHtml = document.createElement('span');
    katexHtml.className = 'katex-html';
    katexHtml.textContent = '>3 = algo';
    katex.append(mathml, katexHtml);

    const text = extractCleanTextFromElement(katex, { lang: 'es' });
    expect(text).toBe('mayor que 3 igual a algo');
    expect(text.match(/mayor que 3/g)).toHaveLength(1);

    // Also deduplicates MathJax v3 (<mjx-math> + <mjx-assistive-mml>) and <annotation-xml>
    const mjx = document.createElement('mjx-container');
    const mjxMath = document.createElement('mjx-math');
    mjxMath.textContent = '>3 = algo';
    const assistive = document.createElement('mjx-assistive-mml');
    const m2 = document.createElement('math');
    const mrow2 = document.createElement('mrow');
    mrow2.textContent = '>3 = algo';
    const annXml = document.createElement('annotation-xml');
    annXml.textContent = '>3 = algo';
    m2.append(mrow2, annXml);
    assistive.appendChild(m2);
    mjx.append(mjxMath, assistive);

    expect(extractCleanTextFromElement(mjx, { lang: 'es' })).toBe('mayor que 3 igual a algo');
  });

  it('strips split-span filenames, Gemini attachment classes, and multi-word screenshot names', () => {
    // Multi-word OS screenshot / WhatsApp filenames and UUIDs
    const raw =
      'Mira Captura de pantalla de 2026-11-20 15-40-10.png y WhatsApp Image 2026-11-20 at 10.15.00.jpeg y file-abc123xyz y 550e8400-e29b-41d4-a716-446655440000; la respuesta es sí.';
    const cleaned = cleanText(raw, { lang: 'es' });
    expect(cleaned).not.toContain('Captura');
    expect(cleaned).not.toContain('2026-11-20');
    expect(cleaned).not.toContain('WhatsApp');
    expect(cleaned).not.toContain('file-abc123xyz');
    expect(cleaned).not.toContain('550e8400');
    expect(cleaned).toContain('la respuesta es sí.');

    // Split DOM spans (<span>image</span><span>.3423543-4</span>) and Gemini chip classes
    const container = document.createElement('div');
    const splitChip = document.createElement('div');
    splitChip.className = 'file-name';
    const s1 = document.createElement('span');
    s1.textContent = 'image';
    const s2 = document.createElement('span');
    s2.textContent = '.3423543-4';
    splitChip.append(s1, s2);

    const splitText = document.createElement('span');
    const t1 = document.createElement('span');
    t1.textContent = 'image';
    const t2 = document.createElement('span');
    t2.textContent = '.3423543-4';
    splitText.append(t1, t2);

    const answer = document.createElement('p');
    answer.textContent = 'El gráfico muestra crecimiento.';
    container.append(splitChip, splitText, answer);

    expect(extractCleanTextFromElement(container, { lang: 'es' })).toBe(
      'El gráfico muestra crecimiento.'
    );

    const truncatedPdf =
      'Analiza [v2] Fotos Tercer Corte - Estadística y Probabilidad.pd y dime el resumen.';
    const cleanedTruncated = cleanText(truncatedPdf, { lang: 'es' });
    expect(cleanedTruncated).not.toContain('Estadística');
    expect(cleanedTruncated).not.toContain('Fotos');
    expect(cleanedTruncated).toContain('Analiza');
    expect(cleanedTruncated).toContain('dime el resumen.');
  });
});
