import { vi } from 'vitest';

vi.mock('webextension-polyfill', () => {
  const storageListeners = new Set<(changes: Record<string, unknown>) => void>();
  const store: Record<string, unknown> = {};

  return {
    default: {
      runtime: {
        id: 'readflow-test-id',
        getURL: vi.fn((path: string) => `moz-extension://readflow-test/${path}`),
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      storage: {
        sync: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          }),
        },
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          }),
        },
        onChanged: {
          addListener: vi.fn((fn: (changes: Record<string, unknown>) => void) =>
            storageListeners.add(fn)
          ),
          removeListener: vi.fn((fn: (changes: Record<string, unknown>) => void) =>
            storageListeners.delete(fn)
          ),
        },
      },
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
      },
      contextMenus: {
        create: vi.fn(),
        removeAll: vi.fn(async () => undefined),
        onClicked: {
          addListener: vi.fn(),
        },
      },
      commands: {
        onCommand: {
          addListener: vi.fn(),
        },
      },
      action: {
        setIcon: vi.fn(async () => undefined),
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
        setTitle: vi.fn(async () => undefined),
      },
      i18n: {
        detectLanguage: vi.fn(async () => ({
          isReliable: true,
          languages: [{ language: 'en', percentage: 99 }],
        })),
      },
    },
  };
});
