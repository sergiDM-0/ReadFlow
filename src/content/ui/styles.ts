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
  --es-border: #d1d5db;
  --es-text: #111827;
  --es-text-muted: #4b5563;
  --es-accent: #2563eb;
  --es-accent-hover: #1d4ed8;
  --es-accent-fg: #ffffff;
  --es-focus-ring: #2563eb;
  --es-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  --es-status-active: #16a34a;
  --es-status-paused: #d97706;
  --es-status-error: #dc2626;
}

@media (prefers-color-scheme: dark) {
  :host(:not([data-theme="light"])) {
    --es-bg: #18181b;
    --es-bg-hover: #27272a;
    --es-border: #3f3f46;
    --es-text: #f4f4f5;
    --es-text-muted: #a1a1aa;
    --es-accent: #3b82f6;
    --es-accent-hover: #60a5fa;
    --es-accent-fg: #ffffff;
    --es-focus-ring: #93c5fd;
    --es-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  }
}

:host([data-theme="dark"]) {
  --es-bg: #18181b;
  --es-bg-hover: #27272a;
  --es-border: #3f3f46;
  --es-text: #f4f4f5;
  --es-text-muted: #a1a1aa;
  --es-accent: #3b82f6;
  --es-accent-hover: #60a5fa;
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
  border: 1px solid var(--es-border);
  border-radius: 10px;
  background: var(--es-bg);
  color: var(--es-accent);
  box-shadow: var(--es-shadow);
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
}

.es-floating-btn:hover {
  background: var(--es-bg-hover);
  transform: translateY(-1px);
}

.es-floating-btn:focus-visible,
.es-ctrl-btn:focus-visible,
.es-gemini-pill:focus-visible {
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
  border: 1px solid var(--es-border);
  border-radius: 999px;
  background: var(--es-bg);
  color: var(--es-text);
  box-shadow: var(--es-shadow);
}

.es-player[hidden],
.es-floating-btn[hidden] {
  display: none;
}

.es-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--es-status-active);
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

.es-gemini-pill {
  position: fixed;
  right: 20px;
  bottom: 72px;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 1px solid var(--es-border);
  border-radius: 999px;
  background: var(--es-bg);
  color: var(--es-text);
  font-size: 12px;
  font-weight: 600;
  box-shadow: var(--es-shadow);
  cursor: pointer;
}

.es-gemini-pill[aria-pressed="true"] {
  border-color: var(--es-accent);
  color: var(--es-accent);
}

@media (prefers-reduced-motion: reduce) {
  .es-floating-btn {
    transition: none;
  }
}
`;
