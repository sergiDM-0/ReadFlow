import { describe, it, expect } from 'vitest';
import {
  normalizeDomain,
  isHostBlocked,
  toggleDomainInList,
  mergeSettings,
  createStorageAdapter,
} from '../../src/shared/storage';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

describe('storage helpers', () => {
  it('normalizes domains and matches exact host or subdomains', () => {
    expect(normalizeDomain('  HTTPS://Docs.Example.COM/path ')).toBe('docs.example.com');
    expect(normalizeDomain('   ')).toBe('');
    expect(isHostBlocked('example.com', ['example.com'])).toBe(true);
    expect(isHostBlocked('sub.example.com', ['example.com'])).toBe(true);
    expect(isHostBlocked('notexample.com', ['example.com'])).toBe(false);
    expect(isHostBlocked('', ['example.com'])).toBe(false);
  });

  it('toggles domains immutably without mutating original array', () => {
    const initial = ['alpha.com'] as const;
    const added = toggleDomainInList(initial, 'Beta.com');
    expect(initial).toEqual(['alpha.com']);
    expect(added).toEqual(['alpha.com', 'beta.com']);
    expect(toggleDomainInList(initial, '   ')).toEqual(['alpha.com']);

    const removed = toggleDomainInList(added, 'alpha.com');
    expect(removed).toEqual(['beta.com']);
  });

  it('merges partial stored data safely with DEFAULT_SETTINGS', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const merged = mergeSettings({
      defaultRate: 1.5,
      enabled: false,
      engine: 'local-http',
      theme: 'dark',
      omitCodeBlocks: false,
      omitFileNames: false,
      stripUrls: false,
      blockedDomains: ['Example.com', ''],
      localHttp: {
        endpointUrl: 'http://localhost:5000/tts',
        protocol: 'kokoro-openai',
        timeoutMs: 2000,
      },
    });
    expect(merged.defaultRate).toBe(1.5);
    expect(merged.enabled).toBe(false);
    expect(merged.engine).toBe('local-http');
    expect(merged.theme).toBe('dark');
    expect(merged.omitFileNames).toBe(false);
    expect(merged.localHttp.protocol).toBe('kokoro-openai');

    // Sanitizes invalid hex colors in appearance to safe defaults (prevents CSS injection)
    const unsafeAppearance = mergeSettings({
      appearance: {
        iconBgColor: '#059669',
        iconFgColor: 'javascript:alert(1)',
        accentColor: 'red; background:url(evil)',
      },
    });
    expect(unsafeAppearance.appearance).toEqual({
      iconBgColor: '#059669',
      iconFgColor: DEFAULT_SETTINGS.appearance.iconFgColor,
      accentColor: DEFAULT_SETTINGS.appearance.accentColor,
    });
  });

  it('reads and writes settings via injected memory store', async () => {
    const store: Record<string, unknown> = {};
    const adapter = createStorageAdapter({
      get: async (key) => ({ [key]: store[key] }),
      set: async (items) => {
        Object.assign(store, items);
      },
    });

    const initial = await adapter.getSettings();
    expect(initial).toEqual(DEFAULT_SETTINGS);

    const updated = await adapter.updateSettings({ defaultRate: 1.25, geminiAutoRead: true });
    expect(updated.defaultRate).toBe(1.25);
    expect(updated.geminiAutoRead).toBe(true);

    const reread = await adapter.getSettings();
    expect(reread.defaultRate).toBe(1.25);
  });
});
