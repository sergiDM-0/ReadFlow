import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutoReadDock, resolveNearestCorner } from '../../src/content/ui/auto-read-dock';
import { ShadowHost } from '../../src/content/ui/shadow-host';

describe('AutoReadDock (minimizable corner-snapping orb)', () => {
  afterEach(() => {
    document.querySelectorAll('echo-select-ui').forEach((el) => el.remove());
  });

  it('resolves the nearest viewport corner accurately for all four quadrants', () => {
    expect(resolveNearestCorner(100, 80, 1000, 800)).toBe('top-left');
    expect(resolveNearestCorner(900, 80, 1000, 800)).toBe('top-right');
    expect(resolveNearestCorner(100, 720, 1000, 800)).toBe('bottom-left');
    expect(resolveNearestCorner(900, 720, 1000, 800)).toBe('bottom-right');
  });

  it('minimizes into a compact orb, expands on click, toggles Auto-Read, and never duplicates SVG icons', () => {
    const host = new ShadowHost('auto');
    host.mount();

    const callbacks = {
      onToggleAutoRead: vi.fn(),
      onCornerChange: vi.fn(),
      onMinimizedChange: vi.fn(),
    };

    const dock = new AutoReadDock(
      host.container,
      { active: false, corner: 'bottom-right', minimized: false },
      callbacks
    );

    const dockEl = host.shadowRoot.querySelector('[data-es-role="autoread-dock"]') as HTMLElement;
    const toggleBtn = host.shadowRoot.querySelector(
      '[data-es-role="gemini-autoread-toggle"]'
    ) as HTMLButtonElement;
    const collapseBtn = host.shadowRoot.querySelector(
      '[data-es-role="autoread-collapse"]'
    ) as HTMLButtonElement;

    expect(dockEl.getAttribute('data-minimized')).toBe('false');
    expect(dockEl.querySelectorAll('svg')).toHaveLength(1);

    // Clicking expanded pill toggles Auto-Read
    toggleBtn.click();
    expect(callbacks.onToggleAutoRead).toHaveBeenCalledTimes(1);

    // Updating state keeps single SVG
    dock.update({ active: true });
    expect(dockEl.getAttribute('data-active')).toBe('true');
    expect(dockEl.querySelectorAll('svg')).toHaveLength(1);

    // Clicking minimize turns it into a compact edge-docked orb that rests as a thin edge line
    collapseBtn.click();
    expect(dockEl.getAttribute('data-minimized')).toBe('true');
    expect(dockEl.getAttribute('data-peeking')).toBe('false');
    expect(collapseBtn.hidden).toBe(true);
    expect(callbacks.onMinimizedChange).toHaveBeenCalledWith(true);
    expect(dockEl.querySelectorAll('svg')).toHaveLength(1);
    expect(dockEl.querySelector('.es-edge-line')).not.toBeNull();

    // Hovering (pointerenter) over the edge line slides the circle out (data-peeking="true")
    dockEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    expect(dockEl.getAttribute('data-peeking')).toBe('true');

    // Moving the pointer away (pointerleave) hides the circle back into the edge line
    dockEl.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(dockEl.getAttribute('data-peeking')).toBe('false');

    // Keyboard focus also reveals the circle and blur hides it back to the edge line
    toggleBtn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(dockEl.getAttribute('data-peeking')).toBe('true');

    // Passing pointer over and out while keyboard-focused keeps it peeking until focusout
    dockEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    dockEl.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(dockEl.getAttribute('data-peeking')).toBe('true');

    toggleBtn.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(dockEl.getAttribute('data-peeking')).toBe('false');

    // Clicking the minimized orb expands it without firing a spurious Auto-Read toggle
    toggleBtn.click();
    expect(dockEl.getAttribute('data-minimized')).toBe('false');
    expect(callbacks.onMinimizedChange).toHaveBeenCalledWith(false);
    expect(callbacks.onToggleAutoRead).toHaveBeenCalledTimes(1);

    // External update({ minimized: true }) resets peeking state cleanly
    dock.update({ minimized: true, corner: 'bottom-left' });
    expect(dockEl.getAttribute('data-minimized')).toBe('true');
    expect(dockEl.getAttribute('data-peeking')).toBe('false');
    dock.update({ minimized: false });

    dock.destroy();
    host.destroy();
  });

  it('drags smoothly and magnetically snaps to any corner while avoiding MiniPlayer collisions', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    const host = new ShadowHost('dark');
    host.mount();

    const callbacks = {
      onToggleAutoRead: vi.fn(),
      onCornerChange: vi.fn(),
      onMinimizedChange: vi.fn(),
    };

    const dock = new AutoReadDock(
      host.container,
      { active: true, corner: 'bottom-right', minimized: true },
      callbacks
    );

    const dockEl = host.shadowRoot.querySelector('[data-es-role="autoread-dock"]') as HTMLElement;
    const toggleBtn = host.shadowRoot.querySelector(
      '[data-es-role="gemini-autoread-toggle"]'
    ) as HTMLButtonElement;

    // Collision avoidance shifts dock upward when MiniPlayer occupies bottom-right
    dock.updateCollisionAvoidance({
      left: 700,
      top: 730,
      right: 980,
      bottom: 780,
      width: 280,
      height: 50,
      x: 700,
      y: 730,
      toJSON: () => ({}),
    } as DOMRect);
    expect(dockEl.style.bottom).toBe('76px');

    // Right-click, collapse-button pointerdown, and sub-threshold micro-move (<5px) do not start dragging
    dockEl.dispatchEvent(
      new PointerEvent('pointerdown', { button: 2, clientX: 500, clientY: 500, bubbles: true })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 520, clientY: 520, bubbles: true })
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 520, clientY: 520, bubbles: true })
    );
    expect(dockEl.getAttribute('data-dragging')).toBeNull();

    dockEl.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 960, clientY: 740, bubbles: true })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 961, clientY: 741, bubbles: true })
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 961, clientY: 741, bubbles: true })
    );
    expect(dockEl.getAttribute('data-corner')).toBe('bottom-right');

    // Unrelated keyboard key is ignored cleanly
    toggleBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // Drag orb to top-left quadrant -> snaps to top-left, clears peeking state, and clears collision offset
    dockEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    expect(dockEl.getAttribute('data-peeking')).toBe('true');
    dockEl.dispatchEvent(
      new PointerEvent('pointerdown', { button: 0, clientX: 960, clientY: 740, bubbles: true })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 80, clientY: 60, bubbles: true })
    );
    expect(dockEl.getAttribute('data-dragging')).toBe('true');

    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 80, clientY: 60, bubbles: true })
    );
    expect(dockEl.getAttribute('data-dragging')).toBeNull();
    expect(dockEl.getAttribute('data-peeking')).toBe('false');
    expect(dockEl.getAttribute('data-corner')).toBe('top-left');
    expect(dockEl.style.top).toBe('12px');
    // When minimized and not hovered (data-peeking="false"), the edge indicator sits flush at 0px on the left edge
    expect(dockEl.style.left).toBe('0px');
    expect(callbacks.onCornerChange).toHaveBeenCalledWith('top-left');

    // Hovering shifts it out to 12px so the full circle is visible, and pointerleave tucks it back to 0px
    dockEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    expect(dockEl.style.left).toBe('12px');
    dockEl.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    expect(dockEl.style.left).toBe('0px');

    // Click immediately after drag is suppressed so dragging never accidentally toggles/expands
    toggleBtn.click();
    expect(dockEl.getAttribute('data-minimized')).toBe('true');

    // Keyboard corner snapping (ArrowRight -> top-right, ArrowDown -> bottom-right, ArrowLeft -> bottom-left, Home -> bottom-right)
    toggleBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(dockEl.getAttribute('data-corner')).toBe('top-right');
    toggleBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(dockEl.getAttribute('data-corner')).toBe('bottom-right');
    toggleBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(dockEl.getAttribute('data-corner')).toBe('bottom-left');
    toggleBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(dockEl.getAttribute('data-corner')).toBe('top-left');
    toggleBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(dockEl.getAttribute('data-corner')).toBe('bottom-right');

    // Clearing player rect restores flush bottom margin
    dock.updateCollisionAvoidance(null);
    expect(dockEl.style.bottom).toBe('12px');

    window.dispatchEvent(new Event('resize'));

    // External update({ minimized: true }) resets peeking state cleanly
    dock.update({ minimized: true, corner: 'bottom-left' });
    expect(dockEl.getAttribute('data-minimized')).toBe('true');
    expect(dockEl.getAttribute('data-peeking')).toBe('false');
    dock.update({ minimized: false });

    dock.destroy();
    host.destroy();
  });
});
