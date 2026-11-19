import { assertLocalhostEndpoint } from '../core/engines/local-url';
import { getPrimaryLang } from '../core/language-detector';
import { isHostBlocked, toggleDomainInList } from '../shared/storage';
import type {
  EngineId,
  ExtensionSettings,
  LocalHttpProtocol,
  PlaybackRate,
  VoiceInfo,
} from '../shared/types';

export interface PopupStorageApi {
  getSettings(): Promise<ExtensionSettings>;
  updateSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings>;
}

export interface InitPopupOptions {
  readonly root: Document | HTMLElement;
  readonly storage: PopupStorageApi;
  readonly getActiveTabHost: () => Promise<string>;
  readonly getAvailableVoices: () => Promise<readonly VoiceInfo[]>;
}

function renderVoiceSelect(
  selectEl: HTMLSelectElement | null,
  voices: readonly VoiceInfo[],
  langPrefix: string,
  selectedVoiceId: string | undefined
): void {
  if (!selectEl) return;
  selectEl.textContent = '';

  const autoOption = document.createElement('option');
  autoOption.value = '';
  autoOption.textContent = 'Automática (local)';
  selectEl.appendChild(autoOption);

  const matching = voices.filter((v) => getPrimaryLang(v.lang) === langPrefix);
  for (const voice of matching) {
    const opt = document.createElement('option');
    opt.value = voice.id;
    opt.textContent = `${voice.name} (${voice.lang})`;
    selectEl.appendChild(opt);
  }

  selectEl.value = selectedVoiceId ?? '';
}

function renderBlockedDomains(
  listEl: HTMLElement | null,
  domains: readonly string[],
  onRemove: (domain: string) => void
): void {
  if (!listEl) return;
  listEl.textContent = '';

  if (domains.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = 'Ningún dominio bloqueado';
    listEl.appendChild(empty);
    return;
  }

  for (const domain of domains) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = domain;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove-domain-btn';
    btn.setAttribute('aria-label', `Desbloquear ${domain}`);
    btn.textContent = '×';
    btn.addEventListener('click', () => onRemove(domain));

    li.append(span, btn);
    listEl.appendChild(li);
  }
}

