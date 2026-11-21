import browser from 'webextension-polyfill';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_SETTINGS,
  PLAYBACK_RATES,
  type AppearanceSettings,
  type DockCorner,
  type ExtensionSettings,
  type PlaybackRate,
} from './types';

export const SETTINGS_STORAGE_KEY = 'readflow_settings_v1';
const SAFE_HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const VALID_DOCK_CORNERS: readonly DockCorner[] = [
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
];

function isValidDockCorner(value: unknown): value is DockCorner {
  return typeof value === 'string' && (VALID_DOCK_CORNERS as readonly string[]).includes(value);
}

function sanitizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (SAFE_HEX_COLOR_RE.test(trimmed)) {
      return trimmed;
    }
  }
  return fallback;
}

function mergeAppearance(raw: unknown): AppearanceSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_APPEARANCE };
  }
  const input = raw as Partial<AppearanceSettings>;
  return {
    iconBgColor: sanitizeHexColor(input.iconBgColor, DEFAULT_APPEARANCE.iconBgColor),
    iconFgColor: sanitizeHexColor(input.iconFgColor, DEFAULT_APPEARANCE.iconFgColor),
    accentColor: sanitizeHexColor(input.accentColor, DEFAULT_APPEARANCE.accentColor),
  };
}

export interface StorageBackend {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type SettingsPatch = Partial<Omit<ExtensionSettings, 'appearance' | 'localHttp'>> & {
  readonly appearance?: Partial<AppearanceSettings>;
  readonly localHttp?: Partial<ExtensionSettings['localHttp']>;
};

/**
 * Normalizes a raw URL or hostname string to a lowercase domain name.
 * @param input Raw URL or domain entered by the user.
 * @returns Lowercase hostname or empty string when blank.
 */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }

  try {
    const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/\/.*$/, '');
  }
}

/**
 * Checks whether a hostname matches any entry (or subdomain of an entry) in the blocklist.
 * @param hostname Current page hostname.
 * @param blockedDomains List of blocked domains from user settings.
 */
