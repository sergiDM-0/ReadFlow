import {
  TTSError,
  type PlaybackRate,
  type QueueSource,
  type SentenceItem,
  type SentenceQueueState,
} from '../shared/types';
import type { TTSEngineInterface } from './engines/engine.interface';

export interface PlayRequestOptions {
  readonly lang: string;
  readonly voiceId?: string;
  readonly rate: PlaybackRate;
  readonly source: QueueSource;
  readonly pullMoreChunks?: () => readonly string[];
  readonly hasMoreChunks?: () => boolean;
}

export type StateListener = (state: SentenceQueueState) => void;

const PROCEDURAL_LOW_WATER_MARK = 3;

export class TTSManager {
  private engine: TTSEngineInterface;
  private state: SentenceQueueState;
  private readonly listeners = new Set<StateListener>();
  private activeController: AbortController | null = null;
  private activeVoiceId: string | undefined;
  private activePullMoreChunks: (() => readonly string[]) | null = null;
  private activeHasMoreChunks: (() => boolean) | null = null;
  private playbackToken = 0;
  private itemSeq = 0;

  public constructor(engine: TTSEngineInterface, initialRate: PlaybackRate = 1) {
    this.engine = engine;
    this.state = {
      status: 'idle',
      items: [],
      currentIndex: -1,
      rate: initialRate,
      detectedLang: null,
      source: null,
      error: null,
    };
  }

  public setEngine(engine: TTSEngineInterface): void {
    this.stop();
    this.engine = engine;
  }

