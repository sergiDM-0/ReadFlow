import { describe, it, expect, vi } from 'vitest';
import {
  detectLanguageHeuristic,
  detectLanguage,
  selectPreferredVoice,
} from '../../src/core/language-detector';
import type { VoiceInfo } from '../../src/shared/types';

describe('language-detector', () => {
  it('detects Spanish text via heuristic', () => {
    expect(detectLanguageHeuristic('Esta extensión lee el texto seleccionado en voz alta.')).toBe('es');
  });

  it('detects English text via heuristic', () => {
    expect(detectLanguageHeuristic('This browser extension reads the selected text aloud locally.')).toBe('en');
  });

  it('falls back to fallbackLang when text has no clear language markers', () => {
    expect(detectLanguageHeuristic('12345 67890', 'fr')).toBe('fr');
  });

  it('prefers remote detector result when reliable', async () => {
    const remoteDetect = vi.fn().mockResolvedValue({ lang: 'es-ES', confidence: 95, isReliable: true });
    const lang = await detectLanguage('Texto corto', { remoteDetect, fallbackLang: 'en' });
    expect(lang).toBe('es-ES');
    expect(remoteDetect).toHaveBeenCalledOnce();
  });

  it('falls back to heuristic when remote detector throws or is unreliable', async () => {
    const remoteDetect = vi.fn().mockRejectedValue(new Error('background sleeping'));
    const lang = await detectLanguage('Esta es una prueba para el idioma español.', {
      remoteDetect,
      fallbackLang: 'en',
    });
    expect(lang).toBe('es');
  });

  it('selectPreferredVoice honors explicit preference, then local voice matching language', () => {
    const voices: VoiceInfo[] = [
      { id: 'remote-es', name: 'Google ES', lang: 'es-ES', isLocal: false, isDefault: false, engine: 'web-speech' },
      { id: 'local-es', name: 'Local ES', lang: 'es-MX', isLocal: true, isDefault: false, engine: 'web-speech' },
      { id: 'local-en', name: 'Local EN', lang: 'en-US', isLocal: true, isDefault: true, engine: 'web-speech' },
    ];

    expect(selectPreferredVoice(voices, 'es', { es: 'remote-es' })?.id).toBe('remote-es');
    expect(selectPreferredVoice(voices, 'es', {})?.id).toBe('local-es');
    expect(selectPreferredVoice(voices, 'en-GB', {})?.id).toBe('local-en');
    expect(selectPreferredVoice([], 'en', {})).toBeUndefined();
  });
});
