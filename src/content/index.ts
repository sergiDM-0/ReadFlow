import browser from 'webextension-polyfill';
import { ReadFlowContentApp } from './app';
import { enableGoogleDocsCanvasAnnotations } from './selection-handler';

enableGoogleDocsCanvasAnnotations(document, browser.runtime?.id || 'readflow-tts');
const app = new ReadFlowContentApp();
void app.start();
