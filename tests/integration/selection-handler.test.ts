import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clampFloatingPosition, SelectionHandler } from '../../src/content/selection-handler';

describe('clampFloatingPosition', () => {
  it('keeps coordinates safely inside viewport bounds with padding', () => {
    const posTopLeft = clampFloatingPosition(
      { top: 2, left: -20, right: 0, bottom: 10 },
      { width: 40, height: 40 },
      { width: 800, height: 600 }
    );
    expect(posTopLeft.left).toBeGreaterThanOrEqual(8);
    expect(posTopLeft.top).toBeGreaterThanOrEqual(8);

    const posBottomRight = clampFloatingPosition(
      { top: 585, left: 790, right: 810, bottom: 598 },
      { width: 40, height: 40 },
      { width: 800, height: 600 }
    );
    expect(posBottomRight.left).toBeLessThanOrEqual(800 - 40 - 8);
    expect(posBottomRight.top).toBeLessThanOrEqual(600 - 40 - 8);
  });
});

describe('SelectionHandler', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.textContent = '';
    host = document.createElement('echo-select-ui');
    document.documentElement.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    vi.restoreAllMocks();
  });

  it('invokes onSelect on valid text selection and onClear on Escape or outside click', () => {
    const p = document.createElement('p');
    p.textContent = 'Selected text for speech synthesis.';
    document.body.appendChild(p);

    const onSelect = vi.fn();
    const onClear = vi.fn();
    const handler = new SelectionHandler({
      isInsideOwnUi: (target) => target instanceof Node && host.contains(target),
      onSelect,
      onClear,
    });
    handler.attach();

    const range = document.createRange();
    range.selectNodeContents(p);
    range.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 120,
        right: 320,
        bottom: 124,
        width: 200,
        height: 24,
        x: 120,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    range.getClientRects = () => [range.getBoundingClientRect()] as unknown as DOMRectList;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'Selected text for speech synthesis.',
      getRangeAt: () => range,
    } as unknown as Selection);

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const payload = onSelect.mock.calls[0]?.[0];
    expect(payload.text).toBe('Selected text for speech synthesis.');
    expect(payload.position.left).toBeGreaterThanOrEqual(8);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClear).toHaveBeenCalledTimes(1);

    handler.detach();
  });

  it('ignores mouseup events originating inside the extension UI host', () => {
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const handler = new SelectionHandler({
      isInsideOwnUi: (target) => target === host,
      onSelect,
      onClear,
    });
    handler.attach();

    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();

    handler.detach();
  });
});
