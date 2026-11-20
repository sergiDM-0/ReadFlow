export interface SiteSelectorConfig {
  readonly hostPattern: RegExp;
  readonly chatContainer: readonly string[];
  readonly modelTurn: readonly string[];
  readonly readableBlocks: readonly string[];
  readonly excludedSubtrees: readonly string[];
  readonly streamingIndicator: readonly string[];
}

export const GEMINI_SELECTORS: SiteSelectorConfig = {
  hostPattern: /(^|\.)gemini\.google\.com$/i,
  chatContainer: ['main', '[role="main"]', 'chat-window', 'infinite-scroller'],
  modelTurn: [
    'model-response',
    '[data-message-author-role="model"]',
    'message-content',
    '.model-response-text',
  ],
  readableBlocks: ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'],
  excludedSubtrees: [
    'pre',
    'code',
    'code-block',
    'button',
    'svg',
    'mat-icon',
    '[aria-hidden="true"]',
  ],
  streamingIndicator: ['[aria-busy="true"]', '.streaming', 'mat-progress-bar'],
};