export async function initPopup(options: InitPopupOptions): Promise<void> {
  const { root, storage, getActiveTabHost, getAvailableVoices } = options;
  let settings = await storage.getSettings();
  const activeHost = await getActiveTabHost();
  const voices = await getAvailableVoices();

  const toggleEnabled = root.querySelector('#toggle-enabled') as HTMLInputElement | null;
  const toggleDomainBlock = root.querySelector('#toggle-domain-block') as HTMLInputElement | null;
  const currentDomainLabel = root.querySelector('#current-domain') as HTMLElement | null;
  const selectRate = root.querySelector('#select-rate') as HTMLSelectElement | null;
  const selectEngine = root.querySelector('#select-engine') as HTMLSelectElement | null;
  const selectVoiceEs = root.querySelector('#select-voice-es') as HTMLSelectElement | null;
  const selectVoiceEn = root.querySelector('#select-voice-en') as HTMLSelectElement | null;
  const toggleGemini = root.querySelector('#toggle-gemini-autoread') as HTMLInputElement | null;
  const toggleOmitCode = root.querySelector('#toggle-omit-code') as HTMLInputElement | null;
  const inputEndpoint = root.querySelector('#input-local-endpoint') as HTMLInputElement | null;
  const selectProtocol = root.querySelector('#select-local-protocol') as HTMLSelectElement | null;
  const saveEndpointBtn = root.querySelector('#btn-save-endpoint') as HTMLButtonElement | null;
  const endpointFeedback = root.querySelector('#endpoint-feedback') as HTMLElement | null;
  const blockedList = root.querySelector('#blocked-domains-list') as HTMLElement | null;

  const syncDom = () => {
    if (toggleEnabled) toggleEnabled.checked = settings.enabled;
    if (currentDomainLabel) {
      currentDomainLabel.textContent = activeHost || 'Página interna';
    }
    if (toggleDomainBlock) {
      toggleDomainBlock.disabled = !activeHost;
      toggleDomainBlock.checked = activeHost ? isHostBlocked(activeHost, settings.blockedDomains) : false;
    }
    if (selectRate) selectRate.value = String(settings.defaultRate);
    if (selectEngine) selectEngine.value = settings.engine;
    if (toggleGemini) toggleGemini.checked = settings.geminiAutoRead;
    if (toggleOmitCode) toggleOmitCode.checked = settings.omitCodeBlocks;
    if (inputEndpoint) inputEndpoint.value = settings.localHttp.endpointUrl;
    if (selectProtocol) selectProtocol.value = settings.localHttp.protocol;

    renderVoiceSelect(selectVoiceEs, voices, 'es', settings.voicePreferences.es);
    renderVoiceSelect(selectVoiceEn, voices, 'en', settings.voicePreferences.en);
    renderBlockedDomains(blockedList, settings.blockedDomains, (domain) => {
      void storage
        .updateSettings({ blockedDomains: toggleDomainInList(settings.blockedDomains, domain) })
        .then((next) => {
          settings = next;
          syncDom();
        });
    });
  };

  syncDom();

  toggleEnabled?.addEventListener('change', () => {
    void storage.updateSettings({ enabled: toggleEnabled.checked }).then((next) => {
      settings = next;
    });
  });

  toggleDomainBlock?.addEventListener('change', () => {
    if (!activeHost) return;
    const nextDomains = toggleDomainInList(settings.blockedDomains, activeHost);
    void storage.updateSettings({ blockedDomains: nextDomains }).then((next) => {
      settings = next;
      syncDom();
    });
  });

  selectRate?.addEventListener('change', () => {
    const rate = Number(selectRate.value) as PlaybackRate;
    void storage.updateSettings({ defaultRate: rate }).then((next) => {
      settings = next;
    });
  });

  selectEngine?.addEventListener('change', () => {
    const engine = selectEngine.value as EngineId;
    void storage.updateSettings({ engine }).then((next) => {
      settings = next;
    });
  });

  selectVoiceEs?.addEventListener('change', () => {
    void storage
      .updateSettings({
        voicePreferences: { ...settings.voicePreferences, es: selectVoiceEs.value },
      })
      .then((next) => {
        settings = next;
      });
  });

  selectVoiceEn?.addEventListener('change', () => {
    void storage
      .updateSettings({
        voicePreferences: { ...settings.voicePreferences, en: selectVoiceEn.value },
      })
      .then((next) => {
        settings = next;
      });
  });

  toggleGemini?.addEventListener('change', () => {
    void storage.updateSettings({ geminiAutoRead: toggleGemini.checked }).then((next) => {
      settings = next;
    });
  });

  toggleOmitCode?.addEventListener('change', () => {
    void storage.updateSettings({ omitCodeBlocks: toggleOmitCode.checked }).then((next) => {
      settings = next;
    });
  });

  saveEndpointBtn?.addEventListener('click', () => {
    if (!inputEndpoint || !endpointFeedback) return;
    try {
      const validUrl = assertLocalhostEndpoint(inputEndpoint.value);
      const protocol = (selectProtocol?.value as LocalHttpProtocol) || 'piper';
      void storage
        .updateSettings({
          localHttp: {
            ...settings.localHttp,
            endpointUrl: validUrl.toString(),
            protocol,
          },
        })
        .then((next) => {
          settings = next;
          endpointFeedback.setAttribute('data-state', 'ok');
          endpointFeedback.textContent = 'Endpoint local guardado.';
        });
    } catch (err) {
      endpointFeedback.setAttribute('data-state', 'error');
      endpointFeedback.textContent =
        err instanceof Error ? err.message : 'Solo se permiten URLs locales (localhost / 127.0.0.1).';
    }
  });
}
