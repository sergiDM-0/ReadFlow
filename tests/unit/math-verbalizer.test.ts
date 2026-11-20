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
  });
});
