export const SHADOW_UI_STYLES = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color-scheme: light dark;

  --es-bg: #ffffff;
  --es-bg-hover: #f3f4f6;
  --es-border: #6b7280;
  --es-text: #111827;
  --es-text-muted: #4b5563;
  --es-icon-bg: #2563eb;
  --es-icon-bg-dark: #1d4ed8;
  --es-icon-fg: #ffffff;
  --es-accent: #1d4ed8;
  --es-accent-hover: #1e40af;
  --es-accent-fg: #ffffff;
  --es-focus-ring: #1d4ed8;
  --es-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  --es-status-active: #16a34a;
  --es-status-paused: #d97706;
  --es-status-error: #dc2626;
}

@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])) {
    --es-bg: #18181b;
    --es-bg-hover: #27272a;
    --es-border: #71717a;
    --es-text: #f4f4f5;
    --es-text-muted: #a1a1aa;
    --es-accent: #1d4ed8;
    --es-accent-hover: #1e40af;
    --es-accent-fg: #ffffff;
    --es-focus-ring: #93c5fd;
    --es-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  }
}

:host([data-theme="dark"]) {
  --es-bg: #18181b;
  --es-bg-hover: #27272a;
  --es-border: #71717a;
  --es-text: #f4f4f5;
  --es-text-muted: #a1a1aa;
  --es-accent: #1d4ed8;
  --es-accent-hover: #1e40af;
  --es-accent-fg: #ffffff;
  --es-focus-ring: #93c5fd;
  --es-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
}

.es-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.es-floating-btn {
  position: fixed;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 1.5px solid var(--es-accent);
  border-radius: 11px;
  background: linear-gradient(135deg, var(--es-icon-bg), var(--es-icon-bg-dark));
  color: var(--es-icon-fg);
  box-shadow: var(--es-shadow);
  cursor: pointer;
  transition: transform 120ms ease, filter 120ms ease;
}

.es-floating-btn:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.es-floating-btn:focus-visible,
.es-ctrl-btn:focus-visible,
.es-autoread-main:focus-visible,
.es-autoread-collapse:focus-visible {
  outline: 2px solid var(--es-focus-ring);
  outline-offset: 2px;
}

.es-player {
  position: fixed;
  right: 20px;
  bottom: 20px;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1.5px solid var(--es-accent);
  border-radius: 16px;
  background: var(--es-bg);
  color: var(--es-text);
  box-shadow: var(--es-shadow);
  user-select: none;
}

.es-player[data-dragging="true"] {
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.28);
}

.es-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--es-text-muted);
  cursor: grab;
  touch-action: none;
  font-size: 14px;
  letter-spacing: -1px;
}

.es-drag-handle:hover {
  background: var(--es-bg-hover);
  color: var(--es-text);
}

.es-drag-handle:active {
  cursor: grabbing;
}

.es-drag-handle:focus-visible {
  outline: 2px solid var(--es-focus-ring);
  outline-offset: 2px;
}

.es-player[hidden],
.es-floating-btn[hidden] {
  display: none;
}

.es-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--es-accent);
  flex-shrink: 0;
}

.es-status-dot[data-status="paused"] {
  background: var(--es-status-paused);
}

.es-status-dot[data-status="error"] {
  background: var(--es-status-error);
}

.es-status-label {
  font-size: 12px;
  color: var(--es-text-muted);
  margin-right: 4px;
  white-space: nowrap;
}

.es-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.es-ctrl-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--es-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.es-ctrl-btn:hover {
  background: var(--es-bg-hover);
}

.es-ctrl-btn[data-primary="true"] {
  background: var(--es-accent);
  color: var(--es-accent-fg);
}

.es-ctrl-btn[data-primary="true"]:hover {
  background: var(--es-accent-hover);
}

.es-autoread-dock {
  position: fixed;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px 4px 3px 6px;
  border: 1.5px solid var(--es-accent);
  border-radius: 999px;
  background: var(--es-bg);
  color: var(--es-text);
  box-shadow: var(--es-shadow);
  user-select: none;
  touch-action: none;
  transition: top 160ms ease, bottom 160ms ease, left 160ms ease, right 160ms ease, opacity 140ms ease, background 140ms ease, border-color 140ms ease;
}

.es-autoread-dock[data-dragging="true"] {
  transition: none;
  cursor: grabbing;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.28);
  opacity: 1;
}

