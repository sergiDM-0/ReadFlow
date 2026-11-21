import { describe, it, expect, vi } from 'vitest';
import {
  detectLanguageHeuristic,
  detectLanguage,
  selectPreferredVoice,
} from '../../src/core/language-detector';
import type { VoiceInfo } from '../../src/shared/types';

describe('language-detector', () => {
  it('detects Spanish text via heuristic', () => {
    expect(detectLanguageHeuristic('Esta extensión lee el texto seleccionado en voz alta.')).toBe(
      'es'
    );
  });

  it('detects English text via heuristic', () => {
    expect(
      detectLanguageHeuristic('This browser extension reads the selected text aloud locally.')
    ).toBe('en');
  });

  it('falls back to fallbackLang when text has no clear language markers', () => {
    expect(detectLanguageHeuristic('12345 67890', 'fr')).toBe('fr');
    expect(detectLanguageHeuristic('Você não pode perder isso com atenção.')).toBe('pt');
    expect(detectLanguageHeuristic('Cette extension est une solution pour vous.')).toBe('fr');
    expect(
      detectLanguageHeuristic('Diese Erweiterung ist eine Lösung für dich und das Team.')
    ).toBe('de');
    expect(
      detectLanguageHeuristic('Questa estensione legge il testo selezionato con una voce naturale.')
    ).toBe('it');
  });

  it('prefers remote detector result when reliable', async () => {
    const remoteDetect = vi
      .fn()
      .mockResolvedValueOnce({ lang: 'es-ES', confidence: 95, isReliable: true })
      .mockResolvedValueOnce({ lang: 'en_US', confidence: 90, isReliable: true });
    const lang = await detectLanguage('Texto corto', { remoteDetect, fallbackLang: 'en' });
    expect(lang).toBe('es-es');
    const normalizedUnderscore = await detectLanguage('Short text', {
      remoteDetect,
      fallbackLang: 'en',
    });
    expect(normalizedUnderscore).toBe('en-us');
    expect(remoteDetect).toHaveBeenCalledTimes(2);
    expect(await detectLanguage('   ', { fallbackLang: 'de' })).toBe('de');
  });

  it('falls back to heuristic when remote detector throws or is unreliable', async () => {
    const remoteDetect = vi.fn().mockRejectedValue(new Error('background sleeping'));
    const lang = await detectLanguage('Esta es una prueba para el idioma español.', {
      remoteDetect,
      fallbackLang: 'en',
    });
    expect(lang).toBe('es');
  });

  it('skips remote IPC roundtrip when preferFastLocal is enabled and local confidence is high', async () => {
    const remoteDetect = vi
      .fn()
      .mockResolvedValue({ lang: 'en', confidence: 99, isReliable: true });
    const fastSpanish = await detectLanguage(
      'Esta extensión lee el texto seleccionado con una voz suave y natural.',
      { remoteDetect, fallbackLang: 'en', preferFastLocal: true }
    );
    expect(fastSpanish).toBe('es');
    expect(remoteDetect).not.toHaveBeenCalled();

    // Ambiguous short text still falls back to remoteDetect
    const ambiguous = await detectLanguage('OK test', {
      remoteDetect,
      fallbackLang: 'es',
      preferFastLocal: true,
    });
    expect(ambiguous).toBe('en');
    expect(remoteDetect).toHaveBeenCalledOnce();
  });

  it('selectPreferredVoice honors explicit preference, then natural voice quality, then local match', () => {
    const voices: VoiceInfo[] = [
      {
        id: 'espeak-es',
        name: 'Spanish+Adam',
        lang: 'es-419',
        isLocal: true,
        isDefault: true,
        engine: 'web-speech',
      },
      {
        id: 'google-es',
        name: 'Google español',
        lang: 'es-ES',
        isLocal: false,
        isDefault: false,
        engine: 'web-speech',
      },
      {
        id: 'local-en',
        name: 'Local EN',
        lang: 'en-US',
        isLocal: true,
        isDefault: true,
        engine: 'web-speech',
      },
    ];

    expect(selectPreferredVoice(voices, 'es', { es: 'espeak-es' })?.id).toBe('espeak-es');
    expect(selectPreferredVoice(voices, 'es', {})?.id).toBe('google-es');
    expect(selectPreferredVoice(voices, 'en-GB', {})?.id).toBe('local-en');
    expect(selectPreferredVoice([], 'en', {})).toBeUndefined();
  });
});
