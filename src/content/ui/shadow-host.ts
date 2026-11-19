import {
  darkenHexColor,
  getContrastingForeground,
  isValidHexColor,
} from '../../shared/icon-renderer';
import {
  DEFAULT_APPEARANCE,
  type AppearanceSettings,
  type ThemePreference,
} from '../../shared/types';
import { SHADOW_UI_STYLES } from './styles';

export class ShadowHost {
  public readonly hostElement: HTMLElement;
  public readonly shadowRoot: ShadowRoot;
  public readonly container: HTMLDivElement;

  public constructor(theme: ThemePreference = 'auto') {
    this.hostElement = document.createElement('echo-select-ui');
    this.setTheme(theme);
    this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });
    this.injectStyles();

    this.container = document.createElement('div');
    this.container.className = 'es-root';
    this.shadowRoot.appendChild(this.container);
  }

  public mount(): void {
    // Clean up any orphaned host elements left behind by extension reloads (e.g. Firefox about:debugging).
    document.querySelectorAll('echo-select-ui').forEach((existing) => {
      if (existing !== this.hostElement) {
        existing.remove();
      }
    });
    if (!this.hostElement.isConnected) {
      (document.documentElement ?? document.body).appendChild(this.hostElement);
    }
  }

  public setTheme(theme: ThemePreference): void {
    if (theme === 'auto') {
      this.hostElement.removeAttribute('data-theme');
    } else {
      this.hostElement.setAttribute('data-theme', theme);
    }
  }

  public setAppearance(appearance: AppearanceSettings): void {
    const accent = isValidHexColor(appearance.accentColor)
      ? appearance.accentColor
      : DEFAULT_APPEARANCE.accentColor;
    const hover = darkenHexColor(accent, 0.16);
    const fg = getContrastingForeground(accent);
    this.hostElement.style.setProperty('--es-accent', accent);
    this.hostElement.style.setProperty('--es-accent-hover', hover);
    this.hostElement.style.setProperty('--es-accent-fg', fg);
    this.hostElement.style.setProperty('--es-focus-ring', accent);
  }

  public containsEventTarget(target: EventTarget | null, path?: EventTarget[]): boolean {
    if (path && path.includes(this.hostElement)) {
      return true;
    }
    return (
      target === this.hostElement || (target instanceof Node && this.shadowRoot.contains(target))
    );
  }

  public destroy(): void {
    this.hostElement.remove();
  }

  private injectStyles(): void {
    if (
      typeof CSSStyleSheet !== 'undefined' &&
      'replaceSync' in CSSStyleSheet.prototype &&
      'adoptedStyleSheets' in this.shadowRoot
    ) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(SHADOW_UI_STYLES);
        this.shadowRoot.adoptedStyleSheets = [sheet];
        return;
      } catch {
        // Fallback to <style> tag below.
      }
    }

    const styleEl = document.createElement('style');
    styleEl.textContent = SHADOW_UI_STYLES;
    this.shadowRoot.appendChild(styleEl);
  }
}
