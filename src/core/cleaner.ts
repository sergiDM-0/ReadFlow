export interface CleanTextOptions {
  readonly lang?: string;
  readonly omitCodeBlocks?: boolean;
  readonly omitFileNames?: boolean;
  readonly stripUrls?: boolean;
}

const FENCED_CODE_RE = /```[\s\S]*?```/g;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const RAW_URL_RE = /https?:\/\/[^\s<>()]+/g;
const GENERATED_MEDIA_TOKEN_RE =
  /(?:\[\s*|\(\s*)?(?<![/:\w])(?:(?:image|imagen|img|photo|foto|screenshot|captura|attachment|adjunto|file|archivo|doc|document|documento|scan|clip)[._-]+\d|(?:pasted\s+image|whatsapp\s+image|captura\s+de\s+pantalla)[._\s-]*\d)(?:[\w.-]*\w)?(?:\s*\]|\s*\))?/gi;
const MEDIA_OR_DOC_FILENAME_RE =
  /(?:\[\s*|\(\s*)?(?<![/:\w])[\w][\w.-]{0,80}\.(?:png|jpe?g|gif|webp|svg|bmp|ico|tiff?|heic|heif|avif|pdf|docx?|xlsx?|pptx?|csv|tsv|zip|rar|7z|tar|gz|mp3|wav|ogg|m4a|mp4|mov|webm)\b(?:\s*\]|\s*\))?/gi;
const INLINE_CODE_RE = /`([^`]+)`/g;
const MARKDOWN_EMPHASIS_RE = /(\*\*|__|\*|~~)/g;
const MARKDOWN_HEADING_RE = /(^|\n)\s{0,3}#{1,6}\s+/g;
const MARKDOWN_QUOTE_RE = /(^|\n)\s*>\s?/g;
const REPETITIVE_EMOJI_RE = /(\p{Extended_Pictographic})\1{2,}/gu;
const MULTI_SPACE_RE = /[ \t]+/g;
const MULTI_NEWLINE_RE = /\n+/g;

const EXCLUDED_ATTACHMENT_TAGS = new Set([
  'svg',
  'img',
  'picture',
  'mat-icon',
  'user-query-file-preview',
  'uploaded-file',
  'file-preview',
  'attachment-chip',
  'source-footnote',
  'citation-chip',
]);

const ATTACHMENT_ATTR_RE =
  /(?:^|[\s_-])(?:file-attachment|attachment-chip|file-preview|file-chip|image-preview|upload-preview|uploaded-file)(?:$|[\s_-])/i;

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
  const { lang, omitCodeBlocks = true, omitFileNames = true, stripUrls = true } = options;
  if (!raw || !raw.trim()) {
    return '';
  }

  let text = raw.replace(/\r\n?/g, '\n');

  if (omitCodeBlocks) {
    text = text.replace(FENCED_CODE_RE, ` ${getCodePlaceholder(lang)} `);
  } else {
    text = text.replace(/```[a-zA-Z0-9_-]*\n?/g, ' ').replace(/```/g, ' ');
  }

  if (omitFileNames) {
    text = text.replace(MARKDOWN_IMAGE_RE, ' ');
  }

  text = text.replace(MARKDOWN_LINK_RE, '$1');

  if (stripUrls) {
    text = text.replace(RAW_URL_RE, ' ');
  }

  if (omitFileNames) {
    text = text.replace(MEDIA_OR_DOC_FILENAME_RE, ' ').replace(GENERATED_MEDIA_TOKEN_RE, ' ');
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

  return text;
}

export function isAttachmentOrMediaNode(el: Element, tag = el.tagName.toLowerCase()): boolean {
  if (EXCLUDED_ATTACHMENT_TAGS.has(tag)) {
    return true;
  }
  const testId = el.getAttribute('data-test-id') ?? '';
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
    el.getAttribute('aria-hidden') === 'true'
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
