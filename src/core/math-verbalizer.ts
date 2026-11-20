/**
 * Language-aware verbalizer for mathematical expressions, comparisons, roots, powers,
 * fractions, scientific notation, currencies, percentages, and physical/digital units.
 */

interface MathLocaleLexicon {
  readonly greaterOrEqual: string;
  readonly lessOrEqual: string;
  readonly notEqual: string;
  readonly approxEqual: string;
  readonly identical: string;
  readonly greaterThan: string;
  readonly lessThan: string;
  readonly equals: string;
  readonly plusOrMinus: string;
  readonly plus: string;
  readonly minus: string;
  readonly times: string;
  readonly dividedBy: string;
  readonly squareRootOf: string;
  readonly cubeRootOf: string;
  readonly squared: string;
  readonly cubed: string;
  readonly toPowerOf: string;
  readonly timesTenPower: string;
  readonly percent: string;
  readonly degreesC: string;
  readonly degreesF: string;
  readonly degrees: string;
  readonly infinity: string;
  readonly sum: string;
  readonly integralOf: string;
  readonly belongsTo: string;
  readonly notBelongsTo: string;
  readonly implies: string;
  readonly iff: string;
  readonly forAll: string;
  readonly exists: string;
  readonly dollars: string;
  readonly euros: string;
  readonly pounds: string;
  readonly fractions: Readonly<Record<string, string>>;
  readonly units: Readonly<Record<string, string>>;
}

const ES_LEXICON: MathLocaleLexicon = {
  greaterOrEqual: 'mayor o igual que',
  lessOrEqual: 'menor o igual que',
  notEqual: 'distinto de',
  approxEqual: 'aproximadamente igual a',
  identical: 'idéntico a',
  greaterThan: 'mayor que',
  lessThan: 'menor que',
  equals: 'igual a',
  plusOrMinus: 'más o menos',
  plus: 'más',
  minus: 'menos',
  times: 'por',
  dividedBy: 'dividido entre',
  squareRootOf: 'raíz cuadrada de',
  cubeRootOf: 'raíz cúbica de',
  squared: 'al cuadrado',
  cubed: 'al cubo',
  toPowerOf: 'elevado a',
  timesTenPower: 'por 10 elevado a',
  percent: 'por ciento',
  degreesC: 'grados Celsius',
  degreesF: 'grados Fahrenheit',
  degrees: 'grados',
  infinity: 'infinito',
  sum: 'sumatoria de',
  integralOf: 'integral de',
  belongsTo: 'pertenece a',
  notBelongsTo: 'no pertenece a',
  implies: 'implica',
  iff: 'si y solo si',
  forAll: 'para todo',
  exists: 'existe',
  dollars: 'dólares',
  euros: 'euros',
  pounds: 'libras',
  fractions: {
    '1/2': 'un medio',
    '1/3': 'un tercio',
    '2/3': 'dos tercios',
    '1/4': 'un cuarto',
    '3/4': 'tres cuartos',
    '1/5': 'un quinto',
    '2/5': 'dos quintos',
    '3/5': 'tres quintos',
    '4/5': 'cuatro quintos',
    '1/6': 'un sexto',
    '5/6': 'cinco sextos',
    '1/8': 'un octavo',
    '3/8': 'tres octavos',
    '5/8': 'cinco octavos',
    '7/8': 'siete octavos',
    '1/10': 'un décimo',
  },
  units: {
    'km/h': 'kilómetros por hora',
    'm/s': 'metros por segundo',
    km: 'kilómetros',
    cm: 'centímetros',
    mm: 'milímetros',
    kg: 'kilogramos',
    mg: 'miligramos',
    ml: 'mililitros',
    ms: 'milisegundos',
    GHz: 'gigahercios',
    MHz: 'megahercios',
    GB: 'gigabytes',
    MB: 'megabytes',
    KB: 'kilobytes',
  },
};

