import { PLAYBACK_RATES, type PlaybackRate, type SentenceQueueState } from '../../shared/types';

export interface MiniPlayerCallbacks {
  readonly onTogglePlayPause: () => void;
  readonly onStop: () => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onRateChange: (rate: PlaybackRate) => void;
  readonly onLayoutChange?: (rect: DOMRect | null) => void;
}

const VIEWPORT_MARGIN = 8;
const KEYBOARD_MOVE_STEP = 24;

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

/**
 * Draggable floating playback controller rendered inside the Shadow DOM with pointer capture,
 * keyboard arrow repositioning, live speed toggle, and WCAG 2.2 AA ARIA live regions.
 */
export class MiniPlayer {
  private readonly root: HTMLDivElement;
  private readonly dragHandle: HTMLButtonElement;
  private readonly statusDot: HTMLSpanElement;
  private readonly statusLabel: HTMLSpanElement;
  private readonly liveAnnouncer: HTMLSpanElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly rateBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly callbacks: MiniPlayerCallbacks;
  private currentRate: PlaybackRate = 1;
  private lastAnnouncedStatus: SentenceQueueState['status'] = 'idle';

  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private customPosition: { left: number; top: number } | null = null;

  public constructor(container: HTMLElement, callbacks: MiniPlayerCallbacks) {
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.className = 'es-player';
    this.root.setAttribute('lang', 'es');
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'ReadFlow player');
    this.root.hidden = true;

    this.dragHandle = document.createElement('button');
    this.dragHandle.type = 'button';
    this.dragHandle.className = 'es-drag-handle';
    this.dragHandle.setAttribute('data-es-role', 'drag-handle');
    this.dragHandle.setAttribute(
      'aria-label',
      'Mover ventana del reproductor (arrastrar o usar flechas, Inicio para restablecer)'
    );
    this.dragHandle.title = 'Arrastra para mover (o usa flechas del teclado)';
    this.dragHandle.textContent = '⋮⋮';

    this.statusDot = document.createElement('span');
    this.statusDot.className = 'es-status-dot';
    this.statusDot.setAttribute('aria-hidden', 'true');

    this.statusLabel = document.createElement('span');
    this.statusLabel.className = 'es-status-label';
    this.statusLabel.setAttribute('aria-hidden', 'true');

    this.liveAnnouncer = document.createElement('span');
    this.liveAnnouncer.setAttribute('role', 'status');
    this.liveAnnouncer.setAttribute('aria-live', 'polite');
    this.liveAnnouncer.setAttribute('aria-atomic', 'true');
    this.liveAnnouncer.style.cssText =
      'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;';

    const group = document.createElement('div');
    group.className = 'es-toolbar';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Controles de reproducción');

    this.prevBtn = createControlButton('prev', 'Oración anterior', '⏮');
    this.toggleBtn = createControlButton('toggle', 'Pausar', '⏸', true);
    this.nextBtn = createControlButton('next', 'Oración siguiente', '⏭');
    this.rateBtn = createControlButton('rate', 'Velocidad de reproducción', '1x');
    this.stopBtn = createControlButton('stop', 'Detener lectura', '⏹');

    this.dragHandle.addEventListener('pointerdown', this.handlePointerDown);
    this.dragHandle.addEventListener('pointermove', this.handlePointerMove);
    this.dragHandle.addEventListener('pointerup', this.handlePointerUp);
    this.dragHandle.addEventListener('pointercancel', this.handlePointerUp);
    this.dragHandle.addEventListener('keydown', this.handleDragKeyDown);
    window.addEventListener('resize', this.handleWindowResize);

    this.prevBtn.addEventListener('click', this.handlePrev);
    this.toggleBtn.addEventListener('click', this.handleToggle);
    this.nextBtn.addEventListener('click', this.handleNext);
    this.rateBtn.addEventListener('click', this.handleRate);
    this.stopBtn.addEventListener('click', this.handleStop);

