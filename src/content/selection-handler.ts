import { cleanText, extractCleanTextFromElement, type CleanTextOptions } from '../core/cleaner';

export interface RectLike {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

export interface SizeLike {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly top: number;
  readonly left: number;
}

export interface SelectionPayload {
  readonly text: string;
  readonly position: Point;
}

export interface SelectionHandlerOptions {
  readonly isInsideOwnUi: (target: EventTarget | null, path?: EventTarget[]) => boolean;
  readonly onSelect: (payload: SelectionPayload) => void;
  readonly onClear: () => void;
  readonly omitCodeBlocks?: () => boolean;
  readonly omitFileNames?: () => boolean;
  readonly stripUrls?: () => boolean;
}

const VIEWPORT_PADDING = 8;
const TRIGGER_OFFSET = 8;
const DEFAULT_BUTTON_SIZE: SizeLike = { width: 38, height: 38 };

const GOOGLE_DOCS_SELECTION_RECT_SELECTOR =
  '.kix-canvas-tile-selection svg rect, .kix-canvas-tile-selection rect, .kix-selection-overlay';
const GOOGLE_DOCS_CONTENT_RECT_SELECTOR =
  '.kix-canvas-tile-content svg rect[aria-label], .kix-canvas-tile-content rect[aria-label], g[role="paragraph"] rect[aria-label]';
const GOOGLE_DOCS_IFRAME_SELECTOR = 'iframe.docs-texteventtarget-iframe';

/**
 * When running on Google Docs (`docs.google.com`), sets the extension canvas annotation marker
 * without injecting inline `<script>` tags that could violate Trusted Types or CSP.
 */
export function enableGoogleDocsCanvasAnnotations(
  targetDoc: Document = document,
  extensionId = 'echoselect-tts'
): void {
  if (window.location.hostname !== 'docs.google.com') {
    return;
  }
  (window as unknown as { _docs_annotate_canvas_by_ext?: string })._docs_annotate_canvas_by_ext =
    extensionId;
  targetDoc.documentElement.setAttribute('data-es-docs-annotate', extensionId);
}

/**
 * Computes a viewport-clamped position for the floating trigger button near a text selection rect.
 */
export function clampFloatingPosition(
  rect: RectLike,
  widgetSize: SizeLike,
  viewport: SizeLike
): Point {
  const maxLeft = Math.max(VIEWPORT_PADDING, viewport.width - widgetSize.width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, viewport.height - widgetSize.height - VIEWPORT_PADDING);

  let left = rect.right + TRIGGER_OFFSET;
  if (left > maxLeft) {
    left = rect.left;
  }
  left = Math.min(Math.max(VIEWPORT_PADDING, left), maxLeft);

  let top = rect.bottom + TRIGGER_OFFSET;
  if (top > maxTop) {
    top = rect.top - widgetSize.height - TRIGGER_OFFSET;
  }
  top = Math.min(Math.max(VIEWPORT_PADDING, top), maxTop);

  return { top: Math.round(top), left: Math.round(left) };
}

function isNonZeroRect(rect: { width: number; height: number }): boolean {
  return rect.width > 0 || rect.height > 0;
}

function getSelectionAnchorRect(range: Range): RectLike | null {
  const rects = Array.from(range.getClientRects()).filter(isNonZeroRect);
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? null;
  }
  const bounding = range.getBoundingClientRect();
  if (!isNonZeroRect(bounding)) {
    return null;
  }
  return bounding;
}

function isTextSelectionInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') {
    return true;
  }
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'tel', 'email'].includes(type);
  }
  return false;
}

function extractInputSelection(
  el: HTMLInputElement | HTMLTextAreaElement,
  cleanOpts: CleanTextOptions,
  pointerRect: RectLike | null
): { text: string; rect: RectLike | null } | null {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (typeof start !== 'number' || typeof end !== 'number' || end <= start) {
    return null;
  }
  const text = cleanText(el.value.slice(start, end), cleanOpts);
  if (!text) {
    return null;
  }
  const box = el.getBoundingClientRect();
  return { text, rect: pointerRect ?? (isNonZeroRect(box) ? box : null) };
}

function getDeepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

function getGoogleDocsSelectionRects(): DOMRect[] {
  return Array.from(document.querySelectorAll(GOOGLE_DOCS_SELECTION_RECT_SELECTOR))
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 1 && r.height > 1);
}

function boxesOverlap(a: RectLike, b: RectLike): boolean {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
  );
}

function extractGoogleDocsSvgOverlayText(selectionRects: readonly DOMRect[]): string {
  const contentRects = Array.from(document.querySelectorAll(GOOGLE_DOCS_CONTENT_RECT_SELECTOR));
  const matched: string[] = [];
  for (const node of contentRects) {
    const label = node.getAttribute('aria-label')?.trim();
    const box = node.getBoundingClientRect();
    if (label && isNonZeroRect(box) && selectionRects.some((sel) => boxesOverlap(sel, box))) {
      matched.push(label);
    }
  }
  return matched.join(' ');
}

function extractGoogleDocsIframeText(allowCopyTrigger: boolean): string {
  const iframe = document.querySelector<HTMLIFrameElement>(GOOGLE_DOCS_IFRAME_SELECTOR);
  const iframeDoc = iframe?.contentDocument;
  if (!iframeDoc) {
    return '';
  }

  const directText = iframeDoc.getSelection?.()?.toString().trim() ?? '';
  if (directText) {
    return directText;
  }

  if (!allowCopyTrigger || typeof iframeDoc.execCommand !== 'function') {
    return '';
  }

  let captured = '';
  const onCopy = (event: Event) => {
    const plain = (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    if (plain) {
      captured = plain;
    }
    event.preventDefault();
  };

  try {
    iframeDoc.addEventListener('copy', onCopy, false);
    document.addEventListener('copy', onCopy, false);
    iframeDoc.execCommand('copy');
  } finally {
    iframeDoc.removeEventListener('copy', onCopy, false);
    document.removeEventListener('copy', onCopy, false);
  }

  return captured.trim();
}

function findOwningIframe(target: EventTarget | null): HTMLIFrameElement | null {
  const ownerDoc = target instanceof Node ? target.ownerDocument : null;
  if (!ownerDoc || ownerDoc === document) {
    return null;
  }
  return (
    Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).find(
      (frame) => frame.contentDocument === ownerDoc
    ) ?? null
  );
}

/**
 * Observes mouse and keyboard text selections across standard DOM pages, Shadow DOMs,
 * `<input>`/`<textarea>` form controls, PDF.js / embedded PDF text layers, and Google Docs
 * canvas / `.docs-texteventtarget-iframe` editors while ignoring events inside EchoSelect's UI.
 */
export class SelectionHandler {
  private readonly options: SelectionHandlerOptions;
  private abortController: AbortController | null = null;
  private attachedIframeDocs = new WeakSet<Document>();
  private hasActiveTrigger = false;
  private lastPointerRect: RectLike | null = null;
  private lastResolvedText = '';

  public constructor(options: SelectionHandlerOptions) {
    this.options = options;
  }

  public attach(): void {
    if (this.abortController) {
      return;
    }
    this.abortController = new AbortController();
    this.attachedIframeDocs = new WeakSet<Document>();
    const { signal } = this.abortController;

    document.addEventListener('mouseup', this.handleSelectionEvent, { signal });
    document.addEventListener('keyup', this.handleKeyUp, { signal });
    document.addEventListener('mousedown', this.handleMouseDown, { signal });
    document.addEventListener('keydown', this.handleKeyDown, { signal });
    document.addEventListener('copy', this.handleNativeCopy, { signal, capture: true });

    this.attachToAccessibleIframes(signal);
  }

  public detach(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.attachedIframeDocs = new WeakSet<Document>();
    this.hasActiveTrigger = false;
    this.lastPointerRect = null;
    this.lastResolvedText = '';
  }

