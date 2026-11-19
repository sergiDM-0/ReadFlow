import { assertLocalhostEndpoint } from '../core/engines/local-url';
import { getPrimaryLang } from '../core/language-detector';
import { PIPER_NEURAL_VOICES } from '../core/neural/piper-voices';
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
  readonly requestOriginPermission?: (originPattern: string) => Promise<boolean>;
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
  onRemove: (domain: string, index: number) => void
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

  domains.forEach((domain, index) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = domain;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove-domain-btn';
    btn.setAttribute('aria-label', `Desbloquear ${domain}`);
    btn.textContent = '×';
    btn.addEventListener('click', () => onRemove(domain, index));

    li.append(span, btn);
    listEl.appendChild(li);
  });
}

export async function initPopup(options: InitPopupOptions): Promise<void> {
  const { root, storage, getActiveTabHost, getAvailableVoices, requestOriginPermission } = options;
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
  const blocklistStatus = root.querySelector('#blocklist-status') as HTMLElement | null;
  const blockedList = root.querySelector('#blocked-domains-list') as HTMLElement | null;

  const persistPatch = (patch: Partial<ExtensionSettings>, onDone?: () => void) => {
    void storage
      .updateSettings(patch)
      .then((next) => {
        settings = next;
        onDone?.();
      })
      .catch(() => {
        if (endpointFeedback) {
          endpointFeedback.setAttribute('data-state', 'error');
          endpointFeedback.textContent = 'No se pudo guardar la configuración.';
        }
      });
  };

  const handleRemoveDomain = (domain: string, removedIndex: number) => {
    void storage
      .getSettings()
      .then((latest) =>
        storage.updateSettings({
          blockedDomains: toggleDomainInList(latest.blockedDomains, domain),
        })
      )
      .then((next) => {
        settings = next;
        syncDom();
        if (blocklistStatus) {
          blocklistStatus.textContent = `${domain} desbloqueado.`;
        }
        const remainingBtns =
          blockedList?.querySelectorAll<HTMLButtonElement>('.remove-domain-btn');
        if (remainingBtns && remainingBtns.length > 0) {
          const targetIdx = Math.min(removedIndex, remainingBtns.length - 1);
          remainingBtns[targetIdx]?.focus();
        } else {
          toggleDomainBlock?.focus();
        }
      })
      .catch(() => undefined);
  };

  const syncDom = () => {
    if (toggleEnabled) toggleEnabled.checked = settings.enabled;
    if (currentDomainLabel) {
      currentDomainLabel.textContent = activeHost || 'Página interna';
    }
    if (toggleDomainBlock) {
      toggleDomainBlock.disabled = !activeHost;
      toggleDomainBlock.checked = activeHost
        ? isHostBlocked(activeHost, settings.blockedDomains)
        : false;
    }
    if (selectRate) selectRate.value = String(settings.defaultRate);
    if (selectEngine) selectEngine.value = settings.engine;
    if (toggleGemini) toggleGemini.checked = settings.geminiAutoRead;
    if (toggleOmitCode) toggleOmitCode.checked = settings.omitCodeBlocks;
    if (inputEndpoint) inputEndpoint.value = settings.localHttp.endpointUrl;
    if (selectProtocol) selectProtocol.value = settings.localHttp.protocol;

    const activeVoices = settings.engine === 'piper-neural' ? PIPER_NEURAL_VOICES : voices;
    renderVoiceSelect(selectVoiceEs, activeVoices, 'es', settings.voicePreferences.es);
    renderVoiceSelect(selectVoiceEn, activeVoices, 'en', settings.voicePreferences.en);
    renderBlockedDomains(blockedList, settings.blockedDomains, handleRemoveDomain);
  };

  syncDom();

  toggleEnabled?.addEventListener('change', () => {
    persistPatch({ enabled: toggleEnabled.checked });
  });

  toggleDomainBlock?.addEventListener('change', () => {
    if (!activeHost) return;
    void storage
      .getSettings()
      .then((latest) =>
        storage.updateSettings({
          blockedDomains: toggleDomainInList(latest.blockedDomains, activeHost),
        })
      )
      .then((next) => {
        settings = next;
        syncDom();
      })
      .catch(() => undefined);
  });

  selectRate?.addEventListener('change', () => {
    persistPatch({ defaultRate: Number(selectRate.value) as PlaybackRate });
  });

  selectEngine?.addEventListener('change', () => {
    persistPatch({ engine: selectEngine.value as EngineId }, () => syncDom());
  });

  selectVoiceEs?.addEventListener('change', () => {
    persistPatch({ voicePreferences: { es: selectVoiceEs.value } });
  });

  selectVoiceEn?.addEventListener('change', () => {
    persistPatch({ voicePreferences: { en: selectVoiceEn.value } });
  });

  toggleGemini?.addEventListener('change', () => {
    persistPatch({ geminiAutoRead: toggleGemini.checked });
  });

  toggleOmitCode?.addEventListener('change', () => {
    persistPatch({ omitCodeBlocks: toggleOmitCode.checked });
  });

  saveEndpointBtn?.addEventListener('click', () => {
    if (!inputEndpoint || !endpointFeedback) return;
    let validUrl: URL;
    try {
      validUrl = assertLocalhostEndpoint(inputEndpoint.value);
    } catch {
      inputEndpoint.setAttribute('aria-invalid', 'true');
      endpointFeedback.setAttribute('data-state', 'error');
      endpointFeedback.textContent =
        'URL inválida: solo se permiten direcciones HTTP locales (localhost, 127.0.0.1 o [::1]).';
      return;
    }

    inputEndpoint.removeAttribute('aria-invalid');
    const protocol = (selectProtocol?.value as LocalHttpProtocol) || 'piper';
    const originPattern = `${validUrl.protocol}//${validUrl.hostname}/*`;

    void (async () => {
      try {
        if (requestOriginPermission) {
          const granted = await requestOriginPermission(originPattern);
          if (!granted) {
            endpointFeedback.setAttribute('data-state', 'error');
            endpointFeedback.textContent = 'Permiso de host local denegado por el navegador.';
            return;
          }
        }
        const next = await storage.updateSettings({
          localHttp: {
            ...settings.localHttp,
            endpointUrl: validUrl.toString(),
            protocol,
          },
        });
        settings = next;
        endpointFeedback.setAttribute('data-state', 'ok');
        endpointFeedback.textContent = 'Endpoint local guardado.';
      } catch {
        endpointFeedback.setAttribute('data-state', 'error');
        endpointFeedback.textContent = 'Error al guardar el endpoint local.';
      }
    })();
  });
}
