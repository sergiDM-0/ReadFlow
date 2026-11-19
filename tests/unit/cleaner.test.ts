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
});
