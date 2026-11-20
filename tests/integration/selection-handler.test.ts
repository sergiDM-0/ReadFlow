import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clampFloatingPosition,
  enableGoogleDocsCanvasAnnotations,
  SelectionHandler,
} from '../../src/content/selection-handler';

describe('enableGoogleDocsCanvasAnnotations', () => {
  it('injects _docs_annotate_canvas_by_ext when running on docs.google.com', () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, hostname: 'docs.google.com' },
    });

    try {
      enableGoogleDocsCanvasAnnotations(document, 'echoselect-test-id');
      expect(
        (window as unknown as { _docs_annotate_canvas_by_ext?: string })
          ._docs_annotate_canvas_by_ext
      ).toBe('echoselect-test-id');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
    enableGoogleDocsCanvasAnnotations();
  });
});

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
    expect(handler.getCurrentSelectedText()).toBe('Selected text for speech synthesis.');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClear).toHaveBeenCalledTimes(1);

    // Shift+keyup re-triggers selection and outside mousedown clears it
    document.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Shift', shiftKey: true, bubbles: true })
    );
    expect(onSelect).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClear).toHaveBeenCalledTimes(2);

    // Collapsed selection yields empty text and clears active trigger on mouseup
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: true,
      rangeCount: 0,
      toString: () => '',
      getRangeAt: () => range,
    } as unknown as Selection);
    expect(handler.getCurrentSelectedText()).toBe('');
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // Re-attaching while already attached is idempotent
    handler.attach();
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

  it('extracts text and anchor rect from <input> and <textarea> selections', () => {
    const textarea = document.createElement('textarea');
    textarea.value = 'Hola desde un campo editable de formulario.';
    textarea.getBoundingClientRect = () =>
      ({
        top: 150,
        left: 80,
        right: 380,
        bottom: 210,
        width: 300,
        height: 60,
        x: 80,
        y: 150,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.selectionStart = 0;
    textarea.selectionEnd = 10;

    const onSelect = vi.fn();
    const onClear = vi.fn();
    const handler = new SelectionHandler({
      isInsideOwnUi: () => false,
      onSelect,
      onClear,
    });
    handler.attach();

    textarea.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 200, clientY: 180, bubbles: true })
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.text).toBe('Hola desde');
    expect(handler.getCurrentSelectedText()).toBe('Hola desde');

    handler.detach();
  });

  it('extracts text and selection rects from Google Docs canvas / docs-texteventtarget-iframe', () => {
    // Set up a simulated Google Docs canvas page with selection overlay and event target iframe
    const selectionOverlay = document.createElement('div');
    selectionOverlay.className = 'kix-canvas-tile-selection';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.getBoundingClientRect = () =>
      ({
        top: 220,
        left: 140,
        right: 420,
        bottom: 242,
        width: 280,
        height: 22,
        x: 140,
        y: 220,
        toJSON: () => ({}),
      }) as DOMRect;
    svg.appendChild(rect);
    selectionOverlay.appendChild(svg);
    document.body.appendChild(selectionOverlay);

    const iframe = document.createElement('iframe');
    iframe.className = 'docs-texteventtarget-iframe';
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument!;
    const editable = iframeDoc.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    iframeDoc.body.appendChild(editable);

    // Simulate Google Docs populating clipboardData when copy is executed on the event target iframe
    Object.defineProperty(iframeDoc, 'execCommand', {
      configurable: true,
      value: (cmd: string) => {
        if (cmd === 'copy') {
          const ev = new Event('copy', { bubbles: true, cancelable: true }) as Event & {
            clipboardData: { getData: (type: string) => string };
          };
          ev.clipboardData = {
            getData: (type: string) =>
              type === 'text/plain' ? 'Texto subrayado en Google Docs canvas.' : '',
          };
          editable.dispatchEvent(ev);
          return true;
        }
        return false;
      },
    });

    const onSelect = vi.fn();
    const onClear = vi.fn();
    const handler = new SelectionHandler({
      isInsideOwnUi: () => false,
      onSelect,
      onClear,
    });
    handler.attach();

    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 410, clientY: 235, bubbles: true })
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.text).toBe('Texto subrayado en Google Docs canvas.');
    expect(handler.getCurrentSelectedText()).toBe('Texto subrayado en Google Docs canvas.');

    handler.detach();
  });

  it('falls back to pointer coordinates when selection range has zero-sized client rects (e.g. PDF text layer)', () => {
    const span = document.createElement('span');
    span.textContent = 'Texto seleccionado en visor PDF.';
    document.body.appendChild(span);

    const range = document.createRange();
    range.selectNodeContents(span);
    range.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    range.getClientRects = () => [] as unknown as DOMRectList;

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'Texto seleccionado en visor PDF.',
      getRangeAt: () => range,
    } as unknown as Selection);

    const onSelect = vi.fn();
    const onClear = vi.fn();
    const handler = new SelectionHandler({
      isInsideOwnUi: () => false,
      onSelect,
      onClear,
    });
    handler.attach();

    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 300, clientY: 250, bubbles: true })
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.text).toBe('Texto seleccionado en visor PDF.');
    expect(onSelect.mock.calls[0]?.[0]?.position).toEqual({
      left: 308,
      top: 258,
    });

    handler.detach();
  });

  it('extracts selected text from Google Docs SVG accessibility rects when clipboard copy is empty', () => {
    const selectionOverlay = document.createElement('div');
    selectionOverlay.className = 'kix-canvas-tile-selection';
    const selSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const selRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    selRect.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 100,
        right: 400,
        bottom: 130,
        width: 300,
        height: 30,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    selSvg.appendChild(selRect);
    selectionOverlay.appendChild(selSvg);

    const contentTile = document.createElement('div');
    contentTile.className = 'kix-canvas-tile-content';
    const contentSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const word1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    word1.setAttribute('aria-label', 'Lectura en');
    word1.getBoundingClientRect = () =>
      ({
        top: 102,
        left: 105,
        right: 220,
        bottom: 126,
        width: 115,
        height: 24,
        x: 105,
        y: 102,
        toJSON: () => ({}),
      }) as DOMRect;
    const word2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    word2.setAttribute('aria-label', 'Google Docs.');
    word2.getBoundingClientRect = () =>
      ({
        top: 102,
        left: 225,
        right: 380,
        bottom: 126,
        width: 155,
        height: 24,
        x: 225,
        y: 102,
        toJSON: () => ({}),
      }) as DOMRect;
    const outsideWord = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    outsideWord.setAttribute('aria-label', 'No seleccionado');
    outsideWord.getBoundingClientRect = () =>
      ({
        top: 300,
        left: 105,
        right: 250,
        bottom: 324,
        width: 145,
        height: 24,
        x: 105,
        y: 300,
        toJSON: () => ({}),
      }) as DOMRect;

    contentSvg.append(word1, word2, outsideWord);
    contentTile.appendChild(contentSvg);
    document.body.append(selectionOverlay, contentTile);

    const onSelect = vi.fn();
    const onClear = vi.fn();
    const handler = new SelectionHandler({
      isInsideOwnUi: () => false,
      onSelect,
      onClear,
    });
    handler.attach();

    document.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 380, clientY: 125, bubbles: true })
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.text).toBe('Lectura en Google Docs.');
    expect(handler.getCurrentSelectedText()).toBe('Lectura en Google Docs.');

    handler.detach();
  });

  it('extracts text from same-origin iframes and handles native copy and Ctrl+A shortcuts', () => {
    const iframe = document.createElement('iframe');
    iframe.getBoundingClientRect = () =>
      ({
        top: 50,
        left: 60,
        right: 560,
        bottom: 350,
        width: 500,
        height: 300,
        x: 60,
        y: 50,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument!;
    const p = iframeDoc.createElement('p');
    p.textContent = 'Texto seleccionado dentro de un iframe embebido.';
    iframeDoc.body.appendChild(p);

    const range = iframeDoc.createRange();
    range.selectNodeContents(p);
    range.getBoundingClientRect = () =>
      ({
        top: 20,
        left: 30,
        right: 230,
        bottom: 44,
        width: 200,
        height: 24,
        x: 30,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect;
    range.getClientRects = () => [range.getBoundingClientRect()] as unknown as DOMRectList;

    vi.spyOn(iframe.contentWindow!, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'Texto seleccionado dentro de un iframe embebido.',
      getRangeAt: () => range,
    } as unknown as Selection);

    const onSelect = vi.fn();
    const onClear = vi.fn();
    const handler = new SelectionHandler({
      isInsideOwnUi: () => false,
      onSelect,
      onClear,
    });
    handler.attach();

    // Trigger Ctrl+A keyup inside iframe
    iframeDoc.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', ctrlKey: true, bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.text).toBe(
      'Texto seleccionado dentro de un iframe embebido.'
    );
    // Position is translated by iframe's bounding box offset (left: 60+230+8 = 298, top: 50+44+8 = 102)
    expect(onSelect.mock.calls[0]?.[0]?.position).toEqual({
      left: 298,
      top: 102,
    });

    // Native copy event updates cached selection text
    const copyEv = new Event('copy', { bubbles: true }) as Event & {
      clipboardData: { getData: (t: string) => string };
    };
    copyEv.clipboardData = {
      getData: (t: string) => (t === 'text/plain' ? 'Texto copiado manualmente con Ctrl+C.' : ''),
    };
    document.dispatchEvent(copyEv);

    vi.spyOn(iframe.contentWindow!, 'getSelection').mockReturnValue({
      isCollapsed: true,
      rangeCount: 0,
      toString: () => '',
      getRangeAt: () => range,
    } as unknown as Selection);
    expect(handler.getCurrentSelectedText()).toBe('Texto copiado manualmente con Ctrl+C.');

    // Also test direct selection inside docs-texteventtarget-iframe and <input type="search"> inside iframe
    const searchInput = iframeDoc.createElement('input');
    searchInput.type = 'search';
    searchInput.value = 'Búsqueda dentro de iframe';
    searchInput.getBoundingClientRect = () =>
      ({ top: 10, left: 10, right: 120, bottom: 30, width: 110, height: 20 }) as DOMRect;
    iframeDoc.body.appendChild(searchInput);
    searchInput.focus();
    searchInput.selectionStart = 0;
    searchInput.selectionEnd = 8;
    expect(handler.getCurrentSelectedText()).toBe('Búsqueda');

    handler.detach();
  });
});
