import { describe, it, expect } from 'vitest';
import { verbalizeMathAndQuantities } from '../../src/core/math-verbalizer';

describe('verbalizeMathAndQuantities', () => {
  it('verbalizes comparisons and equations naturally in Spanish without duplicating', () => {
    expect(verbalizeMathAndQuantities('>3 = algo', 'es')).toBe('mayor que 3 igual a algo');
    expect(verbalizeMathAndQuantities('x >= 10 y <= 5', 'es')).toBe(
      'x mayor o igual que 10 y menor o igual que 5'
    );
    expect(verbalizeMathAndQuantities('a != b, c ≠ d, π ≈ 3.14', 'es')).toBe(
      'a distinto de b, c distinto de d, pi aproximadamente igual a 3.14'
    );
  });

  it('verbalizes arithmetic, roots, powers, fractions, and scientific notation in Spanish', () => {
    expect(verbalizeMathAndQuantities('2 + 3 = 5', 'es')).toBe('2 más 3 igual a 5');
    expect(verbalizeMathAndQuantities('10 - 4 = 6', 'es')).toBe('10 menos 4 igual a 6');
    expect(verbalizeMathAndQuantities('6 * 7 = 42', 'es')).toBe('6 por 7 igual a 42');
    expect(verbalizeMathAndQuantities('100 ÷ 4 = 25', 'es')).toBe(
      '100 dividido entre 4 igual a 25'
    );
    expect(verbalizeMathAndQuantities('√25 = 5 y ∛27 = 3', 'es')).toBe(
      'raíz cuadrada de 25 igual a 5 y raíz cúbica de 27 igual a 3'
    );
    expect(verbalizeMathAndQuantities('x² + y³ = z^n', 'es')).toBe(
      'x al cuadrado más y al cubo igual a z elevado a n'
    );
    expect(verbalizeMathAndQuantities('1/2 taza y 3/4 de litro', 'es')).toBe(
      'un medio taza y tres cuartos de litro'
    );
    expect(verbalizeMathAndQuantities('3.5e-4', 'es')).toBe('3.5 por 10 elevado a menos 4');
  });

  it('verbalizes quantities, percentages, temperatures, currencies, and units in Spanish and English', () => {
    expect(verbalizeMathAndQuantities('Subió 25% a 37.5 °C y 120 km/h', 'es')).toBe(
      'Subió 25 por ciento a 37.5 grados Celsius y 120 kilómetros por hora'
    );
    expect(verbalizeMathAndQuantities('Cuesta $45.50 o €100 y pesa 5 kg', 'es')).toBe(
      'Cuesta 45.50 dólares o 100 euros y pesa 5 kilogramos'
    );
    expect(verbalizeMathAndQuantities('x >= 3 and √16 = 4 at 50% or $20', 'en')).toBe(
      'x greater than or equal to 3 and square root of 16 equals 4 at 50 percent or 20 dollars'
    );
  });

  it('preserves ordinary hyphenated words, keyboard shortcuts, file paths, and non-math prose', () => {
    expect(verbalizeMathAndQuantities('La extensión text-to-speech es auto-lectura.', 'es')).toBe(
      'La extensión text-to-speech es auto-lectura.'
    );
    expect(verbalizeMathAndQuantities('Archivo en src/core/cleaner.ts listo.', 'es')).toBe(
      'Archivo en src/core/cleaner.ts listo.'
    );
    expect(verbalizeMathAndQuantities('Pulsa Ctrl+C para copiar.', 'es')).toBe(
      'Pulsa Ctrl+C para copiar.'
    );
    expect(verbalizeMathAndQuantities('50% et 2 kg', 'ja')).toBe('50% et 2 kg');
    expect(verbalizeMathAndQuantities('2 + 3 = 5 at 50% e 2 kg', 'pt-BR')).toBe(
      '2 mais 3 igual a 5 at 50 por cento e 2 quilogramas'
    );
    expect(verbalizeMathAndQuantities('2 + 3 = 5 et 50% et 2 kg', 'fr-FR')).toBe(
      '2 plus 3 égal à 5 et 50 pour cent et 2 kilogrammes'
    );
    expect(verbalizeMathAndQuantities('2 + 3 = 5 und 50% und 2 kg', 'de-DE')).toBe(
      '2 plus 3 gleich 5 und 50 Prozent und 2 Kilogramm'
    );
    expect(verbalizeMathAndQuantities('2 + 3 = 5 e 50% e 2 kg', 'it-IT')).toBe(
      '2 più 3 uguale a 5 e 50 per cento e 2 chilogrammi'
    );
    expect(verbalizeMathAndQuantities('Hex 0x1e5 y https://example.com/1/2?x=3', 'es')).toBe(
      'Hex 0x1e5 y https://example.com/1/2?x=3'
    );
    expect(verbalizeMathAndQuantities('   ', 'es')).toBe('   ');
  });

  it('handles chained comparisons, advanced math symbols, and powers/roots cleanly', () => {
    expect(verbalizeMathAndQuantities('1<x<10 y a=b=c y (>3)', 'es')).toBe(
      '1 menor que x menor que 10 y a igual a b igual a c y (mayor que 3)'
    );
    expect(verbalizeMathAndQuantities('2^4 - 1 + 1.2E+6', 'es')).toBe(
      '2 elevado a 4 menos 1 más 1.2 por 10 elevado a más 6'
    );
    expect(verbalizeMathAndQuantities('x^2 + y^3 + z^(n+1)', 'es')).toBe(
      'x al cuadrado más y al cubo más z elevado a n más 1'
    );
    expect(verbalizeMathAndQuantities('√(a + b) + ∛(27) + 5/7', 'es')).toBe(
      'raíz cuadrada de a más b más raíz cúbica de 27 más 5 dividido entre 7'
    );
    expect(verbalizeMathAndQuantities('£20 a 68 °F o 90° ± 1 × 2 · 3', 'es')).toBe(
      '20 libras a 68 grados Fahrenheit o 90 grados más o menos 1 por 2 por 3'
    );
    expect(verbalizeMathAndQuantities('∀ x ∈ ℝ, x ∉ ∅ ⇒ ∑ ∞ ∫ ≡ ⇔ ∃', 'es')).toBe(
      'para todo x pertenece a ℝ, x no pertenece a ∅ implica sumatoria de infinito integral de idéntico a si y solo si existe'
    );
  });
});