  public getState(): SentenceQueueState {
    return this.state;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async play(sentences: readonly string[], options: PlayRequestOptions): Promise<void> {
    const cleanSentences = sentences.map((s) => s.trim()).filter(Boolean);
    if (cleanSentences.length === 0) {
      return;
    }

    const wasActive =
      this.state.status === 'playing' ||
      this.state.status === 'loading' ||
      this.state.status === 'paused';
    this.cancelCurrentUtterance();
    if (wasActive) {
      this.engine.stop();
    }
    this.activeVoiceId = options.voiceId;
    this.activePullMoreChunks = options.pullMoreChunks ?? null;
    this.activeHasMoreChunks = options.hasMoreChunks ?? null;

    const items: SentenceItem[] = cleanSentences.map((text, index) => ({
      id: `seg-${++this.itemSeq}`,
      index,
      text,
      lang: options.lang,
    }));

    this.setState({
      status: 'playing',
      items,
      currentIndex: 0,
      rate: options.rate,
      detectedLang: options.lang,
      source: options.source,
      hasMoreChunks: this.activeHasMoreChunks?.() ?? false,
      error: null,
    });

    await this.speakAtIndex(0);
  }

  public async enqueue(sentences: readonly string[], options: PlayRequestOptions): Promise<void> {
    const cleanSentences = sentences.map((s) => s.trim()).filter(Boolean);
    if (cleanSentences.length === 0) {
      return;
    }

    if (this.state.status === 'idle' || this.state.status === 'error') {
      await this.play(cleanSentences, options);
      return;
    }

    const baseIndex = this.state.items.length;
    const appended: SentenceItem[] = cleanSentences.map((text, offset) => ({
      id: `seg-${++this.itemSeq}`,
      index: baseIndex + offset,
      text,
      lang: options.lang,
    }));

    this.setState({
      ...this.state,
      items: [...this.state.items, ...appended],
    });

    // Immediately pre-synthesize newly streamed sentences that fall within the lookahead window.
    if (
      this.engine.prefetch &&
      (this.state.status === 'playing' || this.state.status === 'loading')
    ) {
      for (const item of appended) {
        if (item.index > this.state.currentIndex && item.index <= this.state.currentIndex + 2) {
          this.engine.prefetch(item.text, {
            lang: item.lang,
            voiceId: this.activeVoiceId,
            rate: this.state.rate,
          });
        }
      }
    }
  }

  public pause(): void {
    if (this.state.status !== 'playing') {
      return;
    }
    if (this.engine.capabilities.supportsPauseResume) {
      this.engine.pause();
    } else {
      this.cancelCurrentUtterance();
      this.engine.stop();
    }
    this.setState({ ...this.state, status: 'paused' });
  }

  public resume(): void {
    if (this.state.status !== 'paused') {
      return;
    }
    if (this.engine.capabilities.supportsPauseResume) {
      this.engine.resume();
      this.setState({ ...this.state, status: 'playing' });
    } else {
      const index = this.state.currentIndex;
      this.setState({ ...this.state, status: 'playing' });
      void this.speakAtIndex(index);
    }
  }

  public retry(): void {
    if (this.state.status !== 'error') {
      return;
    }
    const index = Math.max(0, this.state.currentIndex);
    if (!this.state.items[index]) {
      this.stop();
      return;
    }
    this.cancelCurrentUtterance();
    this.setState({
      status: 'playing',
      items: this.state.items,
      currentIndex: index,
      rate: this.state.rate,
      detectedLang: this.state.detectedLang ?? 'en',
      source: this.state.source ?? 'selection',
      error: null,
    });
    void this.speakAtIndex(index);
  }

  public togglePauseResume(): void {
    if (this.state.status === 'playing') {
      this.pause();
    } else if (this.state.status === 'paused') {
      this.resume();
    } else if (this.state.status === 'error') {
      this.retry();
    }
  }

  public next(): void {
    if (this.state.status !== 'playing' && this.state.status !== 'paused') {
      return;
    }
    const nextIndex = this.state.currentIndex + 1;
    if (nextIndex >= this.state.items.length) {
      this.stop();
      return;
    }
    this.jumpTo(nextIndex);
  }

  public prev(): void {
    if (this.state.status !== 'playing' && this.state.status !== 'paused') {
      return;
    }
    const prevIndex = Math.max(0, this.state.currentIndex - 1);
    this.jumpTo(prevIndex);
  }

  public setRate(rate: PlaybackRate): void {
    if (this.state.status === 'idle' || this.state.status === 'error') {
      this.setState({ ...this.state, rate });
      return;
    }

    const isActive = this.state.status === 'playing' || this.state.status === 'loading';
    const currentIndex = this.state.currentIndex;
    this.setState({ ...this.state, rate });

    if (this.engine.capabilities.supportsLiveRateChange && this.engine.setPlaybackRate) {
      this.engine.setPlaybackRate(rate);
    } else if (isActive) {
      this.jumpTo(currentIndex);
    }
  }

  public stop(): void {
    this.cancelCurrentUtterance();
    this.activePullMoreChunks = null;
    this.activeHasMoreChunks = null;
    this.engine.stop();
    this.setState({
      status: 'idle',
      items: [],
      currentIndex: -1,
      rate: this.state.rate,
      detectedLang: null,
      source: null,
      error: null,
    });
  }

  public dispose(): void {
    this.stop();
    this.engine.dispose();
    this.listeners.clear();
  }

  private jumpTo(index: number): void {
    if (
      this.state.status !== 'playing' &&
      this.state.status !== 'loading' &&
      this.state.status !== 'paused'
    ) {
      return;
    }
    this.cancelCurrentUtterance();
    if (!this.engine.capabilities.supportsLiveRateChange) {
      this.engine.stop();
    }
    this.setState({
      ...this.state,
      status: 'playing',
      currentIndex: index,
    });
    void this.speakAtIndex(index);
  }

  private cancelCurrentUtterance(): void {
    this.playbackToken += 1;
    this.activeController?.abort();
    this.activeController = null;
  }

  private ensureProceduralBuffer(currentIndex: number): void {
    if (
      !this.activePullMoreChunks ||
      (this.state.status !== 'playing' &&
        this.state.status !== 'loading' &&
        this.state.status !== 'paused')
    ) {
      return;
    }

    let items = this.state.items;
    let addedAny = false;

    while (items.length - 1 - currentIndex < PROCEDURAL_LOW_WATER_MARK) {
      const nextBatch = this.activePullMoreChunks()
        .map((s) => s.trim())
        .filter(Boolean);
      if (nextBatch.length === 0) {
        this.activePullMoreChunks = null;
        break;
      }

      const baseIndex = items.length;
      const lang = this.state.detectedLang;
      const appended: SentenceItem[] = nextBatch.map((text, offset) => ({
        id: `seg-${++this.itemSeq}`,
        index: baseIndex + offset,
        text,
        lang,
      }));
      items = [...items, ...appended];
      addedAny = true;

      if (this.activeHasMoreChunks && !this.activeHasMoreChunks()) {
        this.activePullMoreChunks = null;
        break;
      }
    }

    const stillHasMore = Boolean(
      this.activePullMoreChunks && (this.activeHasMoreChunks?.() ?? true)
    );
    if (addedAny || Boolean(this.state.hasMoreChunks) !== stillHasMore) {
      this.setState({
        ...this.state,
        items,
        hasMoreChunks: stillHasMore,
      });
    }
  }

  private async speakAtIndex(index: number): Promise<void> {
    if (this.state.status !== 'playing') {
      return;
    }

    this.ensureProceduralBuffer(index);

    const item = this.state.items[index];
    if (!item) {
      this.stop();
      return;
    }

    const token = ++this.playbackToken;
    const controller = new AbortController();
    this.activeController = controller;

    try {
      // Launch current segment FIRST so it enters the synthesis queue ahead of lookahead prefetches.
      const speakPromise = this.engine.speak(item.text, {
        lang: item.lang,
        voiceId: this.activeVoiceId,
        rate: this.state.rate,
        signal: controller.signal,
        onProgress: (loadingMessage) => {
          if (
            token !== this.playbackToken ||
            this.state.status === 'idle' ||
            this.state.status === 'paused'
          ) {
            return;
          }
          if (this.state.status === 'playing' || this.state.status === 'loading') {
            this.setState({
              ...this.state,
              status: 'loading',
              loadingMessage,
            });
          }
        },
        onPlaying: () => {
          if (token !== this.playbackToken || this.state.status !== 'loading') {
            return;
          }
          this.setState({
            ...this.state,
            status: 'playing',
            loadingMessage: undefined,
          });
        },
      });

      // Pipeline lookahead: pre-synthesize the next 2 chunks behind the active chunk for gapless streaming.
      if (this.engine.prefetch) {
        for (let offset = 1; offset <= 2; offset += 1) {
          const upcoming = this.state.items[index + offset];
          if (upcoming) {
            this.engine.prefetch(upcoming.text, {
              lang: upcoming.lang,
              voiceId: this.activeVoiceId,
              rate: this.state.rate,
            });
          }
        }
      }

      await speakPromise;

      if (
        token !== this.playbackToken ||
        (this.state.status !== 'playing' && this.state.status !== 'loading')
      ) {
        return;
      }

      const nextIndex = index + 1;
      this.ensureProceduralBuffer(nextIndex);
      if (nextIndex < this.state.items.length) {
        this.setState({
          ...this.state,
          status: 'playing',
          loadingMessage: undefined,
          currentIndex: nextIndex,
        });
        await this.speakAtIndex(nextIndex);
      } else {
        this.stop();
      }
    } catch (err) {
      if (token !== this.playbackToken) {
        return;
      }
      if (err instanceof TTSError && err.code === 'ABORTED') {
        return;
      }

      const ttsError =
        err instanceof TTSError
          ? err
          : new TTSError('SYNTHESIS_FAILED', err instanceof Error ? err.message : 'TTS failed');

      this.setState({
        status: 'error',
        items: this.state.items,
        currentIndex: index,
        rate: this.state.rate,
        detectedLang: this.state.detectedLang,
        source: this.state.source,
        error: { code: ttsError.code, message: ttsError.message },
      });
    }
  }

  private setState(next: SentenceQueueState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
