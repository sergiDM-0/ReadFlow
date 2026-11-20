import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiAdapter } from '../../src/content/adapters/gemini-adapter';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('GeminiAdapter streaming auto-read', () => {
  beforeEach(() => {
    document.body.textContent = '';
  });

  it('ignores pre-existing history and reads streamed paragraphs once while skipping code blocks', async () => {
    const main = document.createElement('main');
    const oldTurn = document.createElement('model-response');
    const oldP = document.createElement('p');
    oldP.textContent = 'Old history message that must not be spoken.';
    oldTurn.appendChild(oldP);
    main.appendChild(oldTurn);
    document.body.appendChild(main);

    const enqueued: string[] = [];
    const adapter = new GeminiAdapter({
      root: main,
      omitCodeBlocks: true,
      settleMs: 25,
      onSentences: (sentences) => enqueued.push(...sentences),
    });

    adapter.setEnabled(true);

    const newTurn = document.createElement('model-response');
    const p1 = document.createElement('p');
    p1.textContent = 'Primera oración';
    newTurn.appendChild(p1);
    main.appendChild(newTurn);

    p1.textContent = 'Primera oración completa. Segunda oración en progreso';
    await wait(10);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'const hidden = true;';
    pre.appendChild(code);
    newTurn.appendChild(pre);

    const fileChip = document.createElement('user-query-file-preview');
    fileChip.textContent = 'image.3423543-4.png';
    newTurn.appendChild(fileChip);

    adapter.setSanitizeOptions({ omitCodeBlocks: true, omitFileNames: true });
    p1.textContent = 'Primera oración completa. image.3423543-4 Segunda oración terminada.';
    const p2 = document.createElement('p');
    p2.textContent = 'Tercer párrafo final.';
    newTurn.appendChild(p2);

    await wait(60);

    expect(enqueued.join(' ')).not.toContain('Old history');
    expect(enqueued.join(' ')).not.toContain('const hidden');
    expect(enqueued.join(' ')).not.toContain('image.3423543-4');
    expect(enqueued.filter((s) => s.includes('Primera oración completa.'))).toHaveLength(1);
    expect(enqueued.filter((s) => s.includes('Segunda oración terminada.'))).toHaveLength(1);
    expect(enqueued.filter((s) => s.includes('Tercer párrafo final.'))).toHaveLength(1);

    adapter.dispose();
  });

  it('stops observing when disabled and defers tail while streaming indicator is active', async () => {
    const main = document.createElement('main');
    document.body.appendChild(main);
    const onSentences = vi.fn();

    const adapter = new GeminiAdapter({
      root: main,
      omitCodeBlocks: true,
      settleMs: 25,
      onSentences,
    });
    adapter.setEnabled(true);
    adapter.setEnabled(false);

    const turn = document.createElement('model-response');
    const p = document.createElement('p');
    p.textContent = 'Should not trigger while disabled.';
    turn.appendChild(p);
    main.appendChild(turn);

    await wait(50);
    expect(onSentences).not.toHaveBeenCalled();

    adapter.setEnabled(false);
    expect(adapter.isEnabled()).toBe(false);
    adapter.setEnabled(true);
    adapter.setEnabled(true);

    const streamingTurn = document.createElement('model-response');
    const busy = document.createElement('div');
    busy.setAttribute('aria-busy', 'true');
    const para = document.createElement('p');
    para.textContent = 'Frase en curso todavía.';
    streamingTurn.append(busy, para);
    main.appendChild(streamingTurn);

    await wait(50);
    expect(onSentences).not.toHaveBeenCalled();

    busy.remove();
    para.textContent = 'Frase en curso todavía. Segunda frase lista.';
    await wait(60);
    expect(onSentences).toHaveBeenCalled();

    adapter.dispose();
  });

  it('keeps attachment chips and filenames when omitFileNames is disabled', async () => {
    const main = document.createElement('main');
    document.body.appendChild(main);
    const spoken: string[] = [];
    const adapter = new GeminiAdapter({
      root: main,
      omitFileNames: false,
      settleMs: 25,
      onSentences: (s) => spoken.push(...s),
    });
    adapter.setEnabled(true);

    const turn = document.createElement('model-response');
    const p = document.createElement('p');
    p.textContent = 'Analicé image.3423543-4 correctamente.';
    turn.appendChild(p);
    main.appendChild(turn);

    await wait(60);
    expect(spoken.join(' ')).toContain('image.3423543-4');
    adapter.dispose();
  });

  it('deduplicates nested modelTurn selectors without repeating speech', async () => {
    const main = document.createElement('main');
    document.body.appendChild(main);

    const nestedCalls: string[] = [];
    const nestedAdapter = new GeminiAdapter({
      root: main,
      omitCodeBlocks: true,
      settleMs: 25,
      onSentences: (s) => nestedCalls.push(...s),
    });
    nestedAdapter.setEnabled(true);

    const outer = document.createElement('model-response');
    const inner = document.createElement('message-content');
    const nestedP = document.createElement('p');
    nestedP.textContent = 'Única lectura garantizada.';
    inner.appendChild(nestedP);
    outer.appendChild(inner);
    main.appendChild(outer);

    await wait(60);
    expect(nestedCalls.filter((s) => s.includes('Única lectura garantizada.'))).toHaveLength(1);
    nestedAdapter.dispose();
  });
});
