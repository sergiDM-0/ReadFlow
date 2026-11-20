import { cleanText, isAttachmentOrMediaNode } from '../../core/cleaner';
import { segmentSentences } from '../../core/segmenter';
import { GEMINI_SELECTORS, type SiteSelectorConfig } from './gemini-selectors';

export interface GeminiAdapterOptions {
  readonly root?: Element;
  readonly selectors?: SiteSelectorConfig;
  readonly omitCodeBlocks?: boolean;
  readonly omitFileNames?: boolean;
  readonly settleMs?: number;
  readonly onSentences: (sentences: readonly string[]) => void;
}

const DEFAULT_SETTLE_MS = 450;

function queryFirst(root: Document | Element, selectors: readonly string[]): Element | null {
  for (const sel of selectors) {
    const found = root.querySelector(sel);
    if (found) return found;
  }
  return null;
}

function queryAllCombined(root: Element, selectors: readonly string[]): Element[] {
  const combined = selectors.join(', ');
  try {
    return Array.from(root.querySelectorAll(combined));
  } catch {
    return [];
  }
}

function isExcludedElement(el: Element, excluded: readonly string[]): boolean {
  for (const sel of excluded) {
    if (el.matches(sel) || el.closest(sel)) {
      return true;
    }
  }
  return false;
}

function hashSentence(text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${normalized.length}:${hash >>> 0}`;
}

/**
 * Streaming `MutationObserver` adapter for `gemini.google.com` that extracts newly completed
 * sentences from model response turns while deduplicating via FNV-1a fingerprints and skipping code blocks.
 */
export class GeminiAdapter {
  private readonly selectors: SiteSelectorConfig;
  private readonly rootOverride?: Element;
  private omitCodeBlocks: boolean;
  private omitFileNames: boolean;
  private readonly settleMs: number;
  private readonly onSentences: (sentences: readonly string[]) => void;

  private observer: MutationObserver | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private readonly seenHistoryTurns = new WeakSet<Element>();
  private readonly spokenFingerprints = new WeakMap<Element, Set<string>>();

  public constructor(options: GeminiAdapterOptions) {
    this.selectors = options.selectors ?? GEMINI_SELECTORS;
    this.rootOverride = options.root;
    this.omitCodeBlocks = options.omitCodeBlocks ?? true;
    this.omitFileNames = options.omitFileNames ?? true;
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.onSentences = options.onSentences;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setSanitizeOptions(options: {
    readonly omitCodeBlocks: boolean;
    readonly omitFileNames: boolean;
  }): void {
    this.omitCodeBlocks = options.omitCodeBlocks;
    this.omitFileNames = options.omitFileNames;
  }

  public setEnabled(next: boolean): void {
    if (this.enabled === next) {
      return;
    }
    this.enabled = next;

    if (next) {
      this.startObserving();
    } else {
      this.stopObserving();
    }
  }

  public dispose(): void {
    this.enabled = false;
    this.stopObserving();
  }

  private getTargetRoot(): Element | null {
    if (this.rootOverride) {
      return this.rootOverride;
    }
    return queryFirst(document, this.selectors.chatContainer) ?? document.body;
  }

  private startObserving(): void {
    const root = this.getTargetRoot();
    if (!root) {
      return;
    }

    for (const existingTurn of queryAllCombined(root, this.selectors.modelTurn)) {
      this.seenHistoryTurns.add(existingTurn);
    }

    this.observer = new MutationObserver(() => {
      if (!this.enabled) return;
      this.processActiveTurns(false);
      this.scheduleSettleFlush();
    });

    this.observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  private scheduleSettleFlush(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.enabled) {
        this.processActiveTurns(true);
      }
    }, this.settleMs);
  }

  private processActiveTurns(isSettled: boolean): void {
    const root = this.getTargetRoot();
    if (!root) return;

    const allTurns = queryAllCombined(root, this.selectors.modelTurn);
    const topLevelTurns = allTurns.filter(
      (turn) => !allTurns.some((other) => other !== turn && other.contains(turn))
    );
    const turns = topLevelTurns.filter((turn) => !this.seenHistoryTurns.has(turn));

    const newlyCompleted: string[] = [];

    for (const turn of turns) {
      let spoken = this.spokenFingerprints.get(turn);
      if (!spoken) {
        spoken = new Set<string>();
        this.spokenFingerprints.set(turn, spoken);
      }

      const blocks = queryAllCombined(turn, this.selectors.readableBlocks).filter(
        (block) =>
          !isExcludedElement(block, this.selectors.excludedSubtrees) &&
          !(this.omitFileNames && isAttachmentOrMediaNode(block))
      );

      const isStreaming = Boolean(queryFirst(turn, this.selectors.streamingIndicator));

      blocks.forEach((block, blockIdx) => {
        const isLastBlock = blockIdx === blocks.length - 1;
        const rawText = this.extractBlockText(block);
        const cleaned = cleanText(rawText, {
          omitCodeBlocks: this.omitCodeBlocks,
          omitFileNames: this.omitFileNames,
        });
        if (!cleaned) return;

        const sentences = segmentSentences(cleaned);
        const shouldCommitTail = !isLastBlock || (isSettled && !isStreaming);
        const limit = shouldCommitTail ? sentences.length : Math.max(0, sentences.length - 1);

        for (let i = 0; i < limit; i += 1) {
          const sentence = sentences[i];
          if (!sentence) continue;
          const fingerprint = hashSentence(sentence);
          if (!spoken.has(fingerprint)) {
            spoken.add(fingerprint);
            newlyCompleted.push(sentence);
          }
        }
      });
    }

    if (newlyCompleted.length > 0) {
      this.onSentences(newlyCompleted);
    }
  }

  private extractBlockText(block: Element): string {
    const parts: string[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent ?? '');
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      if (
        isExcludedElement(el, this.selectors.excludedSubtrees) ||
        (this.omitFileNames && isAttachmentOrMediaNode(el))
      ) {
        return;
      }
      for (const child of Array.from(el.childNodes)) {
        walk(child);
      }
    };
    walk(block);
    return parts.join(' ');
  }
}
