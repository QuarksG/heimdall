import { describe, it, expect } from 'vitest';
import { normalizeTaxScheme, buildTaxCode } from './schemes';

describe('normalizeTaxScheme', () => {
  it('maps full Turkish tax names (with diacritics) to short codes', () => {
    expect(normalizeTaxScheme('KATMA DEĞER VERGİSİ')).toBe('KDV');
    expect(normalizeTaxScheme('ÖZEL TÜKETİM VERGİSİ')).toBe('ÖTV');
    expect(normalizeTaxScheme('ÖZEL İLETİŞİM VERGİSİ')).toBe('ÖİV');
    expect(normalizeTaxScheme('DAMGA VERGİSİ')).toBe('DV');
    expect(normalizeTaxScheme('BANKA VE SİGORTA MUAMELELERİ VERGİSİ')).toBe('BSMV');
    expect(normalizeTaxScheme('KONAKLAMA VERGİSİ')).toBe('KV');
  });

  it('maps diacritic-free spellings to short codes', () => {
    expect(normalizeTaxScheme('KATMA DEGER VERGISI')).toBe('KDV');
    expect(normalizeTaxScheme('OZEL TUKETIM VERGISI')).toBe('ÖTV');
  });

  it('normalizes lowercase full names via tr-TR uppercasing', () => {
    expect(normalizeTaxScheme('katma değer vergisi')).toBe('KDV');
    expect(normalizeTaxScheme('damga vergisi')).toBe('DV');
  });

  it('passes short codes through unchanged', () => {
    expect(normalizeTaxScheme('KDV')).toBe('KDV');
    expect(normalizeTaxScheme('ÖTV')).toBe('ÖTV');
  });

  it('defaults empty/whitespace to KDV', () => {
    expect(normalizeTaxScheme('')).toBe('KDV');
    expect(normalizeTaxScheme('   ')).toBe('KDV');
  });

  it('trims surrounding whitespace before matching', () => {
    expect(normalizeTaxScheme('  KATMA DEĞER VERGİSİ  ')).toBe('KDV');
  });

  /*
   * PINNED GAP: hybrid-diacritic spellings miss the alias map.
   * "KATMA DEĞER VERGISI" (Ğ present, but dotless-I "VERGISI") is in neither
   * alias entry, so it passes through unchanged. Real invoices contain this
   * (see Flormar fixture); the engine's rate-only fallback rescues matching.
   * If the alias map is ever extended, update this test deliberately.
   */
  it('documents current behavior: hybrid-diacritic name is NOT normalized', () => {
    expect(normalizeTaxScheme('KATMA DEĞER VERGISI')).toBe('KATMA DEĞER VERGISI');
  });

  it('passes unknown scheme names through unchanged', () => {
    expect(normalizeTaxScheme('GELİR VERGİSİ')).toBe('GELİR VERGİSİ');
  });
});

describe('buildTaxCode', () => {
  it('builds scheme-TR-rate keys with 2-decimal rates', () => {
    expect(buildTaxCode('KDV', 18)).toBe('KDV-TR-18.00%');
    expect(buildTaxCode('KDV', 20)).toBe('KDV-TR-20.00%');
    expect(buildTaxCode('ÖTV', 0.5)).toBe('ÖTV-TR-0.50%');
  });

  it('normalizes the scheme before building the key', () => {
    expect(buildTaxCode('KATMA DEĞER VERGİSİ', 20)).toBe('KDV-TR-20.00%');
    expect(buildTaxCode('', 18)).toBe('KDV-TR-18.00%');
  });

  it('coerces non-finite rates to 0', () => {
    expect(buildTaxCode('KDV', NaN)).toBe('KDV-TR-0.00%');
    expect(buildTaxCode('KDV', Infinity)).toBe('KDV-TR-0.00%');
  });

  it('keeps the hybrid-diacritic name distinct from KDV (matching gap pinned above)', () => {
    expect(buildTaxCode('KATMA DEĞER VERGISI', 20)).toBe('KATMA DEĞER VERGISI-TR-20.00%');
  });
});
