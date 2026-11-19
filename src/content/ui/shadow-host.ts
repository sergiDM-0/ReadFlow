import type { ThemePreference } from '../../shared/types';
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