.es-autoread-dock[data-active="true"] {
  border-color: var(--es-accent);
  background: linear-gradient(135deg, var(--es-icon-bg), var(--es-icon-bg-dark));
  color: var(--es-icon-fg);
}

.es-autoread-dock[data-minimized="true"] {
  padding: 0;
  width: 36px;
  height: 36px;
  justify-content: center;
  background: linear-gradient(135deg, var(--es-icon-bg), var(--es-icon-bg-dark));
  color: var(--es-icon-fg);
  opacity: 0.92;
  transition: top 160ms ease, bottom 160ms ease, left 180ms cubic-bezier(0.22, 1, 0.36, 1), right 180ms cubic-bezier(0.22, 1, 0.36, 1), width 180ms cubic-bezier(0.22, 1, 0.36, 1), border-radius 180ms ease, opacity 140ms ease, background 140ms ease, box-shadow 140ms ease;
}

.es-autoread-dock[data-minimized="true"][data-peeking="false"]:not([data-dragging="true"]) {
  width: 14px;
  height: 40px;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  opacity: 0.85;
}

.es-edge-line {
  display: none;
  width: 4px;
  height: 32px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--es-icon-bg), var(--es-accent));
  box-shadow: 0 0 8px rgba(15, 23, 42, 0.35);
  pointer-events: none;
  transition: transform 160ms ease, opacity 160ms ease, background 160ms ease;
}

.es-autoread-dock[data-active="true"] .es-edge-line {
  background: linear-gradient(180deg, var(--es-status-active), var(--es-icon-bg));
  box-shadow: 0 0 10px rgba(22, 163, 74, 0.55);
}

.es-autoread-dock[data-minimized="true"][data-peeking="false"]:not([data-dragging="true"]) .es-edge-line {
  display: block;
}

.es-autoread-dock[data-minimized="true"][data-peeking="false"]:not([data-dragging="true"])[data-corner$="-right"] {
  justify-content: flex-end;
  padding-right: 2px;
}

.es-autoread-dock[data-minimized="true"][data-peeking="false"]:not([data-dragging="true"])[data-corner$="-left"] {
  justify-content: flex-start;
  padding-left: 2px;
}

.es-autoread-dock[data-minimized="true"][data-peeking="false"]:not([data-dragging="true"]) .es-autoread-main {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
}

.es-autoread-dock[data-minimized="true"]:hover,
.es-autoread-dock[data-minimized="true"]:focus-within,
.es-autoread-dock[data-minimized="true"][data-peeking="true"] {
  opacity: 1;
}

.es-autoread-dock[data-minimized="true"][data-peeking="true"]::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 16px;
}

.es-autoread-dock[data-minimized="true"][data-peeking="true"][data-corner$="-right"]::before {
  right: -16px;
}

.es-autoread-dock[data-minimized="true"][data-peeking="true"][data-corner$="-left"]::before {
  left: -16px;
}

.es-autoread-main {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 4px 6px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
}

.es-autoread-main:hover {
  background: rgba(255, 255, 255, 0.12);
}

.es-autoread-dock[data-minimized="true"] .es-autoread-main {
  width: 34px;
  height: 34px;
  padding: 0;
}

.es-autoread-dock[data-minimized="true"] .es-pill-label,
.es-autoread-dock[data-minimized="true"] .es-pill-badge {
  display: none;
}

.es-pill-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  color: var(--es-accent);
}

.es-autoread-dock[data-active="true"] .es-pill-icon,
.es-autoread-dock[data-minimized="true"] .es-pill-icon {
  color: var(--es-icon-fg);
}

.es-pill-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  background: var(--es-bg-hover);
  color: var(--es-accent);
}

.es-autoread-dock[data-active="true"] .es-pill-badge {
  background: rgba(255, 255, 255, 0.22);
  color: var(--es-icon-fg);
}

.es-orb-dot {
  display: none;
  position: absolute;
  top: 3px;
  right: 3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9ca3af;
  border: 1.5px solid var(--es-bg);
}

.es-autoread-dock[data-minimized="true"] .es-orb-dot {
  display: block;
}

.es-autoread-dock[data-minimized="true"][data-active="true"] .es-orb-dot {
  background: var(--es-status-active);
}

.es-autoread-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.8;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.es-autoread-collapse:hover {
  background: rgba(255, 255, 255, 0.16);
  opacity: 1;
}

.es-autoread-collapse[hidden] {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .es-floating-btn,
  .es-autoread-dock,
  .es-autoread-dock[data-minimized="true"],
  .es-edge-line {
    transition: none;
  }
}
`;
