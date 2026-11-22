import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ICON_COLOR_PRESETS,
  createBrandIconSvg,
  darkenHexColor,
  getContrastingForeground,
  isValidHexColor,
  renderToolbarIconImageData,
} from '../../src/shared/icon-renderer';
import { DEFAULT_APPEARANCE } from '../../src/shared/types';

describe('icon-renderer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('validates hex colors, darkens tones, and computes accessible foreground contrast', () => {
    expect(ICON_COLOR_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(isValidHexColor('#2563eb')).toBe(true);
    expect(isValidHexColor('#FFF')).toBe(false);
    expect(isValidHexColor('blue')).toBe(false);

    expect(darkenHexColor('#ffffff', 0.5)).toBe('#808080');
    expect(getContrastingForeground('#1d4ed8')).toBe('#ffffff');
    expect(getContrastingForeground('#facc15')).toBe('#0f172a');
  });

  it('creates an inline SVG brand icon with optional Auto-Read indicator dot', () => {
    const svgOff = createBrandIconSvg(DEFAULT_APPEARANCE, 32, false);
    expect(svgOff.tagName.toLowerCase()).toBe('svg');
    expect(svgOff.getAttribute('width')).toBe('32');
    expect(svgOff.querySelectorAll('circle')).toHaveLength(0);

    const svgOn = createBrandIconSvg(
      { iconBgColor: '#7c3aed', iconFgColor: '#ffffff', accentColor: '#6d28d9' },
      48,
      true
    );
    expect(svgOn.querySelectorAll('circle')).toHaveLength(1);
    expect(svgOn.querySelector('stop')?.getAttribute('stop-color')).toBe('#7c3aed');
    // Falls back to DEFAULT_APPEARANCE when invalid hex colors are provided
    const fallbackSvg = createBrandIconSvg(
      { iconBgColor: 'invalid', iconFgColor: 'invalid', accentColor: 'invalid' },
      32
    );
    expect(fallbackSvg.querySelector('stop')?.getAttribute('stop-color')).toBe('#2563eb');
  });

  it('renders toolbar icon ImageData via OffscreenCanvas and handles disabled/autoRead states', () => {
    const fakeImageData = { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) };
    const fakeCtx = {
      clearRect: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      getImageData: vi.fn(() => fakeImageData),
      fillStyle: '',
      strokeStyle: '',
      lineCap: 'butt',
      lineWidth: 1,
      globalAlpha: 1,
    };

    class FakeOffscreenCanvas {
      public readonly width: number;
      public readonly height: number;
      public constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      public getContext() {
        return fakeCtx;
      }
    }

    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    const activeImg = renderToolbarIconImageData(DEFAULT_APPEARANCE, 32, {
      enabled: true,
      autoReadActive: true,
    });
    expect(activeImg).toBe(fakeImageData);
    expect(fakeCtx.getImageData).toHaveBeenCalledWith(0, 0, 32, 32);

    const disabledImg = renderToolbarIconImageData(DEFAULT_APPEARANCE, 16, { enabled: false });
    expect(disabledImg).toBe(fakeImageData);

    const fallbackImg = renderToolbarIconImageData(
      { iconBgColor: 'bad', iconFgColor: 'bad', accentColor: 'bad' },
      16
    );
    expect(fallbackImg).toBe(fakeImageData);

    // Gracefully returns null when canvas context is unavailable
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    expect(renderToolbarIconImageData(DEFAULT_APPEARANCE, 16)).toBeNull();
  });
});
