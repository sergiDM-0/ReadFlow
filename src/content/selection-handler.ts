import { extractCleanTextFromRange } from '../core/cleaner';

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
  readonly stripUrls?: () => boolean;
}

const VIEWPORT_PADDING = 8;
const TRIGGER_OFFSET = 8;
const DEFAULT_BUTTON_SIZE: SizeLike = { width: 38, height: 38 };

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

function getSelectionAnchorRect(range: Range): RectLike | null {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  if (rects.length > 0) {
    return rects[rects.length - 1] ?? null;
  }
  const bounding = range.getBoundingClientRect();
  if (bounding.width === 0 && bounding.height === 0) {
    return null;
  }
  return bounding;
}

/**
 * Observes mouse and keyboard text selections in the host document while ignoring events
 * originating inside EchoSelect's own Shadow DOM UI.
 */
export class SelectionHandler {
  private readonly options: SelectionHandlerOptions;
  private abortController: AbortController | null = null;
  private hasActiveTrigger = false;

  public constructor(options: SelectionHandlerOptions) {
    this.options = options;
  }

  public attach(): void {
    if (this.abortController) {
      return;
    }
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    document.addEventListener('mouseup', this.handleSelectionEvent, { signal });
    document.addEventListener('keyup', this.handleKeyUp, { signal });
    document.addEventListener('mousedown', this.handleMouseDown, { signal });
    document.addEventListener('keydown', this.handleKeyDown, { signal });
  }

  public detach(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.hasActiveTrigger = false;
  }

  public getCurrentSelectedText(): string {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return '';
    }
    const range = selection.getRangeAt(0);
    return extractCleanTextFromRange(range, {
      omitCodeBlocks: this.options.omitCodeBlocks?.() ?? true,
      stripUrls: this.options.stripUrls?.() ?? true,
    });
  }

  private readonly handleSelectionEvent = (event: Event): void => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : undefined;
    if (this.options.isInsideOwnUi(event.target, path)) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      this.clearIfActive();
      return;
    }

    const range = selection.getRangeAt(0);
    const text = extractCleanTextFromRange(range, {
      omitCodeBlocks: this.options.omitCodeBlocks?.() ?? true,
      stripUrls: this.options.stripUrls?.() ?? true,
    });

    if (!text) {
      this.clearIfActive();
      return;
    }

    const anchorRect = getSelectionAnchorRect(range);
    if (!anchorRect) {
      this.clearIfActive();
      return;
    }

    const position = clampFloatingPosition(anchorRect, DEFAULT_BUTTON_SIZE, {
      width: window.innerWidth || 1024,
      height: window.innerHeight || 768,
    });

    this.hasActiveTrigger = true;
    this.options.onSelect({ text, position });
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (event.shiftKey || event.key === 'Shift') {
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
    if (!this.hasActiveTrigger) {
      return;
    }
    this.hasActiveTrigger = false;
    this.options.onClear();
  }
}
