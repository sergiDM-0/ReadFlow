# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Privacy & Security Guarantees

ReadFlow is designed to run **100% locally** in your browser:

- **Zero telemetry and zero external network requests** under default settings (`WebSpeechEngine`).
- Optional local HTTP TTS endpoints (`LocalHttpEngine`) are strictly restricted to loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) to prevent accidental exfiltration of selected text to remote servers.
- Injected UI is isolated inside a Shadow DOM root and constructed with safe DOM APIs (no `innerHTML` with untrusted content).

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, open a private GitHub Security Advisory on this repository with:

1. A clear description of the vulnerability and affected files.
2. Steps to reproduce (browser version, extension version, test page).
3. Any potential impact and suggested mitigation.

We aim to acknowledge reports within 48 hours and provide a fix plan within 7 days.
