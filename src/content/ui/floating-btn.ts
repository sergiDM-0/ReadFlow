import type { Point } from '../selection-handler';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSpeakerSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const speaker = document.createElementNS(SVG_NS, 'path');
  speaker.setAttribute('d', 'M11 5L6 9H3V15H6L11 19V5Z');
  speaker.setAttribute('fill', 'currentColor');

  const wave1 = document.createElementNS(SVG_NS, 'path');
  wave1.setAttribute('d', 'M15.5 8.5C16.8 9.8 16.8 14.2 15.5 15.5');
  wave1.setAttribute('stroke', 'currentColor');
  wave1.setAttribute('stroke-width', '2');
  wave1.setAttribute('stroke-linecap', 'round');

  const wave2 = document.createElementNS(SVG_NS, 'path');
  wave2.setAttribute('d', 'M18.5 6C21 8.5 21 15.5 18.5 18');
  wave2.setAttribute('stroke', 'currentColor');
  wave2.setAttribute('stroke-width', '2');
  wave2.setAttribute('stroke-linecap', 'round');

  svg.append(speaker, wave1, wave2);
  return svg;
}

export class FloatingButton {
  private readonly button: HTMLButtonElement;
  private readonly onClick: () => void;

  public constructor(container: HTMLElement, onClick: () => void) {
    this.onClick = onClick;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'es-floating-btn';
    this.button.setAttribute('data-es-role', 'floating-trigger');
    this.button.setAttribute('aria-label', 'Read selected text');
    this.button.title = 'EchoSelect TTS (Alt+S)';
    this.button.hidden = true;
    this.button.appendChild(createSpeakerSvg());

    this.button.addEventListener('mousedown', this.preventFocusSteal);
    this.button.addEventListener('click', this.handleClick);
    container.appendChild(this.button);
  }

  public show(position: Point): void {
    this.button.style.top = `${position.top}px`;
    this.button.style.left = `${position.left}px`;
    this.button.hidden = false;
  }

  public hide(): void {
    this.button.hidden = true;
  }

  public destroy(): void {
    this.button.removeEventListener('mousedown', this.preventFocusSteal);
    this.button.removeEventListener('click', this.handleClick);
    this.button.remove();
  }

  private readonly preventFocusSteal = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private readonly handleClick = (event: MouseEvent): void => {
    event.stopPropagation();
    this.onClick();
  };
}