const EN_LEXICON: MathLocaleLexicon = {
  greaterOrEqual: 'greater than or equal to',
  lessOrEqual: 'less than or equal to',
  notEqual: 'not equal to',
  approxEqual: 'approximately equal to',
  identical: 'identical to',
  greaterThan: 'greater than',
  lessThan: 'less than',
  equals: 'equals',
  plusOrMinus: 'plus or minus',
  plus: 'plus',
  minus: 'minus',
  times: 'times',
  dividedBy: 'divided by',
  squareRootOf: 'square root of',
  cubeRootOf: 'cube root of',
  squared: 'squared',
  cubed: 'cubed',
  toPowerOf: 'to the power of',
  timesTenPower: 'times 10 to the power of',
  percent: 'percent',
  degreesC: 'degrees Celsius',
  degreesF: 'degrees Fahrenheit',
  degrees: 'degrees',
  infinity: 'infinity',
  sum: 'sum of',
  integralOf: 'integral of',
  belongsTo: 'belongs to',
  notBelongsTo: 'does not belong to',
  implies: 'implies',
  iff: 'if and only if',
  forAll: 'for all',
  exists: 'there exists',
  dollars: 'dollars',
  euros: 'euros',
  pounds: 'pounds',
  fractions: {
    '1/2': 'one half',
    '1/3': 'one third',
    '2/3': 'two thirds',
    '1/4': 'one quarter',
    '3/4': 'three quarters',
    '1/5': 'one fifth',
    '2/5': 'two fifths',
    '3/5': 'three fifths',
    '4/5': 'four fifths',
    '1/6': 'one sixth',
    '5/6': 'five sixths',
    '1/8': 'one eighth',
    '3/8': 'three eighths',
    '5/8': 'five eighths',
    '7/8': 'seven eighths',
    '1/10': 'one tenth',
  },
  units: {
    'km/h': 'kilometers per hour',
    'm/s': 'meters per second',
    km: 'kilometers',
    cm: 'centimeters',
    mm: 'millimeters',
    kg: 'kilograms',
    mg: 'milligrams',
    ml: 'milliliters',
    ms: 'milliseconds',
    GHz: 'gigahertz',
    MHz: 'megahertz',
    GB: 'gigabytes',
    MB: 'megabytes',
    KB: 'kilobytes',
  },
};

function getLexicon(lang?: string): MathLocaleLexicon {
  const normalized = (lang ?? 'es').trim().toLowerCase();
  return normalized.startsWith('en') ? EN_LEXICON : ES_LEXICON;
}

const URL_PROTECT_RE = /https?:\/\/[^\s<>()]+/gi;
const UNIT_KEYS = Object.keys(ES_LEXICON.units)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace('/', '\\/'))
  .join('|');
const QUANTITY_UNIT_RE = new RegExp(
  `(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_KEYS})(?=\\b|\\s|$|[.,;:])`,
  'g'
);

/**
 * Converts mathematical notation, comparisons, roots, exponents, fractions, scientific notation,
 * percentages, currencies, and measurement units into natural spoken words for TTS.
 * Protects URLs so slashes/equals inside links are never altered when `stripUrls` is false.
 *
 * @param input Cleaned prose/math string.
 * @param lang Target language code (`'es'` or `'en'`; defaults to `'es'`).
 */
