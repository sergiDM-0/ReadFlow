import { DEFAULT_APPEARANCE, type AppearanceSettings } from './types';

export interface IconColorPreset {
  readonly id: string;
  readonly name: string;
  readonly appearance: AppearanceSettings;
}

export const ICON_COLOR_PRESETS: readonly IconColorPreset[] = [
  {
    id: 'sapphire',
    name: 'Zafiro',
    appearance: { iconBgColor: '#2563eb', iconFgColor: '#ffffff', accentColor: '#1d4ed8' },
  },
  {
    id: 'emerald',
    name: 'Esmeralda',
    appearance: { iconBgColor: '#059669', iconFgColor: '#ffffff', accentColor: '#047857' },
  },
  {
    id: 'violet',
    name: 'Violeta',
    appearance: { iconBgColor: '#7c3aed', iconFgColor: '#ffffff', accentColor: '#6d28d9' },
  },
  {
    id: 'coral',
    name: 'Coral',
    appearance: { iconBgColor: '#e11d48', iconFgColor: '#ffffff', accentColor: '#be123c' },
  },
  {
    id: 'amber',
    name: 'Ámbar',
    appearance: { iconBgColor: '#d97706', iconFgColor: '#ffffff', accentColor: '#b45309' },
  },
  {
    id: 'graphite',
    name: 'Grafito',
    appearance: { iconBgColor: '#1e293b', iconFgColor: '#38bdf8', accentColor: '#334155' },
  },
];

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_RE.test(value.trim());
}

function parseRgb(hex: string): readonly [number, number, number] {
  const safe = isValidHexColor(hex) ? hex.trim() : DEFAULT_APPEARANCE.iconBgColor;
  const r = parseInt(safe.slice(1, 3), 16);
  const g = parseInt(safe.slice(3, 5), 16);
  const b = parseInt(safe.slice(5, 7), 16);
  return [r, g, b];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function darkenHexColor(hex: string, factor = 0.18): string {
  const [r, g, b] = parseRgb(hex);
  const scale = Math.max(0, Math.min(1, 1 - factor));
  return toHex(r * scale, g * scale, b * scale);
}

export function getContrastingForeground(bgHex: string): '#ffffff' | '#0f172a' {
  const [r, g, b] = parseRgb(bgHex);
  // WCAG relative luminance approximation
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0f172a' : '#ffffff';
}

export function createBrandIconSvg(
  appearance: AppearanceSettings,
  size = 28,
  autoReadActive = false
): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const bgTop = isValidHexColor(appearance.iconBgColor)
    ? appearance.iconBgColor
    : DEFAULT_APPEARANCE.iconBgColor;
  const bgBottom = darkenHexColor(bgTop, 0.22);
  const fg = isValidHexColor(appearance.iconFgColor)
    ? appearance.iconFgColor
    : DEFAULT_APPEARANCE.iconFgColor;

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 128 128');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const gradId = `es-grad-${bgTop.slice(1)}-${size}`;
  const defs = document.createElementNS(ns, 'defs');
  const grad = document.createElementNS(ns, 'linearGradient');
  grad.setAttribute('id', gradId);
  grad.setAttribute('x1', '12');
  grad.setAttribute('y1', '12');
  grad.setAttribute('x2', '116');
  grad.setAttribute('y2', '116');
  grad.setAttribute('gradientUnits', 'userSpaceOnUse');

  const stop1 = document.createElementNS(ns, 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', bgTop);

  const stop2 = document.createElementNS(ns, 'stop');
  stop2.setAttribute('offset', '100%');
  stop2.setAttribute('stop-color', bgBottom);

  grad.append(stop1, stop2);
  defs.appendChild(grad);

  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', '8');
  rect.setAttribute('y', '8');
  rect.setAttribute('width', '112');
  rect.setAttribute('height', '112');
  rect.setAttribute('rx', '28');
  rect.setAttribute('fill', `url(#${gradId})`);

  const speaker = document.createElementNS(ns, 'path');
  speaker.setAttribute(
    'd',
    'M35 52H49L67 36V92L49 76H35C32.8 76 31 74.2 31 72V56C31 53.8 32.8 52 35 52Z'
  );
  speaker.setAttribute('fill', fg);

  const wave1 = document.createElementNS(ns, 'path');
  wave1.setAttribute('d', 'M79 48C84.8 53.8 84.8 74.2 79 80');
  wave1.setAttribute('stroke', fg);
  wave1.setAttribute('stroke-width', '7.5');
  wave1.setAttribute('stroke-linecap', 'round');

  const wave2 = document.createElementNS(ns, 'path');
  wave2.setAttribute('d', 'M92 38C101 47 101 81 92 90');
  wave2.setAttribute('stroke', fg);
  wave2.setAttribute('stroke-opacity', '0.72');
  wave2.setAttribute('stroke-width', '7.5');
  wave2.setAttribute('stroke-linecap', 'round');

  svg.append(defs, rect, speaker, wave1, wave2);

  if (autoReadActive) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', '104');
    dot.setAttribute('cy', '24');
    dot.setAttribute('r', '14');
    dot.setAttribute('fill', '#22c55e');
    dot.setAttribute('stroke', '#ffffff');
    dot.setAttribute('stroke-width', '4');
    svg.appendChild(dot);
  }

  return svg;
}

type DrawableCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function drawRoundedRect(
  ctx: DrawableCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function createCanvasContext(size: number): DrawableCtx | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(size, size);
      return canvas.getContext('2d');
    } catch {
      // Fall through to HTMLCanvasElement when available.
    }
  }
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      return canvas.getContext('2d');
    } catch {
      return null;
    }
  }
  return null;
}

export function renderToolbarIconImageData(
  appearance: AppearanceSettings,
  size: number,
  options: { readonly enabled?: boolean; readonly autoReadActive?: boolean } = {}
): ImageData | null {
  const ctx = createCanvasContext(size);
  if (!ctx) {
    return null;
  }

  const enabled = options.enabled ?? true;
  const bgTop = enabled
    ? isValidHexColor(appearance.iconBgColor)
      ? appearance.iconBgColor
      : DEFAULT_APPEARANCE.iconBgColor
    : '#64748b';
  const bgBottom = darkenHexColor(bgTop, 0.22);
  const fg = isValidHexColor(appearance.iconFgColor)
    ? appearance.iconFgColor
    : DEFAULT_APPEARANCE.iconFgColor;

  const s = size / 128;
  ctx.clearRect(0, 0, size, size);

  // Rounded squircle background
  const grad = ctx.createLinearGradient(12 * s, 12 * s, 116 * s, 116 * s);
  grad.addColorStop(0, bgTop);
  grad.addColorStop(1, bgBottom);
  drawRoundedRect(ctx, 8 * s, 8 * s, 112 * s, 112 * s, 28 * s);
  ctx.fillStyle = grad;
  ctx.fill();

  // Speaker cone
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(35 * s, 52 * s);
  ctx.lineTo(49 * s, 52 * s);
  ctx.lineTo(67 * s, 36 * s);
  ctx.lineTo(67 * s, 92 * s);
  ctx.lineTo(49 * s, 76 * s);
  ctx.lineTo(35 * s, 76 * s);
  ctx.quadraticCurveTo(31 * s, 76 * s, 31 * s, 72 * s);
  ctx.lineTo(31 * s, 56 * s);
  ctx.quadraticCurveTo(31 * s, 52 * s, 35 * s, 52 * s);
  ctx.closePath();
  ctx.fill();

  // Sound waves
  ctx.strokeStyle = fg;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, 8 * s);

  ctx.beginPath();
  ctx.arc(69 * s, 64 * s, 17 * s, -0.78, 0.78);
  ctx.stroke();

  ctx.globalAlpha = 0.74;
  ctx.beginPath();
  ctx.arc(71 * s, 64 * s, 31 * s, -0.78, 0.78);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Auto-read indicator dot when active
  if (enabled && options.autoReadActive) {
    ctx.beginPath();
    ctx.arc(104 * s, 24 * s, 14 * s, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.lineWidth = Math.max(1, 4 * s);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, size, size);
}