  public getCurrentSelectedText(): string {
    const cleanOpts: CleanTextOptions = {
      omitCodeBlocks: this.options.omitCodeBlocks?.() ?? true,
      omitFileNames: this.options.omitFileNames?.() ?? true,
      stripUrls: this.options.stripUrls?.() ?? true,
    };

    const resolved = this.resolveUniversalSelection(cleanOpts, false);
    if (resolved?.text) {
      return resolved.text;
    }
    return this.lastResolvedText;
  }

  private attachToAccessibleIframes(signal: AbortSignal): void {
    document.querySelectorAll<HTMLIFrameElement>('iframe').forEach((iframe) => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || this.attachedIframeDocs.has(doc)) return;
        this.attachedIframeDocs.add(doc);
        doc.addEventListener('mouseup', this.handleSelectionEvent, { signal });
        doc.addEventListener('keyup', this.handleKeyUp, { signal });
        doc.addEventListener('keydown', this.handleKeyDown, { signal });
        doc.addEventListener('copy', this.handleNativeCopy, { signal, capture: true });
      } catch {
        // Cross-origin iframes cannot be directly observed from the top frame.
      }
    });
  }

  private readonly handleNativeCopy = (event: ClipboardEvent): void => {
    const copied = event.clipboardData?.getData('text/plain')?.trim() ?? '';
    if (!copied) return;
    const cleaned = cleanText(copied, {
      omitCodeBlocks: this.options.omitCodeBlocks?.() ?? true,
      omitFileNames: this.options.omitFileNames?.() ?? true,
      stripUrls: this.options.stripUrls?.() ?? true,
    });
    if (cleaned) {
      this.lastResolvedText = cleaned;
    }
  };

  private resolveStandardDomSelection(
    cleanOpts: CleanTextOptions
  ): { text: string; rect: RectLike | null } | null {
    const activeEl = getDeepActiveElement();
    if (isTextSelectionInput(activeEl)) {
      const inputSel = extractInputSelection(activeEl, cleanOpts, this.lastPointerRect);
      if (inputSel) {
        return inputSel;
      }
    }

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const text = this.extractSelectionText(range, selection.toString(), cleanOpts);
      if (text) {
        return { text, rect: getSelectionAnchorRect(range) ?? this.lastPointerRect };
      }
    }
    return null;
  }

  private extractSelectionText(
    range: Range,
    fallbackRaw: string,
    cleanOpts: CleanTextOptions
  ): string {
    const fragment = range.cloneContents();
    if (fragment.textContent?.trim()) {
      const wrapper = document.createElement('div');
      wrapper.appendChild(fragment);
      return extractCleanTextFromElement(wrapper, cleanOpts);
    }
    return cleanText(fallbackRaw, cleanOpts);
  }

  private resolveSameOriginIframeSelection(
    cleanOpts: CleanTextOptions
  ): { text: string; rect: RectLike | null } | null {
    const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
    for (const iframe of iframes) {
      if (iframe.classList.contains('docs-texteventtarget-iframe')) {
        continue;
      }
      try {
        const doc = iframe.contentDocument;
        const win = iframe.contentWindow;
        if (!doc || !win) continue;

        if (isTextSelectionInput(doc.activeElement)) {
          const inputSel = extractInputSelection(
            doc.activeElement,
            cleanOpts,
            this.lastPointerRect
          );
          if (inputSel) {
            return inputSel;
          }
        }

        const iframeSel = win.getSelection?.();
        if (iframeSel && !iframeSel.isCollapsed && iframeSel.rangeCount > 0) {
          const range = iframeSel.getRangeAt(0);
          const text = this.extractSelectionText(range, iframeSel.toString(), cleanOpts);
          if (text) {
            const localRect = getSelectionAnchorRect(range);
            const frameBox = iframe.getBoundingClientRect();
            const translatedRect: RectLike | null = localRect
              ? {
                  top: frameBox.top + localRect.top,
                  left: frameBox.left + localRect.left,
                  right: frameBox.left + localRect.right,
                  bottom: frameBox.top + localRect.bottom,
                }
              : this.lastPointerRect;
            return { text, rect: translatedRect };
          }
        }
      } catch {
        // Ignore cross-origin iframes.
      }
    }
    return null;
  }

  private resolveGoogleDocsSelection(
    cleanOpts: CleanTextOptions,
    allowCopyTrigger: boolean
  ): { text: string; rect: RectLike | null } | null {
    const docsSelectionRects = getGoogleDocsSelectionRects();
    const hasDocsIframe = Boolean(document.querySelector(GOOGLE_DOCS_IFRAME_SELECTOR));
    if (docsSelectionRects.length === 0 && !hasDocsIframe) {
      return null;
    }

    // Only trigger programmatic copy when visual selection rects exist in Google Docs canvas,
    // preventing spurious copy triggers on plain clicks when nothing is highlighted.
    const shouldTriggerCopy = allowCopyTrigger && docsSelectionRects.length > 0;
    const rawDocsText =
      extractGoogleDocsIframeText(shouldTriggerCopy) ||
      extractGoogleDocsSvgOverlayText(docsSelectionRects);
    const cleanedDocsText = cleanText(rawDocsText, cleanOpts);
    if (!cleanedDocsText) {
      return null;
    }

    const lastDocsRect = docsSelectionRects[docsSelectionRects.length - 1];
    return { text: cleanedDocsText, rect: lastDocsRect ?? this.lastPointerRect };
  }

  private resolveUniversalSelection(
    cleanOpts: CleanTextOptions,
    allowCopyTrigger: boolean
  ): { text: string; rect: RectLike | null } | null {
    return (
      this.resolveStandardDomSelection(cleanOpts) ??
      this.resolveSameOriginIframeSelection(cleanOpts) ??
      this.resolveGoogleDocsSelection(cleanOpts, allowCopyTrigger)
    );
  }

  private readonly handleSelectionEvent = (event: Event): void => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : undefined;
    if (this.options.isInsideOwnUi(event.target, path)) {
      return;
    }

    if (this.abortController) {
      this.attachToAccessibleIframes(this.abortController.signal);
    }

    if (event instanceof MouseEvent && (event.clientX !== 0 || event.clientY !== 0)) {
      const owningFrame = findOwningIframe(event.target);
      const frameOffset = owningFrame?.getBoundingClientRect();
      const offsetX = frameOffset?.left ?? 0;
      const offsetY = frameOffset?.top ?? 0;
      this.lastPointerRect = {
        top: event.clientY + offsetY,
        left: event.clientX + offsetX,
        right: event.clientX + offsetX,
        bottom: event.clientY + offsetY,
      };
    } else if (event instanceof KeyboardEvent) {
      this.lastPointerRect = null;
    }

    const cleanOpts: CleanTextOptions = {
      omitCodeBlocks: this.options.omitCodeBlocks?.() ?? true,
      omitFileNames: this.options.omitFileNames?.() ?? true,
      stripUrls: this.options.stripUrls?.() ?? true,
    };

    const resolved = this.resolveUniversalSelection(cleanOpts, true);
    if (!resolved?.rect) {
      this.clearIfActive();
      return;
    }

    this.lastResolvedText = resolved.text;
    const position = clampFloatingPosition(resolved.rect, DEFAULT_BUTTON_SIZE, {
      width: window.innerWidth || 1024,
      height: window.innerHeight || 768,
    });

    this.hasActiveTrigger = true;
    this.options.onSelect({ text: resolved.text, position });
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (
      event.shiftKey ||
      event.key === 'Shift' ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')
    ) {
      this.handleSelectionEvent(event);
    }
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : undefined;
    if (this.options.isInsideOwnUi(event.target, path)) {
      return;
    }
    this.clearIfActive();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.clearIfActive();
    }
  };

  private clearIfActive(): void {
    this.lastPointerRect = null;
    this.lastResolvedText = '';
    if (!this.hasActiveTrigger) {
      return;
    }
    this.hasActiveTrigger = false;
    this.options.onClear();
  }
}
