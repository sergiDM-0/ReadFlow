import type { DockCorner } from '../../shared/types';

export interface AutoReadDockCallbacks {
  readonly onToggleAutoRead: () => void;
  readonly onCornerChange: (corner: DockCorner) => void;
  readonly onMinimizedChange: (minimized: boolean) => void;
}

export interface AutoReadDockState {
  readonly active: boolean;
  readonly corner: DockCorner;
  readonly minimized: boolean;
}

const EDGE_MARGIN = 12;
const DRAG_THRESHOLD_PX = 5;
const COLLISION_OFFSET_PX = 64;

function createSpeakerSvg(active: boolean): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const body = document.createElementNS(ns, 'polygon');
  body.setAttribute('points', '11 5 6 9 2 9 2 15 6 15 11 19 11 5');
  svg.appendChild(body);

  if (active) {
    const wave1 = document.createElementNS(ns, 'path');
    wave1.setAttribute('d', 'M15.54 8.46a5 5 0 0 1 0 7.07');
    const wave2 = document.createElementNS(ns, 'path');
    wave2.setAttribute('d', 'M19.07 4.93a10 10 0 0 1 0 14.14');
    svg.append(wave1, wave2);
  } else {
    const slash1 = document.createElementNS(ns, 'line');
    slash1.setAttribute('x1', '22');
    slash1.setAttribute('y1', '9');
    slash1.setAttribute('x2', '16');
    slash1.setAttribute('y2', '15');
    const slash2 = document.createElementNS(ns, 'line');
    slash2.setAttribute('x1', '16');
    slash2.setAttribute('y1', '9');
    slash2.setAttribute('x2', '22');
    slash2.setAttribute('y2', '15');
    svg.append(slash1, slash2);
  }

  return svg;
}

