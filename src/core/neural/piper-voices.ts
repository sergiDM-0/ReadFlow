import type { VoiceInfo } from '../../shared/types';
import { getPrimaryLang } from '../language-detector';

export const PIPER_HF_BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main';

export interface PiperVoiceSpec extends VoiceInfo {
  readonly engine: 'piper-neural';
  readonly modelPath: string;
  readonly speakerId?: number;
}

export const PIPER_NEURAL_VOICES: readonly PiperVoiceSpec[] = [
  {
    id: 'es_MX-claude-high',
    name: 'Claude (Español MX — Suave Alta Calidad)',
    lang: 'es-MX',
    isLocal: true,
    isDefault: true,
    engine: 'piper-neural',
    modelPath: 'es/es_MX/claude/high/es_MX-claude-high.onnx',
  },
  {
    id: 'es_MX-ald-medium',
    name: 'Ald (Español MX — Natural)',
    lang: 'es-MX',
    isLocal: true,
    isDefault: false,
    engine: 'piper-neural',
    modelPath: 'es/es_MX/ald/medium/es_MX-ald-medium.onnx',
  },
  {
    id: 'es_ES-sharvard-medium',
    name: 'Sharvard (Español ES — Natural)',
    lang: 'es-ES',
    isLocal: true,
    isDefault: false,
    engine: 'piper-neural',
    modelPath: 'es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx',
    speakerId: 1,
  },
  {
    id: 'es_ES-davefx-medium',
    name: 'DaveFX (Español ES — Cálida)',
    lang: 'es-ES',
    isLocal: true,
    isDefault: false,
    engine: 'piper-neural',
    modelPath: 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx',
  },
  {
    id: 'en_US-hfc_female-medium',
    name: 'HFC Female (English US — Smooth)',
    lang: 'en-US',
    isLocal: true,
    isDefault: true,
    engine: 'piper-neural',
    modelPath: 'en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx',
  },
  {
    id: 'en_US-amy-medium',
    name: 'Amy (English US — Soft)',
    lang: 'en-US',
    isLocal: true,
    isDefault: false,
    engine: 'piper-neural',
    modelPath: 'en/en_US/amy/medium/en_US-amy-medium.onnx',
  },
  {
    id: 'en_US-lessac-medium',
    name: 'Lessac (English US — Clear)',
    lang: 'en-US',
    isLocal: true,
    isDefault: false,
    engine: 'piper-neural',
    modelPath: 'en/en_US/lessac/medium/en_US-lessac-medium.onnx',
  },
  {
    id: 'en_GB-alba-medium',
    name: 'Alba (English UK — Warm)',
    lang: 'en-GB',
    isLocal: true,
    isDefault: false,
    engine: 'piper-neural',
    modelPath: 'en/en_GB/alba/medium/en_GB-alba-medium.onnx',
  },
  {
    id: 'pt_BR-faber-medium',
    name: 'Faber (Português BR — Natural)',
    lang: 'pt-BR',
    isLocal: true,
    isDefault: true,
    engine: 'piper-neural',
    modelPath: 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx',
  },
  {
    id: 'fr_FR-siwis-medium',
    name: 'Siwis (Français — Douce)',
    lang: 'fr-FR',
    isLocal: true,
    isDefault: true,
    engine: 'piper-neural',
    modelPath: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx',
  },
  {
    id: 'de_DE-thorsten-medium',
    name: 'Thorsten (Deutsch — Natürlich)',
    lang: 'de-DE',
    isLocal: true,
    isDefault: true,
    engine: 'piper-neural',
    modelPath: 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
  },
  {
    id: 'it_IT-paola-medium',
    name: 'Paola (Italiano — Naturale)',
    lang: 'it-IT',
    isLocal: true,
    isDefault: true,
    engine: 'piper-neural',
    modelPath: 'it/it_IT/paola/medium/it_IT-paola-medium.onnx',
  },
];

export function findPiperVoiceById(voiceId: string): PiperVoiceSpec | undefined {
  return PIPER_NEURAL_VOICES.find((v) => v.id === voiceId);
}

export function resolvePiperVoiceForLang(
  lang: string,
  voicePreferences: Readonly<Record<string, string>>
): PiperVoiceSpec {
  const primary = getPrimaryLang(lang);
  const preferredId = voicePreferences[lang.toLowerCase()] ?? voicePreferences[primary];

  if (preferredId) {
    const matched = findPiperVoiceById(preferredId);
    if (matched) {
      return matched;
    }
  }

  const langDefault = PIPER_NEURAL_VOICES.find(
    (v) => getPrimaryLang(v.lang) === primary && v.isDefault
  );
  if (langDefault) {
    return langDefault;
  }

  const langAny = PIPER_NEURAL_VOICES.find((v) => getPrimaryLang(v.lang) === primary);
  return langAny ?? PIPER_NEURAL_VOICES[0]!;
}

export function getPiperModelUrls(voiceId: string): {
  readonly modelUrl: string;
  readonly configUrl: string;
} {
  const voice = findPiperVoiceById(voiceId) ?? PIPER_NEURAL_VOICES[0]!;
  const modelUrl = `${PIPER_HF_BASE}/${voice.modelPath}`;
  return {
    modelUrl,
    configUrl: `${modelUrl}.json`,
  };
}
