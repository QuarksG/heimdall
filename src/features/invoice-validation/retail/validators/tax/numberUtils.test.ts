import { describe, it, expect } from 'vitest';
import { parseNumberLoose, round2 } from './numberUtils';

describe('parseNumberLoose', () => {
  it('parses plain dot-decimal numbers', () => {
    expect(parseNumberLoose('1234.56')).toBe(1234.56);
    expect(parseNumberLoose('495.00')).toBe(495);
    expect(parseNumberLoose('0.02')).toBe(0.02);
  });

  it('treats comma-only input as decimal separator (Turkish convention)', () => {
    expect(parseNumberLoose('1234,56')).toBe(1234.56);
    expect(parseNumberLoose('495,00')).toBe(495);
  });

  it('treats commas as thousands separators when both comma and dot present', () => {
    expect(parseNumberLoose('1,234.56')).toBe(1234.56);
    expect(parseNumberLoose('12,345,678.90')).toBe(12345678.9);
  });

  it('strips all whitespace, including trailing (values like "495.00 " occur in real invoices)', () => {
    expect(parseNumberLoose('495.00 ')).toBe(495);
    expect(parseNumberLoose(' 2 970.00')).toBe(2970);
    expect(parseNumberLoose('\t1234,56\n')).toBe(1234.56);
  });

  it('returns null for null, empty, and non-numeric input', () => {
    expect(parseNumberLoose(null)).toBeNull();
    expect(parseNumberLoose('')).toBeNull();
    expect(parseNumberLoose('   ')).toBeNull();
    expect(parseNumberLoose('abc')).toBeNull();
    expect(parseNumberLoose('12a34')).toBeNull();
  });

  it('returns null for non-finite results', () => {
    expect(parseNumberLoose('Infinity')).toBeNull();
    expect(parseNumberLoose('NaN')).toBeNull();
  });

  it('documents known ambiguity: comma-only groups parse as decimals', () => {
    // "1,234" is read as 1.234, not 1234 — pinned current behavior.
    expect(parseNumberLoose('1,234')).toBe(1.234);
  });

  it('parses negative and zero values', () => {
    expect(parseNumberLoose('-12,50')).toBe(-12.5);
    expect(parseNumberLoose('0')).toBe(0);
  });
});

describe('round2', () => {
  it('rounds half-up to 2 decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(1.004)).toBe(1);
    expect(round2(2.675)).toBe(2.68); // epsilon guard beats the classic FP trap
  });

  it('is idempotent on already-rounded values', () => {
    expect(round2(495)).toBe(495);
    expect(round2(594.0)).toBe(594);
    expect(round2(0.02)).toBe(0.02);
  });

  it('handles negatives and zero', () => {
    expect(round2(0)).toBe(0);
    expect(round2(-1.005)).toBe(-1); // epsilon shifts toward positive; pinned behavior
    expect(round2(-1.006)).toBe(-1.01);
  });

  it('collapses accumulated FP noise from sums', () => {
    const noisy = 0.1 + 0.2; // 0.30000000000000004
    expect(round2(noisy)).toBe(0.3);
  });
});