export function resolveNearestCorner(
  centerX: number,
  centerY: number,
  viewportWidth: number,
  viewportHeight: number
): DockCorner {
  const vertical = centerY < viewportHeight / 2 ? 'top' : 'bottom';
  const horizontal = centerX < viewportWidth / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}`;
}

function rectsOverlap(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
  pad = 8
): boolean {
  return !(
    a.right + pad < b.left ||
    a.left - pad > b.right ||
    a.bottom + pad < b.top ||
    a.top - pad > b.bottom
  );
}

export class AutoReadDock {
  private readonly root: HTMLDivElement;
  private readonly toggleBtn: HTMLButtonElement;
  private readonly iconSlot: HTMLSpanElement;
  private readonly labelEl: HTMLSpanElement;
  private readonly badgeEl: HTMLSpanElement;
  private readonly collapseBtn: HTMLButtonElement;
  private readonly orbDot: HTMLSpanElement;
  private readonly callbacks: AutoReadDockCallbacks;

  private active = false;
  private corner: DockCorner = 'bottom-right';
  private minimized = false;
  private avoidPlayerCollision = false;

  private pointerActive = false;
  private didDrag = false;
  private startClientX = 0;
  private startClientY = 0;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private suppressNextClick = false;
  private lastPlayerRect: DOMRect | null = null;

  public constructor(
    container: HTMLElement,
    initialState: AutoReadDockState,
    callbacks: AutoReadDockCallbacks
  ) {
    this.callbacks = callbacks;
    this.active = initialState.active;
    this.corner = initialState.corner;
    this.minimized = initialState.minimized;

    this.root = document.createElement('div');
    this.root.className = 'es-autoread-dock';
    this.root.setAttribute('data-es-role', 'autoread-dock');

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'es-autoread-main';
    this.toggleBtn.setAttribute('data-es-role', 'gemini-autoread-toggle');

    this.iconSlot = document.createElement('span');
    this.iconSlot.className = 'es-pill-icon';
    this.iconSlot.setAttribute('aria-hidden', 'true');

    this.labelEl = document.createElement('span');
    this.labelEl.className = 'es-pill-label';
    this.labelEl.textContent = 'Auto-lectura';

    this.badgeEl = document.createElement('span');
    this.badgeEl.className = 'es-pill-badge';

    this.orbDot = document.createElement('span');
    this.orbDot.className = 'es-orb-dot';
    this.orbDot.setAttribute('aria-hidden', 'true');

    this.toggleBtn.append(this.iconSlot, this.labelEl, this.badgeEl, this.orbDot);

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'es-autoread-collapse';
    this.collapseBtn.setAttribute('data-es-role', 'autoread-collapse');
    this.collapseBtn.setAttribute('aria-label', 'Minimizar a bolita en esquina');
    this.collapseBtn.title = 'Minimizar a bolita';
    this.collapseBtn.textContent = '−';

    this.root.append(this.toggleBtn, this.collapseBtn);
    container.appendChild(this.root);

    this.root.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerUp);
    window.addEventListener('resize', this.handleWindowResize);

    this.toggleBtn.addEventListener('click', this.handleMainClick);
    this.toggleBtn.addEventListener('keydown', this.handleKeyDown);
    this.collapseBtn.addEventListener('click', this.handleCollapseClick);

    this.render();
  }

  public update(state: Partial<AutoReadDockState>): void {
    if (typeof state.active === 'boolean') this.active = state.active;
    if (state.corner) this.corner = state.corner;
    if (typeof state.minimized === 'boolean') this.minimized = state.minimized;
    this.render();
    this.updateCollisionAvoidance(this.lastPlayerRect);
  }

  public updateCollisionAvoidance(playerRect: DOMRect | null): void {
    this.lastPlayerRect = playerRect;
    if (!playerRect || (playerRect.width === 0 && playerRect.height === 0)) {
      this.avoidPlayerCollision = false;
      this.applyCornerPosition();
      return;
    }

    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const dockW = this.minimized ? 36 : 168;
    const dockH = this.minimized ? 36 : 32;

    const isTop = this.corner.startsWith('top-');
    const isLeft = this.corner.endsWith('-left');
    const left = isLeft ? EDGE_MARGIN : vw - EDGE_MARGIN - dockW;
    const top = isTop ? EDGE_MARGIN : vh - EDGE_MARGIN - dockH;

    const dockBox = { left, top, right: left + dockW, bottom: top + dockH };
    this.avoidPlayerCollision = rectsOverlap(dockBox, playerRect, 6);
    this.applyCornerPosition();
  }

  public destroy(): void {
    this.root.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerUp);
    window.removeEventListener('resize', this.handleWindowResize);
    this.toggleBtn.removeEventListener('click', this.handleMainClick);
    this.toggleBtn.removeEventListener('keydown', this.handleKeyDown);
    this.collapseBtn.removeEventListener('click', this.handleCollapseClick);
    this.root.remove();
  }

  private render(): void {
    this.root.setAttribute('data-corner', this.corner);
    this.root.setAttribute('data-minimized', String(this.minimized));
    this.root.setAttribute('data-active', String(this.active));

    this.toggleBtn.setAttribute('aria-pressed', String(this.active));
    this.toggleBtn.setAttribute(
      'aria-label',
      this.minimized
        ? `Expandir Auto-lectura (${this.active ? 'ON' : 'OFF'}, arrastra para mover a cualquier esquina)`
        : this.active
          ? 'Desactivar auto-lectura al seleccionar'
          : 'Activar auto-lectura al seleccionar'
    );
    this.toggleBtn.title = this.minimized
      ? `Auto-lectura: ${this.active ? 'ON' : 'OFF'} (clic para expandir, arrastra para mover de esquina)`
      : 'Clic para activar/desactivar · Arrastra para fijar en cualquier esquina';

    this.iconSlot.textContent = '';
    this.iconSlot.appendChild(createSpeakerSvg(this.active));
    this.badgeEl.textContent = this.active ? 'ON' : 'OFF';
    this.collapseBtn.hidden = this.minimized;

    this.applyCornerPosition();
  }

  private applyCornerPosition(): void {
    if (this.didDrag) return;
    const isTop = this.corner.startsWith('top-');
    const isLeft = this.corner.endsWith('-left');
    const verticalOffset = this.avoidPlayerCollision
      ? EDGE_MARGIN + COLLISION_OFFSET_PX
      : EDGE_MARGIN;

    this.root.style.top = isTop ? `${verticalOffset}px` : 'auto';
    this.root.style.bottom = isTop ? 'auto' : `${verticalOffset}px`;
    this.root.style.left = isLeft ? `${EDGE_MARGIN}px` : 'auto';
    this.root.style.right = isLeft ? 'auto' : `${EDGE_MARGIN}px`;
  }

  private readonly handleMainClick = (): void => {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }
    if (this.minimized) {
      this.minimized = false;
      this.render();
      this.callbacks.onMinimizedChange(false);
      return;
    }
    this.callbacks.onToggleAutoRead();
  };

  private readonly handleCollapseClick = (event: MouseEvent): void => {
    event.stopPropagation();
    this.minimized = true;
    this.render();
    this.callbacks.onMinimizedChange(true);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (event.target === this.collapseBtn) return;

    const rect = this.root.getBoundingClientRect();
    this.pointerActive = true;
    this.didDrag = false;
    this.startClientX = event.clientX;
    this.startClientY = event.clientY;
    this.dragOffsetX = event.clientX - rect.left;
    this.dragOffsetY = event.clientY - rect.top;
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.pointerActive) return;

    const dx = event.clientX - this.startClientX;
    const dy = event.clientY - this.startClientY;
    if (!this.didDrag && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return;
    }

    if (!this.didDrag) {
      this.didDrag = true;
      this.root.setAttribute('data-dragging', 'true');
    }

    const rect = this.root.getBoundingClientRect();
    const width = rect.width || (this.minimized ? 36 : 168);
    const height = rect.height || (this.minimized ? 36 : 32);
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    const left = Math.round(
      Math.min(Math.max(EDGE_MARGIN, event.clientX - this.dragOffsetX), vw - width - EDGE_MARGIN)
    );
    const top = Math.round(
      Math.min(Math.max(EDGE_MARGIN, event.clientY - this.dragOffsetY), vh - height - EDGE_MARGIN)
    );

    this.root.style.right = 'auto';
    this.root.style.bottom = 'auto';
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (!this.pointerActive) return;
    this.pointerActive = false;

    if (!this.didDrag) {
      return;
    }

    this.didDrag = false;
    this.suppressNextClick = true;
    this.root.removeAttribute('data-dragging');

    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const nextCorner = resolveNearestCorner(event.clientX, event.clientY, vw, vh);
    const changed = nextCorner !== this.corner;
    this.corner = nextCorner;
    this.render();
    this.updateCollisionAvoidance(this.lastPlayerRect);
    if (changed) {
      this.callbacks.onCornerChange(nextCorner);
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const isTop = this.corner.startsWith('top-');
    const isLeft = this.corner.endsWith('-left');
    let nextCorner: DockCorner | null = null;

    if (event.key === 'Home') {
      nextCorner = 'bottom-right';
    } else if (event.key === 'ArrowUp') {
      nextCorner = isLeft ? 'top-left' : 'top-right';
    } else if (event.key === 'ArrowDown') {
      nextCorner = isLeft ? 'bottom-left' : 'bottom-right';
    } else if (event.key === 'ArrowLeft') {
      nextCorner = isTop ? 'top-left' : 'bottom-left';
    } else if (event.key === 'ArrowRight') {
      nextCorner = isTop ? 'top-right' : 'bottom-right';
    }

    if (!nextCorner) return;
    event.preventDefault();
    if (nextCorner !== this.corner) {
      this.corner = nextCorner;
      this.render();
      this.updateCollisionAvoidance(this.lastPlayerRect);
      this.callbacks.onCornerChange(nextCorner);
    }
  };

  private readonly handleWindowResize = (): void => {
    this.updateCollisionAvoidance(this.lastPlayerRect);
  };
}
