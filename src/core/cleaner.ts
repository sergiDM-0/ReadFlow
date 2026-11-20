import { verbalizeMathAndQuantities } from './math-verbalizer';

export interface CleanTextOptions {
  readonly lang?: string;
  readonly omitCodeBlocks?: boolean;
  readonly omitFileNames?: boolean;
  readonly stripUrls?: boolean;
  readonly verbalizeMath?: boolean;
}

const FENCED_CODE_RE = /```[\s\S]*?```/g;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const RAW_URL_RE = /https?:\/\/[^\s<>()]+/g;
const SPLIT_ATTACHMENT_DOT_RE =
  /\b([a-zA-Z0-9_-]+)\s+(\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|heic|heif|avif|pdf|docx?|xlsx?|pptx?|csv|tsv|zip|rar|7z|tar|gz|mp3|wav|ogg|m4a|mp4|mov|webm|\d[\w.-]*))\b/gi;
const MULTIWORD_MEDIA_FILENAME_RE =
  /(?:\[\s*|\(\s*)?(?:\[[^\]]{1,16}\]\s*)?\b(?:Captura(?:\s+de\s+pantalla)?(?:\s+de)?|Screenshot|Screen\s+Shot|WhatsApp\s+Image|Pasted\s+image|Imagen|Image|Fotos?|Documento|Document|Archivo|File|PDF)\b[^\n.;,!?]{0,100}\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|heic|heif|avif|pdf?|docx?|xlsx?|pptx?)\b(?:\s*\]|\s*\))?|\[[^\]]{1,16}\]\s*[^\n.;,!?]{1,100}\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|heic|heif|avif|pdf?|docx?|xlsx?|pptx?)\b/gi;
const UUID_TOKEN_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const GENERATED_MEDIA_TOKEN_RE =
  /(?:\[\s*|\(\s*)?(?<![/:\w])(?:(?:image|imagen|img|photo|foto|screenshot|captura|attachment|adjunto|file|archivo|doc|document|documento|scan|clip|att|pxl|dsc)[._-]+(?=[a-zA-Z0-9._-]*\d)[a-zA-Z0-9._-]{2,}|(?:pasted\s+image|whatsapp\s+image|captura\s+de\s+pantalla)[._\s-]*\d(?:[\w.-]*\w)?)(?:\s*\]|\s*\))?/gi;
const MEDIA_OR_DOC_FILENAME_RE =
  /(?:\[\s*|\(\s*)?(?<![/:\w])[\w][\w.-]{0,80}\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|heic|heif|avif|pdf|docx?|xlsx?|pptx?|csv|tsv|zip|rar|7z|tar|gz|mp3|wav|ogg|m4a|mp4|mov|webm)\b(?:\s*\]|\s*\))?/gi;
