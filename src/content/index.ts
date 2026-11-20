import browser from 'webextension-polyfill';
import { EchoSelectContentApp } from './app';
import { enableGoogleDocsCanvasAnnotations } from './selection-handler';

enableGoogleDocsCanvasAnnotations(document, browser.runtime?.id || 'echoselect-tts');
const app = new EchoSelectContentApp();
void app.start();