export function verbalizeMathAndQuantities(input: string, lang = 'es'): string {
  if (!input || !input.trim()) {
    return input;
  }

  const lex = getLexicon(lang);
  const protectedUrls: string[] = [];
  let text = input.replace(URL_PROTECT_RE, (url) => {
    const idx = protectedUrls.length;
    protectedUrls.push(url);
    return `\uE010${idx}\uE011`;
  });

  // 1. Scientific notation (e.g. 3.5e-4, 1.2E+6)
  text = text.replace(/(\d+(?:[.,]\d+)?)[eE]([+-]?)(\d+)/g, (_m, mantissa, sign, exp) => {
    const signWord = sign === '-' ? `${lex.minus} ` : sign === '+' ? `${lex.plus} ` : '';
    return `${mantissa} ${lex.timesTenPower} ${signWord}${exp}`;
  });

  // 2. Currencies ($45.50, €100, £20)
  text = text
    .replace(/(^|\s)\$(\d+(?:[.,]\d+)*)/g, `$1$2 ${lex.dollars}`)
    .replace(/(^|\s)€(\d+(?:[.,]\d+)*)/g, `$1$2 ${lex.euros}`)
    .replace(/(^|\s)£(\d+(?:[.,]\d+)*)/g, `$1$2 ${lex.pounds}`);

  // 3. Percentages and temperatures / degrees
  text = text
    .replace(/(\d+(?:[.,]\d+)?)\s*%/g, `$1 ${lex.percent}`)
    .replace(/(\d+(?:[.,]\d+)?)\s*°\s*C\b/gi, `$1 ${lex.degreesC}`)
    .replace(/(\d+(?:[.,]\d+)?)\s*°\s*F\b/gi, `$1 ${lex.degreesF}`)
    .replace(/(\d+(?:[.,]\d+)?)\s*°/g, `$1 ${lex.degrees}`);

  // 4. Measurement & computing units right after numbers (e.g., 120 km/h, 5 kg, 250 ms)
  text = text.replace(QUANTITY_UNIT_RE, (_m, num: string, unit: string) => {
    const spokenUnit = lex.units[unit] ?? unit;
    return `${num} ${spokenUnit}`;
  });

  // 5. Roots and powers (√25, ∛27, x², y³, z^n, 10^6)
  text = text
    .replace(/√\s*\(([^)]+)\)/g, ` ${lex.squareRootOf} $1 `)
    .replace(/√\s*([a-zA-Z0-9.,]+)/g, ` ${lex.squareRootOf} $1 `)
    .replace(/∛\s*\(([^)]+)\)/g, ` ${lex.cubeRootOf} $1 `)
    .replace(/∛\s*([a-zA-Z0-9.,]+)/g, ` ${lex.cubeRootOf} $1 `)
    .replace(/([a-zA-Z0-9)])\s*²/g, `$1 ${lex.squared}`)
    .replace(/([a-zA-Z0-9)])\s*³/g, `$1 ${lex.cubed}`)
    .replace(/([a-zA-Z0-9)])\s*\^\s*2(?![0-9a-zA-Z])/g, `$1 ${lex.squared}`)
    .replace(/([a-zA-Z0-9)])\s*\^\s*3(?![0-9a-zA-Z])/g, `$1 ${lex.cubed}`)
    .replace(/([a-zA-Z0-9)])\s*\^\s*\(([^)]+)\)/g, `$1 ${lex.toPowerOf} $2`)
    .replace(/([a-zA-Z0-9)])\s*\^\s*([a-zA-Z0-9+-]+)/g, `$1 ${lex.toPowerOf} $2`);

  // 6. Numeric fractions & division (1/2, 3/4, 10 / 2, 100 ÷ 4) without breaking file paths
  text = text.replace(/(?<![\w/])(\d+)\s*\/\s*(\d+)(?![\w/])/g, (match, a: string, b: string) => {
    const compact = `${a}/${b}`;
    return lex.fractions[compact] ?? `${a} ${lex.dividedBy} ${b}`;
  });
  text = text.replace(/\s*÷\s*/g, ` ${lex.dividedBy} `);

  // 7. Greek & advanced math symbols
  text = text
    .replace(/∞/g, ` ${lex.infinity} `)
    .replace(/\bπ\b|(?<![a-zA-Z])π(?![a-zA-Z])/g, ' pi ')
    .replace(/∑/g, ` ${lex.sum} `)
    .replace(/∫/g, ` ${lex.integralOf} `)
    .replace(/∉/g, ` ${lex.notBelongsTo} `)
    .replace(/∈/g, ` ${lex.belongsTo} `)
    .replace(/⇔/g, ` ${lex.iff} `)
    .replace(/⇒|→/g, ` ${lex.implies} `)
    .replace(/∀/g, ` ${lex.forAll} `)
    .replace(/∃/g, ` ${lex.exists} `)
    .replace(/±/g, ` ${lex.plusOrMinus} `);

  // 8. Relational & comparison operators (>=, <=, !=, !==, ≈, ≡, ≥, ≤, ≠, >, <, =)
  text = text
    .replace(/\s*(?:>=|≥)\s*/g, ` ${lex.greaterOrEqual} `)
    .replace(/\s*(?:<=|≤)\s*/g, ` ${lex.lessOrEqual} `)
    .replace(/\s*(?:!==?|≠)\s*/g, ` ${lex.notEqual} `)
    .replace(/\s*≈\s*/g, ` ${lex.approxEqual} `)
    .replace(/\s*≡\s*/g, ` ${lex.identical} `)
    .replace(/(^|[\s(a-zA-Z0-9])>\s*([a-zA-Z0-9(+-])/g, `$1 ${lex.greaterThan} $2`)
    .replace(/(^|[\s(a-zA-Z0-9])<\s*([a-zA-Z0-9(+-])/g, `$1 ${lex.lessThan} $2`)
    .replace(/([a-zA-Z0-9)\]])\s*=\s*([a-zA-Z0-9([-])/g, `$1 ${lex.equals} $2`);

  // 9. Arithmetic operators (+, -, *, ×, ·) in explicit math contexts (never breaking hyphenated words or Ctrl+C shortcuts)
  text = text
    .replace(/([a-zA-Z0-9)])\s+\+\s+([a-zA-Z0-9(])/g, `$1 ${lex.plus} $2`)
    .replace(/([0-9)])\s*\+\s*([a-zA-Z0-9(])/g, `$1 ${lex.plus} $2`)
    .replace(/([a-zA-Z0-9)])\s*\+\s*([0-9(])/g, `$1 ${lex.plus} $2`)
    .replace(/([0-9)])\s+[-−]\s+([0-9(])/g, `$1 ${lex.minus} $2`)
    .replace(/([a-zA-Z0-9)])\s*[×·]\s*([a-zA-Z0-9(])/g, `$1 ${lex.times} $2`)
    .replace(/([0-9)])\s*\*\s*([0-9(])/g, `$1 ${lex.times} $2`);

  // Restore protected URLs and collapse whitespace
  text = text
    .replace(/\uE010(\d+)\uE011/g, (_m, idx) => protectedUrls[Number(idx)] ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();

  return text;
}