    group.append(this.prevBtn, this.toggleBtn, this.nextBtn, this.rateBtn, this.stopBtn);
    this.root.append(this.dragHandle, this.statusDot, this.statusLabel, this.liveAnnouncer, group);
    container.appendChild(this.root);
  }

  public focusPrimaryControl(): void {
    if (!this.root.hidden) {
      this.toggleBtn.focus();
    }
  }

  public resetPosition(): void {
    this.customPosition = null;
    this.root.style.left = '';
    this.root.style.top = '';
    this.root.style.right = '';
    this.root.style.bottom = '';
    this.notifyLayoutChange();
  }

  public getVisibleRect(): DOMRect | null {
    if (this.root.hidden) {
      return null;
    }
    const rect = this.root.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return rect;
    }
    // Provide realistic fallback box in synthetic DOMs (e.g. happy-dom) where layout rects are 0x0.
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const width = 280;
    const height = 48;
    const left = this.customPosition?.left ?? vw - 20 - width;
    const top = this.customPosition?.top ?? vh - 20 - height;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  private notifyLayoutChange(): void {
    this.callbacks.onLayoutChange?.(this.getVisibleRect());
  }

  public update(state: SentenceQueueState): void {
    this.currentRate = state.rate;
    this.rateBtn.textContent = `${state.rate}x`;
    this.rateBtn.setAttribute('aria-label', `Velocidad de reproducción ${state.rate}x`);

    if (state.status === 'idle') {
      this.root.hidden = true;
      this.lastAnnouncedStatus = 'idle';
      this.liveAnnouncer.textContent = '';
      this.notifyLayoutChange();
      return;
    }

    this.root.hidden = false;
    this.statusDot.setAttribute('data-status', state.status);
    this.notifyLayoutChange();

    const isNavDisabled = state.status === 'error' || state.status === 'loading';
    this.prevBtn.disabled = isNavDisabled;
    this.nextBtn.disabled = isNavDisabled;

    const suffix = state.status !== 'error' && state.hasMoreChunks ? '+' : '';
    const progress =
      state.items.length > 0 ? `${state.currentIndex + 1}/${state.items.length}${suffix}` : '';

    if (state.status === 'playing') {
      this.statusLabel.textContent = progress ? `Leyendo ${progress}` : 'Leyendo';
      this.toggleBtn.textContent = '⏸';
      this.toggleBtn.setAttribute('aria-label', 'Pausar');
      this.announceIfChanged('playing', 'Leyendo', false);
    } else if (state.status === 'paused') {
      this.statusLabel.textContent = progress ? `Pausado ${progress}` : 'Pausado';
      this.toggleBtn.textContent = '▶';
      this.toggleBtn.setAttribute('aria-label', 'Reanudar');
      this.announceIfChanged('paused', 'Pausado', false);
    } else if (state.status === 'loading') {
      const msg = state.loadingMessage || 'Preparando voz...';
      this.statusLabel.textContent = msg;
      this.toggleBtn.textContent = '⏸';
      this.toggleBtn.setAttribute('aria-label', 'Cargando');
      this.announceIfChanged('loading', msg, false);
    } else if (state.status === 'error') {
      this.statusLabel.textContent = state.error.message;
      this.toggleBtn.textContent = '▶';
      this.toggleBtn.setAttribute('aria-label', 'Reintentar');
      this.announceIfChanged('error', state.error.message, true);
    }
  }

  public destroy(): void {
    this.dragHandle.removeEventListener('pointerdown', this.handlePointerDown);
    this.dragHandle.removeEventListener('pointermove', this.handlePointerMove);
    this.dragHandle.removeEventListener('pointerup', this.handlePointerUp);
    this.dragHandle.removeEventListener('pointercancel', this.handlePointerUp);
    this.dragHandle.removeEventListener('keydown', this.handleDragKeyDown);
    window.removeEventListener('resize', this.handleWindowResize);

    this.prevBtn.removeEventListener('click', this.handlePrev);
    this.toggleBtn.removeEventListener('click', this.handleToggle);
    this.nextBtn.removeEventListener('click', this.handleNext);
    this.rateBtn.removeEventListener('click', this.handleRate);
    this.stopBtn.removeEventListener('click', this.handleStop);
    this.root.remove();
  }

  private applyClampedPosition(left: number, top: number): void {
    const rect = this.root.getBoundingClientRect();
    const width = rect.width || 280;
    const height = rect.height || 48;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    const maxLeft = Math.max(VIEWPORT_MARGIN, vw - width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, vh - height - VIEWPORT_MARGIN);

    const clampedLeft = Math.round(Math.min(Math.max(VIEWPORT_MARGIN, left), maxLeft));
    const clampedTop = Math.round(Math.min(Math.max(VIEWPORT_MARGIN, top), maxTop));

    this.customPosition = { left: clampedLeft, top: clampedTop };
    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
    this.root.style.left = `${clampedLeft}px`;
    this.root.style.top = `${clampedTop}px`;
    this.notifyLayoutChange();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const rect = this.root.getBoundingClientRect();
    this.isDragging = true;
    this.dragOffsetX = event.clientX - rect.left;
    this.dragOffsetY = event.clientY - rect.top;
    this.root.setAttribute('data-dragging', 'true');
    if (typeof this.dragHandle.setPointerCapture === 'function') {
      try {
        this.dragHandle.setPointerCapture(event.pointerId);
      } catch {
        // Ignore capture errors in synthetic test environments.
      }
    }
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.isDragging) return;
    this.applyClampedPosition(event.clientX - this.dragOffsetX, event.clientY - this.dragOffsetY);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.root.removeAttribute('data-dragging');
    if (typeof this.dragHandle.releasePointerCapture === 'function') {
      try {
        this.dragHandle.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore release errors when pointer wasn't captured.
      }
    }
  };

  private readonly handleDragKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Home') {
      event.preventDefault();
      this.resetPosition();
      return;
    }

    const deltas: Record<string, readonly [number, number]> = {
      ArrowLeft: [-KEYBOARD_MOVE_STEP, 0],
      ArrowRight: [KEYBOARD_MOVE_STEP, 0],
      ArrowUp: [0, -KEYBOARD_MOVE_STEP],
      ArrowDown: [0, KEYBOARD_MOVE_STEP],
    };

    const delta = deltas[event.key];
    if (!delta) return;

    event.preventDefault();
    const rect = this.root.getBoundingClientRect();
    const baseLeft = this.customPosition?.left ?? (rect.left || (window.innerWidth || 1024) - 300);
    const baseTop = this.customPosition?.top ?? (rect.top || (window.innerHeight || 768) - 70);
    this.applyClampedPosition(baseLeft + delta[0], baseTop + delta[1]);
  };

  private readonly handleWindowResize = (): void => {
    if (this.customPosition) {
      this.applyClampedPosition(this.customPosition.left, this.customPosition.top);
    }
  };

  private announceIfChanged(
    status: SentenceQueueState['status'],
    text: string,
    isAlert: boolean
  ): void {
    if (this.lastAnnouncedStatus === status && !isAlert) {
      return;
    }
    this.lastAnnouncedStatus = status;
    this.liveAnnouncer.setAttribute('role', isAlert ? 'alert' : 'status');
    this.liveAnnouncer.setAttribute('aria-live', isAlert ? 'assertive' : 'polite');
    this.liveAnnouncer.textContent = text;
  }

  private readonly handlePrev = (): void => this.callbacks.onPrev();
  private readonly handleToggle = (): void => this.callbacks.onTogglePlayPause();
  private readonly handleNext = (): void => this.callbacks.onNext();
  private readonly handleRate = (): void =>
    this.callbacks.onRateChange(getNextRate(this.currentRate));
  private readonly handleStop = (): void => this.callbacks.onStop();
}
