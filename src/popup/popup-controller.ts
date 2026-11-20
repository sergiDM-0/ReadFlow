import { assertLocalhostEndpoint } from '../core/engines/local-url';
import { getPrimaryLang } from '../core/language-detector';
import { PIPER_NEURAL_VOICES } from '../core/neural/piper-voices';
import {
  ICON_COLOR_PRESETS,
  createBrandIconSvg,
  darkenHexColor,
  getContrastingForeground,
  isValidHexColor,
} from '../shared/icon-renderer';
import { isHostBlocked, toggleDomainInList, type SettingsPatch } from '../shared/storage';
import {
  DEFAULT_APPEARANCE,
  type AppearanceSettings,
  type EngineId,
  type ExtensionSettings,
  type LocalHttpProtocol,
  type PlaybackRate,
  type ThemePreference,
  type VoiceInfo,
} from '../shared/types';

export interface PopupStorageApi {
  getSettings(): Promise<ExtensionSettings>;
  updateSettings(patch: SettingsPatch): Promise<ExtensionSettings>;
}

export interface InitPopupOptions {
  readonly root: Document | HTMLElement;
  readonly storage: PopupStorageApi;
  readonly getActiveTabHost: () => Promise<string>;
  readonly getAvailableVoices: () => Promise<readonly VoiceInfo[]>;
  readonly requestOriginPermission?: (originPattern: string) => Promise<boolean>;
  readonly warmupNeuralVoice?: (lang: string, voiceId?: string) => void;
  readonly triggerQuickRead?: (text?: string) => Promise<boolean>;
  readonly stopActiveTabPlayback?: () => Promise<void>;
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

function applyPopupThemeAndColors(
  root: Document | HTMLElement,
  theme: ThemePreference,
  appearance: AppearanceSettings
): void {
  const target = 'documentElement' in root ? root.documentElement : root;
  if (!target) return;
  if (theme === 'auto') {
    target.removeAttribute('data-theme');
  } else {
    target.setAttribute('data-theme', theme);
  }

  const iconBg = isValidHexColor(appearance.iconBgColor)
    ? appearance.iconBgColor
    : DEFAULT_APPEARANCE.iconBgColor;
  const iconFg = isValidHexColor(appearance.iconFgColor)
    ? appearance.iconFgColor
    : getContrastingForeground(iconBg);
  const accent = isValidHexColor(appearance.accentColor)
    ? appearance.accentColor
    : DEFAULT_APPEARANCE.accentColor;

  target.style.setProperty('--icon-bg', iconBg);
  target.style.setProperty('--icon-bg-dark', darkenHexColor(iconBg, 0.2));
  target.style.setProperty('--icon-fg', iconFg);
  target.style.setProperty('--accent', accent);
  target.style.setProperty('--accent-hover', darkenHexColor(accent, 0.16));
  target.style.setProperty('--accent-fg', getContrastingForeground(accent));
  target.style.setProperty('--focus-ring', accent);
}

function renderBrandIcons(
  brandSlot: HTMLElement | null,
  previewSlot: HTMLElement | null,
  appearance: AppearanceSettings,
  autoReadActive: boolean
): void {
  if (brandSlot) {
    brandSlot.textContent = '';
    brandSlot.appendChild(createBrandIconSvg(appearance, 30, autoReadActive));
  }
  if (previewSlot) {
    previewSlot.textContent = '';
    previewSlot.appendChild(createBrandIconSvg(appearance, 36, autoReadActive));
  }
}

/**
 * Initializes the dock popup and `options_ui` ("Administrar") configuration panel,
 * wiring quick-read actions, 3-tab navigation, live color/icon customization, and domain blocklist management.
 */
export async function initPopup(options: InitPopupOptions): Promise<void> {
  const {
    root,
    storage,
    getActiveTabHost,
    getAvailableVoices,
    requestOriginPermission,
    warmupNeuralVoice,
    triggerQuickRead,
    stopActiveTabPlayback,
  } = options;

  let settings = await storage.getSettings();
  const activeHost = await getActiveTabHost();
  const voices = await getAvailableVoices();

  const brandIconSlot = root.querySelector('#brand-icon-slot') as HTMLElement | null;
  const previewDockIcon = root.querySelector('#preview-dock-icon') as HTMLElement | null;
  const toggleEnabled = root.querySelector('#toggle-enabled') as HTMLInputElement | null;
  const toggleDomainBlock = root.querySelector('#toggle-domain-block') as HTMLInputElement | null;
  const currentDomainLabel = root.querySelector('#current-domain') as HTMLElement | null;
  const selectRate = root.querySelector('#select-rate') as HTMLSelectElement | null;
  const ratePills = Array.from(root.querySelectorAll<HTMLButtonElement>('.rate-pill'));
  const selectEngine = root.querySelector('#select-engine') as HTMLSelectElement | null;
  const selectVoiceEs = root.querySelector('#select-voice-es') as HTMLSelectElement | null;
  const selectVoiceEn = root.querySelector('#select-voice-en') as HTMLSelectElement | null;
  const toggleAutoReadSelection = root.querySelector(
    '#toggle-autoread-selection'
  ) as HTMLInputElement | null;
  const toggleGemini = root.querySelector('#toggle-gemini-autoread') as HTMLInputElement | null;
  const toggleOmitCode = root.querySelector('#toggle-omit-code') as HTMLInputElement | null;
  const toggleOmitFileNames = root.querySelector(
    '#toggle-omit-filenames'
  ) as HTMLInputElement | null;
  const inputEndpoint = root.querySelector('#input-local-endpoint') as HTMLInputElement | null;
  const selectProtocol = root.querySelector('#select-local-protocol') as HTMLSelectElement | null;
  const saveEndpointBtn = root.querySelector('#btn-save-endpoint') as HTMLButtonElement | null;
  const endpointFeedback = root.querySelector('#endpoint-feedback') as HTMLElement | null;
  const blocklistStatus = root.querySelector('#blocklist-status') as HTMLElement | null;
  const blockedList = root.querySelector('#blocked-domains-list') as HTMLElement | null;

  // Quick-read controls
  const quickInput = root.querySelector('#quick-read-input') as HTMLTextAreaElement | null;
  const quickReadBtn = root.querySelector('#btn-quick-read') as HTMLButtonElement | null;
  const quickStopBtn = root.querySelector('#btn-quick-stop') as HTMLButtonElement | null;
  const quickFeedback = root.querySelector('#quick-feedback') as HTMLElement | null;

  // Appearance controls
  const presetGrid = root.querySelector('#color-presets') as HTMLElement | null;
  const quickPresetGrid = root.querySelector('#quick-color-presets') as HTMLElement | null;
  const quickColorPicker = root.querySelector('#quick-color-picker') as HTMLInputElement | null;
  const inputIconBg = root.querySelector('#input-icon-bg') as HTMLInputElement | null;
  const inputIconFg = root.querySelector('#input-icon-fg') as HTMLInputElement | null;
  const inputAccentColor = root.querySelector('#input-accent-color') as HTMLInputElement | null;
  const hexIconBg = root.querySelector('#hex-icon-bg') as HTMLElement | null;
  const hexIconFg = root.querySelector('#hex-icon-fg') as HTMLElement | null;
  const hexAccentColor = root.querySelector('#hex-accent-color') as HTMLElement | null;
  const selectTheme = root.querySelector('#select-theme') as HTMLSelectElement | null;
  const resetAppearanceBtn = root.querySelector(
    '#btn-reset-appearance'
  ) as HTMLButtonElement | null;

  // Tabs
  const tabBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const tabPanels = Array.from(root.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

  const activateTab = (tabId: string) => {
    for (const btn of tabBtns) {
      const isSelected = btn.dataset.tab === tabId;
      btn.setAttribute('aria-selected', String(isSelected));
    }
    for (const panel of tabPanels) {
      panel.hidden = panel.dataset.panel !== tabId;
    }
  };

  for (const btn of tabBtns) {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab) {
        activateTab(btn.dataset.tab);
      }
    });
  }

  const persistPatch = (patch: SettingsPatch, onDone?: () => void) => {
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

  const populatePresetContainer = (container: HTMLElement | null) => {
    if (!container) return;
    container.textContent = '';

    for (const preset of ICON_COLOR_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-swatch';
      btn.setAttribute('data-preset-id', preset.id);
      btn.setAttribute('aria-label', `Paleta ${preset.name}`);
      btn.title = preset.name;
      const isActive =
        settings.appearance.iconBgColor.toLowerCase() ===
          preset.appearance.iconBgColor.toLowerCase() &&
        settings.appearance.accentColor.toLowerCase() ===
          preset.appearance.accentColor.toLowerCase();
      btn.setAttribute('aria-pressed', String(isActive));
      btn.style.background = preset.appearance.iconBgColor;

      btn.addEventListener('click', () => {
        persistPatch({ appearance: { ...preset.appearance } }, () => syncDom());
      });

      container.appendChild(btn);
    }
  };

  const renderColorPresets = () => {
    populatePresetContainer(presetGrid);
    populatePresetContainer(quickPresetGrid);
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
    applyPopupThemeAndColors(root, settings.theme, settings.appearance);
    renderBrandIcons(
      brandIconSlot,
      previewDockIcon,
      settings.appearance,
      settings.autoReadSelection
    );

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
    for (const pill of ratePills) {
      pill.setAttribute('aria-pressed', String(Number(pill.dataset.rate) === settings.defaultRate));
    }

    if (selectEngine) selectEngine.value = settings.engine;
    if (toggleAutoReadSelection) toggleAutoReadSelection.checked = settings.autoReadSelection;
    if (toggleGemini) toggleGemini.checked = settings.geminiAutoRead;
    if (toggleOmitCode) toggleOmitCode.checked = settings.omitCodeBlocks;
    if (toggleOmitFileNames) toggleOmitFileNames.checked = settings.omitFileNames;
    if (inputEndpoint) inputEndpoint.value = settings.localHttp.endpointUrl;
    if (selectProtocol) selectProtocol.value = settings.localHttp.protocol;

    if (quickColorPicker) quickColorPicker.value = settings.appearance.iconBgColor;
    if (inputIconBg) inputIconBg.value = settings.appearance.iconBgColor;
    if (inputIconFg) inputIconFg.value = settings.appearance.iconFgColor;
    if (inputAccentColor) inputAccentColor.value = settings.appearance.accentColor;
    if (hexIconBg) hexIconBg.textContent = settings.appearance.iconBgColor;
    if (hexIconFg) hexIconFg.textContent = settings.appearance.iconFgColor;
    if (hexAccentColor) hexAccentColor.textContent = settings.appearance.accentColor;
    if (selectTheme) selectTheme.value = settings.theme;
    renderColorPresets();

    const activeVoices = settings.engine === 'piper-neural' ? PIPER_NEURAL_VOICES : voices;
    renderVoiceSelect(selectVoiceEs, activeVoices, 'es', settings.voicePreferences.es);
    renderVoiceSelect(selectVoiceEn, activeVoices, 'en', settings.voicePreferences.en);
    renderBlockedDomains(blockedList, settings.blockedDomains, handleRemoveDomain);
  };

  syncDom();

  quickReadBtn?.addEventListener('click', () => {
    if (!triggerQuickRead) return;
    const explicit = quickInput?.value.trim() || undefined;
    void triggerQuickRead(explicit)
      .then((started) => {
        if (!quickFeedback) return;
        if (started) {
          quickFeedback.setAttribute('data-state', 'ok');
          quickFeedback.textContent = explicit
            ? 'Leyendo texto en la pestaña activa.'
            : 'Leyendo selección de la pestaña activa.';
        } else {
          quickFeedback.setAttribute('data-state', 'error');
          quickFeedback.textContent = 'Selecciona texto en la página o escríbelo arriba.';
        }
      })
      .catch(() => {
        if (quickFeedback) {
          quickFeedback.setAttribute('data-state', 'error');
          quickFeedback.textContent = 'Abre una página web normal (http/https) para reproducir.';
        }
      });
  });

  quickStopBtn?.addEventListener('click', () => {
    if (!stopActiveTabPlayback) return;
    void stopActiveTabPlayback()
      .then(() => {
        if (quickFeedback) {
          quickFeedback.setAttribute('data-state', 'ok');
          quickFeedback.textContent = 'Lectura detenida.';
        }
      })
      .catch(() => undefined);
  });

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
    persistPatch({ defaultRate: Number(selectRate.value) as PlaybackRate }, () => syncDom());
  });

  for (const pill of ratePills) {
    pill.addEventListener('click', () => {
      const nextRate = Number(pill.dataset.rate) as PlaybackRate;
      persistPatch({ defaultRate: nextRate }, () => syncDom());
    });
  }

  selectEngine?.addEventListener('change', () => {
    const nextEngine = selectEngine.value as EngineId;
    persistPatch({ engine: nextEngine }, () => {
      syncDom();
      if (nextEngine === 'piper-neural') {
        warmupNeuralVoice?.('es', settings.voicePreferences.es || undefined);
      }
    });
  });

  selectVoiceEs?.addEventListener('change', () => {
    const nextVoiceId = selectVoiceEs.value;
    persistPatch({ voicePreferences: { es: nextVoiceId } }, () => {
      if (settings.engine === 'piper-neural') {
        warmupNeuralVoice?.('es', nextVoiceId || undefined);
      }
    });
  });

  selectVoiceEn?.addEventListener('change', () => {
    const nextVoiceId = selectVoiceEn.value;
    persistPatch({ voicePreferences: { en: nextVoiceId } }, () => {
      if (settings.engine === 'piper-neural') {
        warmupNeuralVoice?.('en', nextVoiceId || undefined);
      }
    });
  });

  toggleAutoReadSelection?.addEventListener('change', () => {
    persistPatch({ autoReadSelection: toggleAutoReadSelection.checked }, () => syncDom());
  });

  toggleGemini?.addEventListener('change', () => {
    persistPatch({ geminiAutoRead: toggleGemini.checked });
  });

  toggleOmitCode?.addEventListener('change', () => {
    persistPatch({ omitCodeBlocks: toggleOmitCode.checked });
  });

  toggleOmitFileNames?.addEventListener('change', () => {
    persistPatch({ omitFileNames: toggleOmitFileNames.checked });
  });

  const applyUnifiedPrimaryColor = (value: string) => {
    if (!isValidHexColor(value)) return;
    persistPatch(
      {
        appearance: {
          iconBgColor: value,
          accentColor: value,
          iconFgColor: getContrastingForeground(value),
        },
      },
      () => syncDom()
    );
  };

  quickColorPicker?.addEventListener('input', () => {
    applyUnifiedPrimaryColor(quickColorPicker.value);
  });

  inputIconBg?.addEventListener('input', () => {
    const value = inputIconBg.value;
    if (!isValidHexColor(value)) return;
    persistPatch({ appearance: { iconBgColor: value, accentColor: value } }, () => syncDom());
  });

  inputIconFg?.addEventListener('input', () => {
    const value = inputIconFg.value;
    if (!isValidHexColor(value)) return;
    persistPatch({ appearance: { iconFgColor: value } }, () => syncDom());
  });

  inputAccentColor?.addEventListener('input', () => {
    const value = inputAccentColor.value;
    if (!isValidHexColor(value)) return;
    persistPatch({ appearance: { accentColor: value } }, () => syncDom());
  });

  selectTheme?.addEventListener('change', () => {
    const nextTheme = selectTheme.value as ThemePreference;
    persistPatch({ theme: nextTheme }, () => syncDom());
  });

  resetAppearanceBtn?.addEventListener('click', () => {
    persistPatch({ appearance: { ...DEFAULT_APPEARANCE }, theme: 'auto' }, () => syncDom());
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
