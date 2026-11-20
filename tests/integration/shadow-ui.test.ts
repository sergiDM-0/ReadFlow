import { describe, it, expect, vi, afterEach } from 'vitest';
import { ShadowHost } from '../../src/content/ui/shadow-host';
import { FloatingButton } from '../../src/content/ui/floating-btn';
import { MiniPlayer } from '../../src/content/ui/mini-player';

describe('Shadow DOM UI lifecycle', () => {
  afterEach(() => {
    document.querySelectorAll('echo-select-ui').forEach((el) => el.remove());
  });

  it('mounts cleanly in ShadowRoot, removes orphaned hosts on reload, and leaves zero DOM nodes after destroy', () => {
    const staleHost = document.createElement('echo-select-ui');
    document.documentElement.appendChild(staleHost);

    const host = new ShadowHost('auto');
    host.setAppearance({ iconBgColor: '#059669', iconFgColor: '#ffffff', accentColor: '#047857' });
    host.mount();

    const hostEls = document.querySelectorAll('echo-select-ui');
    expect(hostEls).toHaveLength(1);
    expect(hostEls[0]).toBe(host.hostElement);
    expect(hostEls[0]?.shadowRoot).not.toBeNull();
    expect(host.hostElement.style.getPropertyValue('--es-accent')).toBe('#047857');
    expect(host.hostElement.style.getPropertyValue('--es-icon-bg')).toBe('#059669');
    expect(host.hostElement.style.getPropertyValue('--es-icon-fg')).toBe('#ffffff');

    host.destroy();
    expect(document.querySelector('echo-select-ui')).toBeNull();
  });

  it('renders FloatingButton with accessible attributes and triggers onClick', () => {
    const host = new ShadowHost('dark');
    host.mount();
    const onClick = vi.fn();
    const btn = new FloatingButton(host.container, onClick);

    btn.show({ top: 120, left: 240 });
    const buttonEl = host.shadowRoot.querySelector(
      'button[data-es-role="floating-trigger"]'
    ) as HTMLButtonElement;
    expect(buttonEl).not.toBeNull();
    expect(buttonEl.getAttribute('aria-label')).toBeTruthy();
    expect(buttonEl.hidden).toBe(false);

    buttonEl.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    btn.hide();
    expect(buttonEl.hidden).toBe(true);
    btn.destroy();
    host.destroy();
  });

  it('renders MiniPlayer controls and invokes playback callbacks', () => {
    const host = new ShadowHost('light');
    host.mount();

    const callbacks = {
      onTogglePlayPause: vi.fn(),
      onStop: vi.fn(),
      onPrev: vi.fn(),
      onNext: vi.fn(),
      onRateChange: vi.fn(),
    };

    const player = new MiniPlayer(host.container, callbacks);
    player.update({
      status: 'playing',
      items: [
        { id: '1', index: 0, text: 'Hello.', lang: 'en' },
        { id: '2', index: 1, text: 'World.', lang: 'en' },
      ],
      currentIndex: 0,
      rate: 1,
      detectedLang: 'en',
      source: 'selection',
      error: null,
    });

    const region = host.shadowRoot.querySelector('[role="region"]') as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.hidden).toBe(false);
    player.focusPrimaryControl();

    (host.shadowRoot.querySelector('[data-es-action="toggle"]') as HTMLButtonElement).click();
    (host.shadowRoot.querySelector('[data-es-action="next"]') as HTMLButtonElement).click();
    (host.shadowRoot.querySelector('[data-es-action="prev"]') as HTMLButtonElement).click();
    (host.shadowRoot.querySelector('[data-es-action="rate"]') as HTMLButtonElement).click();
    (host.shadowRoot.querySelector('[data-es-action="stop"]') as HTMLButtonElement).click();

    expect(callbacks.onTogglePlayPause).toHaveBeenCalledOnce();
    expect(callbacks.onNext).toHaveBeenCalledOnce();
    expect(callbacks.onPrev).toHaveBeenCalledOnce();
    expect(callbacks.onRateChange).toHaveBeenCalledWith(1.25);
    expect(callbacks.onStop).toHaveBeenCalledOnce();

    // Paused, loading, error, and idle UI states
    player.update({
      status: 'paused',
      items: [{ id: '1', index: 0, text: 'Hello.', lang: 'en' }],
      currentIndex: 0,
      rate: 1.25,
      detectedLang: 'en',
      source: 'selection',
      error: null,
    });
    expect(host.shadowRoot.querySelector('[role="status"]')?.textContent).toContain('Pausado');

    player.update({
      status: 'loading',
      items: [{ id: '1', index: 0, text: 'Hello.', lang: 'en' }],
      currentIndex: 0,
      rate: 1.25,
      detectedLang: 'en',
      source: 'selection',
      loadingMessage: 'Descargando voz suave... 45%',
      error: null,
    });
    expect(host.shadowRoot.querySelector('.es-status-label')?.textContent).toContain(
      'Descargando voz suave... 45%'
    );

    // Draggable floating window: pointer drag + keyboard repositioning + Home reset
    const dragHandle = host.shadowRoot.querySelector(
      '[data-es-role="drag-handle"]'
    ) as HTMLButtonElement | null;
    expect(dragHandle).not.toBeNull();

    dragHandle?.dispatchEvent(
      new PointerEvent('pointerdown', { button: 2, clientX: 100, clientY: 100, bubbles: true })
    );
    dragHandle?.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 120, clientY: 120, bubbles: true })
    );
    dragHandle?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

    dragHandle?.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 200, clientY: 200, bubbles: true })
    );
    dragHandle?.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 300, clientY: 160, bubbles: true })
    );
    dragHandle?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    expect(region.style.left).toMatch(/px$/);

    window.dispatchEvent(new Event('resize'));

    dragHandle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    dragHandle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    dragHandle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    dragHandle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    dragHandle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(region.style.left).toMatch(/px$/);
    expect(region.style.top).toMatch(/px$/);
    dragHandle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(region.style.left).toBe('');

    player.update({
      status: 'error',
      items: [],
      currentIndex: 0,
      rate: 1,
      detectedLang: null,
      source: null,
      error: { code: 'SYNTHESIS_FAILED', message: 'Sin voces' },
    });
    expect(host.shadowRoot.querySelector('[role="alert"]')?.textContent).toBe('Sin voces');
    expect(
      (host.shadowRoot.querySelector('[data-es-action="prev"]') as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      host.shadowRoot.querySelector('[data-es-action="toggle"]')?.hasAttribute('aria-pressed')
    ).toBe(false);

    player.update({
      status: 'idle',
      items: [],
      currentIndex: -1,
      rate: 1,
      detectedLang: null,
      source: null,
      error: null,
    });
    expect(region.hidden).toBe(true);
    expect(host.containsEventTarget(host.hostElement)).toBe(true);

    player.destroy();
    host.destroy();
  });
});
