import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiAdapter } from '../../src/content/adapters/gemini-adapter';

describe('GeminiAdapter streaming auto-read', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.textContent = '';
  });

  afterEach(() => {
    vi.useRealTimers();
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
      onSentences: (sentences) => enqueued.push(...sentences),
    });

    adapter.setEnabled(true);

    // Simulate a new streamed model turn
    const newTurn = document.createElement('model-response');
    const p1 = document.createElement('p');
    p1.textContent = 'Primera oración';
    newTurn.appendChild(p1);
    main.appendChild(newTurn);

    // Stream completes first sentence and starts second
    p1.textContent = 'Primera oración completa. Segunda oración en progreso';
    await Promise.resolve();
    vi.advanceTimersByTime(100);

    // Code block appears during streaming
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = 'const hidden = true;';
    pre.appendChild(code);
    newTurn.appendChild(pre);

    // Second paragraph arrives and streaming settles
    p1.textContent = 'Primera oración completa. Segunda oración terminada.';
    const p2 = document.createElement('p');
    p2.textContent = 'Tercer párrafo final.';
    newTurn.appendChild(p2);

    await Promise.resolve();
    vi.advanceTimersByTime(600);

    // Must never speak old history
    expect(enqueued.join(' ')).not.toContain('Old history');
    // Must not speak code content
    expect(enqueued.join(' ')).not.toContain('const hidden');
    // Must speak each streamed sentence exactly once
    expect(enqueued.filter((s) => s.includes('Primera oración completa.'))).toHaveLength(1);
    expect(enqueued.filter((s) => s.includes('Segunda oración terminada.'))).toHaveLength(1);
    expect(enqueued.filter((s) => s.includes('Tercer párrafo final.'))).toHaveLength(1);

    adapter.dispose();
  });

  it('stops observing when disabled', async () => {
    const main = document.createElement('main');
    document.body.appendChild(main);
    const onSentences = vi.fn();

    const adapter = new GeminiAdapter({ root: main, omitCodeBlocks: true, onSentences });
    adapter.setEnabled(true);
    adapter.setEnabled(false);

    const turn = document.createElement('model-response');
    const p = document.createElement('p');
    p.textContent = 'Should not trigger while disabled.';
    turn.appendChild(p);
    main.appendChild(turn);

    await Promise.resolve();
    vi.advanceTimersByTime(600);
    expect(onSentences).not.toHaveBeenCalled();

    adapter.dispose();
  });
});
