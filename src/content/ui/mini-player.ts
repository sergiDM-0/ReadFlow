import { PLAYBACK_RATES, type PlaybackRate, type SentenceQueueState } from '../../shared/types';

export interface MiniPlayerCallbacks {
  readonly onTogglePlayPause: () => void;
  readonly onStop: () => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onRateChange: (rate: PlaybackRate) => void;
}

function getNextRate(current: PlaybackRate): PlaybackRate {
  const index = PLAYBACK_RATES.indexOf(current);
  const nextIndex = index === -1 ? 1 : (index + 1) % PLAYBACK_RATES.length;
  return PLAYBACK_RATES[nextIndex] ?? 1;
}

function createControlButton(
  action: string,
  label: string,
  text: string,
  isPrimary = false
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'es-ctrl-btn';
  btn.setAttribute('data-es-action', action);
  btn.setAttribute('aria-label', label);
  if (isPrimary) {
    btn.setAttribute('data-primary', 'true');
  }
  btn.textContent = text;
  return btn;
}

export class MiniPlayer {
  private readonly root: HTMLDivElement;
  private readonly statusDot: HTMLSpanElement;
  private readonly statusLabel: HTMLSpanElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly rateBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly callbacks: MiniPlayerCallbacks;
  private currentRate: PlaybackRate = 1;

  public constructor(container: HTMLElement, callbacks: MiniPlayerCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.className = 'es-player';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'EchoSelect TTS player');
    this.root.hidden = true;

    this.statusDot = document.createElement('span');
    this.statusDot.className = 'es-status-dot';
    this.statusDot.setAttribute('aria-hidden', 'true');

    this.statusLabel = document.createElement('span');
    this.statusLabel.className = 'es-status-label';
    this.statusLabel.setAttribute('role', 'status');
    this.statusLabel.setAttribute('aria-live', 'polite');

    const toolbar = document.createElement('div');
    toolbar.className = 'es-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Playback controls');

    this.prevBtn = createControlButton('prev', 'Previous sentence', '⏮');
    this.toggleBtn = createControlButton('toggle', 'Pause', '⏸', true);
    this.nextBtn = createControlButton('next', 'Next sentence', '⏭');
    this.rateBtn = createControlButton('rate', 'Playback speed', '1x');
    this.stopBtn = createControlButton('stop', 'Stop reading', '⏹');

    this.prevBtn.addEventListener('click', this.handlePrev);
    this.toggleBtn.addEventListener('click', this.handleToggle);
    this.nextBtn.addEventListener('click', this.handleNext);
    this.rateBtn.addEventListener('click', this.handleRate);
    this.stopBtn.addEventListener('click', this.handleStop);

    toolbar.append(this.prevBtn, this.toggleBtn, this.nextBtn, this.rateBtn, this.stopBtn);
    this.root.append(this.statusDot, this.statusLabel, toolbar);
    container.appendChild(this.root);
  }

  public update(state: SentenceQueueState): void {
    this.currentRate = state.rate;
    this.rateBtn.textContent = `${state.rate}x`;
    this.rateBtn.setAttribute('aria-label', `Playback speed ${state.rate}x`);

    if (state.status === 'idle') {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    this.statusDot.setAttribute('data-status', state.status);

    const progress =
      state.items.length > 0 ? `${state.currentIndex + 1}/${state.items.length}` : '';

    if (state.status === 'playing') {
      this.statusLabel.textContent = progress ? `Leyendo ${progress}` : 'Leyendo';
      this.toggleBtn.textContent = '⏸';
      this.toggleBtn.setAttribute('aria-label', 'Pause');
      this.toggleBtn.setAttribute('aria-pressed', 'false');
    } else if (state.status === 'paused') {
      this.statusLabel.textContent = progress ? `Pausado ${progress}` : 'Pausado';
      this.toggleBtn.textContent = '▶';
      this.toggleBtn.setAttribute('aria-label', 'Resume');
      this.toggleBtn.setAttribute('aria-pressed', 'true');
    } else if (state.status === 'loading') {
      this.statusLabel.textContent = 'Cargando...';
    } else {
      this.statusLabel.textContent = state.error.message;
      this.toggleBtn.textContent = '▶';
      this.toggleBtn.setAttribute('aria-label', 'Retry');
    }
  }

  public destroy(): void {
    this.prevBtn.removeEventListener('click', this.handlePrev);
    this.toggleBtn.removeEventListener('click', this.handleToggle);
    this.nextBtn.removeEventListener('click', this.handleNext);
    this.rateBtn.removeEventListener('click', this.handleRate);
    this.stopBtn.removeEventListener('click', this.handleStop);
    this.root.remove();
  }

  private readonly handlePrev = (): void => this.callbacks.onPrev();
  private readonly handleToggle = (): void => this.callbacks.onTogglePlayPause();
  private readonly handleNext = (): void => this.callbacks.onNext();
  private readonly handleRate = (): void => this.callbacks.onRateChange(getNextRate(this.currentRate));
  private readonly handleStop = (): void => this.callbacks.onStop();
}