export function isHostBlocked(hostname: string, blockedDomains: readonly string[]): boolean {
  const normalizedHost = normalizeDomain(hostname);
  if (!normalizedHost) {
    return false;
  }

  return blockedDomains.some((rawDomain) => {
    const domain = normalizeDomain(rawDomain);
    if (!domain) return false;
    return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`);
  });
}

/**
 * Immutably adds or removes a domain from the blocked domains list.
 * @param blockedDomains Existing blocked domain array.
 * @param domain Domain to toggle.
 */
export function toggleDomainInList(
  blockedDomains: readonly string[],
  domain: string
): readonly string[] {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return [...blockedDomains];
  }

  const normalizedList = blockedDomains.map(normalizeDomain).filter(Boolean);
  if (normalizedList.includes(normalized)) {
    return normalizedList.filter((d) => d !== normalized);
  }
  return [...normalizedList, normalized];
}

function isValidRate(rate: unknown): rate is PlaybackRate {
  return typeof rate === 'number' && (PLAYBACK_RATES as readonly number[]).includes(rate);
}

/**
 * Validates and merges untrusted storage data with `DEFAULT_SETTINGS`.
 * Sanitizes hex color codes, enum values, and domain lists.
 * @param raw Raw object read from `browser.storage`.
 */
export function mergeSettings(raw: unknown): ExtensionSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_SETTINGS,
      appearance: { ...DEFAULT_APPEARANCE },
      localHttp: { ...DEFAULT_SETTINGS.localHttp },
    };
  }

  const input = raw as Partial<ExtensionSettings>;
  const localHttpInput = input.localHttp ?? DEFAULT_SETTINGS.localHttp;

  return {
    schemaVersion: 1,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_SETTINGS.enabled,
    blockedDomains: Array.isArray(input.blockedDomains)
      ? Array.from(
          new Set(input.blockedDomains.map((d) => normalizeDomain(String(d))).filter(Boolean))
        )
      : DEFAULT_SETTINGS.blockedDomains,
    engine:
      input.engine === 'local-http' ||
      input.engine === 'web-speech' ||
      input.engine === 'piper-neural'
        ? input.engine
        : DEFAULT_SETTINGS.engine,
    defaultRate: isValidRate(input.defaultRate) ? input.defaultRate : DEFAULT_SETTINGS.defaultRate,
    voicePreferences:
      input.voicePreferences && typeof input.voicePreferences === 'object'
        ? { ...input.voicePreferences }
        : DEFAULT_SETTINGS.voicePreferences,
    theme: input.theme === 'light' || input.theme === 'dark' ? input.theme : 'auto',
    appearance: mergeAppearance(input.appearance),
    omitCodeBlocks:
      typeof input.omitCodeBlocks === 'boolean'
        ? input.omitCodeBlocks
        : DEFAULT_SETTINGS.omitCodeBlocks,
    omitFileNames:
      typeof input.omitFileNames === 'boolean'
        ? input.omitFileNames
        : DEFAULT_SETTINGS.omitFileNames,
    stripUrls: typeof input.stripUrls === 'boolean' ? input.stripUrls : DEFAULT_SETTINGS.stripUrls,
    autoReadSelection:
      typeof input.autoReadSelection === 'boolean'
        ? input.autoReadSelection
        : DEFAULT_SETTINGS.autoReadSelection,
    autoReadCorner: isValidDockCorner(input.autoReadCorner)
      ? input.autoReadCorner
      : DEFAULT_SETTINGS.autoReadCorner,
    autoReadMinimized:
      typeof input.autoReadMinimized === 'boolean'
        ? input.autoReadMinimized
        : DEFAULT_SETTINGS.autoReadMinimized,
    geminiAutoRead:
      typeof input.geminiAutoRead === 'boolean'
        ? input.geminiAutoRead
        : DEFAULT_SETTINGS.geminiAutoRead,
    localHttp: {
      endpointUrl:
        typeof localHttpInput.endpointUrl === 'string' && localHttpInput.endpointUrl.trim()
          ? localHttpInput.endpointUrl.trim()
          : DEFAULT_SETTINGS.localHttp.endpointUrl,
      protocol: localHttpInput.protocol === 'kokoro-openai' ? 'kokoro-openai' : 'piper',
      timeoutMs:
        typeof localHttpInput.timeoutMs === 'number' && localHttpInput.timeoutMs >= 1_000
          ? localHttpInput.timeoutMs
          : DEFAULT_SETTINGS.localHttp.timeoutMs,
    },
  };
}

/**
 * Creates a serialized read/write adapter over a `StorageBackend` to prevent race conditions.
 * @param backend Underlying key-value storage backend (`browser.storage.sync` or memory mock).
 */
export function createStorageAdapter(backend: StorageBackend) {
  let writeQueue: Promise<unknown> = Promise.resolve();

  return {
    async getSettings(): Promise<ExtensionSettings> {
      const record = await backend.get(SETTINGS_STORAGE_KEY);
      return mergeSettings(record[SETTINGS_STORAGE_KEY]);
    },

    updateSettings(patch: SettingsPatch): Promise<ExtensionSettings> {
      const task = writeQueue.then(async () => {
        const record = await backend.get(SETTINGS_STORAGE_KEY);
        const current = mergeSettings(record[SETTINGS_STORAGE_KEY]);
        const next = mergeSettings({
          ...current,
          ...patch,
          appearance: patch.appearance
            ? { ...current.appearance, ...patch.appearance }
            : current.appearance,
          localHttp: patch.localHttp
            ? { ...current.localHttp, ...patch.localHttp }
            : current.localHttp,
          voicePreferences: patch.voicePreferences
            ? { ...current.voicePreferences, ...patch.voicePreferences }
            : current.voicePreferences,
        });
        await backend.set({ [SETTINGS_STORAGE_KEY]: next });
        return next;
      });
      writeQueue = task.catch(() => undefined);
      return task;
    },
  };
}

function getDefaultBackend(): StorageBackend {
  const area = browser.storage?.sync ?? browser.storage?.local;
  return {
    async get(key: string): Promise<Record<string, unknown>> {
      return area.get(key);
    },
    async set(items: Record<string, unknown>): Promise<void> {
      await area.set(items);
    },
  };
}

export function getExtensionStorage() {
  return createStorageAdapter(getDefaultBackend());
}

export function onSettingsChanged(listener: (settings: ExtensionSettings) => void): () => void {
  const handler = (changes: Record<string, browser.Storage.StorageChange>) => {
    const change = changes[SETTINGS_STORAGE_KEY];
    if (change?.newValue) {
      listener(mergeSettings(change.newValue));
    }
  };
  browser.storage.onChanged.addListener(handler);
  return () => {
    browser.storage.onChanged.removeListener(handler);
  };
}