const INLINE_CODE_RE = /`([^`]+)`/g;
const MARKDOWN_EMPHASIS_RE = /(\*\*|__|\*|~~)/g;
const MARKDOWN_HEADING_RE = /(^|\n)\s{0,3}#{1,6}\s+/g;
const MARKDOWN_QUOTE_RE = /(^|\n)\s*>\s+/g;
const REPETITIVE_EMOJI_RE = /(\p{Extended_Pictographic})\1{2,}/gu;
const MULTI_SPACE_RE = /[ \t]+/g;
const MULTI_NEWLINE_RE = /\n+/g;

const EXCLUDED_ATTACHMENT_TAGS = new Set([
  'svg',
  'img',
  'picture',
  'mat-icon',
  'mat-chip',
  'mat-chip-row',
  'user-query-file-preview',
  'uploaded-file',
  'uploaded-file-preview',
  'file-preview',
  'file-chip',
  'image-chip',
  'attachment-chip',
  'attachment-preview',
  'file-attachment',
  'source-footnote',
  'citation-chip',
]);

const ATTACHMENT_ATTR_RE =
  /(?:^|[\s_-])(?:(?:file|image|img|attachment|upload|media|query-file)[_-]?(?:preview|chip|card|name|badge|pill|thumbnail|container|wrapper)|uploaded-file|file-attachment)(?:$|[\s_-])/i;

function getCodePlaceholder(lang?: string): string {
  const normalized = (lang ?? '').toLowerCase();
  if (normalized.startsWith('es')) {
    return 'bloque de código omitido.';
  }
  return 'code block omitted.';
}

/**
 * Sanitizes raw text or Markdown before TTS synthesis by removing fenced code blocks,
 * raw URLs, Markdown emphasis markers, and repetitive emoji sequences.
 * @param raw Raw text input.
 * @param options Sanitization flags (`lang`, `omitCodeBlocks`, `stripUrls`).
 */
export function cleanText(raw: string, options: CleanTextOptions = {}): string {
  const {
    lang,
    omitCodeBlocks = true,
    omitFileNames = true,
    stripUrls = true,
    verbalizeMath = true,
  } = options;
  if (!raw || !raw.trim()) {
    return '';
  }

  let text = raw.replace(/\r\n?/g, '\n');

  const protectedCodeBlocks: string[] = [];
  if (omitCodeBlocks) {
    text = text.replace(FENCED_CODE_RE, ` ${getCodePlaceholder(lang)} `);
  } else {
    text = text.replace(FENCED_CODE_RE, (block) => {
      const inner = block.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '');
      const idx = protectedCodeBlocks.length;
      protectedCodeBlocks.push(inner.trim());
      return ` \uE012${idx}\uE013 `;
    });
  }

  if (omitFileNames) {
    text = text.replace(MARKDOWN_IMAGE_RE, ' ');
  }

  text = text.replace(MARKDOWN_LINK_RE, '$1');

  if (stripUrls) {
    text = text.replace(RAW_URL_RE, ' ');
  }

  if (omitFileNames) {
    text = text
      .replace(SPLIT_ATTACHMENT_DOT_RE, '$1$2')
      .replace(MULTIWORD_MEDIA_FILENAME_RE, ' ')
      .replace(UUID_TOKEN_RE, ' ')
      .replace(MEDIA_OR_DOC_FILENAME_RE, ' ')
      .replace(GENERATED_MEDIA_TOKEN_RE, ' ');
  }

  text = text
    .replace(INLINE_CODE_RE, '$1')
    .replace(MARKDOWN_HEADING_RE, '$1')
    .replace(MARKDOWN_QUOTE_RE, '$1')
    .replace(MARKDOWN_EMPHASIS_RE, '')
    .replace(REPETITIVE_EMOJI_RE, ' ')
    .replace(MULTI_NEWLINE_RE, ' ')
    .replace(MULTI_SPACE_RE, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();

  if (verbalizeMath && text) {
    text = verbalizeMathAndQuantities(text, lang ?? 'es');
  }

  if (protectedCodeBlocks.length > 0) {
    text = text
      .replace(/\uE012(\d+)\uE013/g, (_m, idx) => protectedCodeBlocks[Number(idx)] ?? '')
      .replace(MULTI_NEWLINE_RE, ' ')
      .replace(MULTI_SPACE_RE, ' ')
      .trim();
  }

  return text;
}

/**
 * Returns true when a DOM element is a duplicate math representation layer (such as LaTeX
 * `<annotation>` inside `<math>`, `.katex-html` paired with `.katex-mathml`, or `<mjx-math>`
 * paired with `<mjx-assistive-mml>`) that would otherwise cause equations to be read twice.
 */
export function isDuplicateMathNode(el: Element, tag = el.tagName.toLowerCase()): boolean {
  if (tag === 'annotation' || tag === 'annotation-xml') {
    return true;
  }
  if (
    el.classList?.contains('katex-html') &&
    el.closest('.katex')?.querySelector('.katex-mathml')
  ) {
    return true;
  }
  if (tag === 'mjx-math' && el.closest('mjx-container')?.querySelector('mjx-assistive-mml')) {
    return true;
  }
  return false;
}

export function isAttachmentOrMediaNode(el: Element, tag = el.tagName.toLowerCase()): boolean {
  if (EXCLUDED_ATTACHMENT_TAGS.has(tag)) {
    return true;
  }
  if ((el.textContent?.length ?? 0) > 250) {
    return false;
  }
  const testId = el.getAttribute('data-test-id') ?? el.getAttribute('data-testid') ?? '';
  const className = typeof el.className === 'string' ? el.className : '';
  return ATTACHMENT_ATTR_RE.test(testId) || ATTACHMENT_ATTR_RE.test(className);
}

function collectElementText(
  node: Node,
  parts: string[],
  omitCodeBlocks: boolean,
  omitFileNames: boolean,
  placeholder: string
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.textContent ?? '';
    if (value.trim()) {
      parts.push(value);
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (
    tag === 'script' ||
    tag === 'style' ||
    tag === 'noscript' ||
    el.getAttribute('aria-hidden') === 'true' ||
    isDuplicateMathNode(el, tag)
  ) {
    return;
  }

  if (omitFileNames && isAttachmentOrMediaNode(el, tag)) {
    return;
  }

  if (omitCodeBlocks && (tag === 'pre' || tag === 'code-block')) {
    parts.push(placeholder);
    return;
  }

  for (const child of Array.from(el.childNodes)) {
    collectElementText(child, parts, omitCodeBlocks, omitFileNames, placeholder);
  }
}

/**
 * Walks a DOM `Element` subtree and extracts clean, readable text while skipping
 * `<script>`, `<style>`, `[aria-hidden="true"]`, attachment/image chips, and optionally `<pre>`/`<code-block>` nodes.
 */
export function extractCleanTextFromElement(
  element: Element,
  options: CleanTextOptions = {}
): string {
  const { lang, omitCodeBlocks = true, omitFileNames = true } = options;
  const parts: string[] = [];
  collectElementText(element, parts, omitCodeBlocks, omitFileNames, getCodePlaceholder(lang));
  return cleanText(parts.join(' '), options);
}

/**
 * Clones a DOM `Range` selection and extracts sanitized text suitable for speech synthesis.
 */
export function extractCleanTextFromRange(range: Range, options: CleanTextOptions = {}): string {
  const fragment = range.cloneContents();
  const wrapper = document.createElement('div');
  wrapper.appendChild(fragment);
  return extractCleanTextFromElement(wrapper, options);
}
