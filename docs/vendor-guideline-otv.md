# Vendor Guideline: Modeling ÖTV (Special Consumption Tax) in UBL e-Invoices

**Audience:** TR vendors issuing e-invoices with ÖTV-liable products (tax type code `0071`)
**Reference invoice:** `f0c69bc5-ac3c-49c5-9937-1fc08ae2828c.xml` (Kuzey Pet, docs/OTV.zip) — passed Amazon invoice validation
**Legal basis:** KDV Kanunu m.24 — ÖTV is included in the KDV (VAT) base

---

## The pattern in one sentence

ÖTV is calculated on the net line amount; KDV is calculated on **net + ÖTV** (cascade). The invoice totals must reflect this consistently at line level, document level, and in `LegalMonetaryTotal`.

---

## 1. Line level — one `TaxTotal`, two `TaxSubtotal`s

Example from the reference invoice, **InvoiceLine 13** (EVER CLEAN LITTERFREE PAWS 10 LT, qty 313):

```xml
<cbc:LineExtensionAmount currencyID="TRY">254747.57</cbc:LineExtensionAmount>  <!-- pure net, no tax -->
<cac:TaxTotal>
  <cbc:TaxAmount currencyID="TRY">69579.274</cbc:TaxAmount>                   <!-- KDV + ÖTV combined -->
  <cac:TaxSubtotal>                                                            <!-- KDV -->
    <cbc:TaxableAmount currencyID="TRY">270272.37</cbc:TaxableAmount>          <!-- 254747.57 + 15524.80 -->
    <cbc:TaxAmount currencyID="TRY">54054.474</cbc:TaxAmount>                  <!-- 270272.37 × 20% -->
    <cbc:Percent>20</cbc:Percent>
    <cac:TaxCategory><cac:TaxScheme>
      <cbc:Name>KDV</cbc:Name>
      <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
    </cac:TaxScheme></cac:TaxCategory>
  </cac:TaxSubtotal>
  <cac:TaxSubtotal>                                                            <!-- ÖTV -->
    <cbc:TaxableAmount currencyID="TRY">254747.57</cbc:TaxableAmount>          <!-- = LineExtensionAmount -->
    <cbc:TaxAmount currencyID="TRY">15524.80</cbc:TaxAmount>
    <cbc:Percent>6.0941896325056211527356276647</cbc:Percent>                  <!-- effective rate, full precision -->
    <cac:TaxCategory><cac:TaxScheme>
      <cbc:Name>PETROL VE DOĞALGAZ ÜRÜNLERİNE İLİŞKİN ÖZEL TÜKETİM VERGİSİ</cbc:Name>
      <cbc:TaxTypeCode>0071</cbc:TaxTypeCode>
    </cac:TaxScheme></cac:TaxCategory>
  </cac:TaxSubtotal>
</cac:TaxTotal>
```

**Rules (per ÖTV-liable line):**

| # | Rule | Line 13 check |
|---|------|---------------|
| L1 | ÖTV `TaxableAmount` = `LineExtensionAmount` | 254,747.57 = 254,747.57 ✓ |
| L2 | KDV `TaxableAmount` = `LineExtensionAmount` + ÖTV `TaxAmount` | 254,747.57 + 15,524.80 = 270,272.37 ✓ |
| L3 | KDV `TaxAmount` = KDV `TaxableAmount` × `Percent` / 100 | 270,272.37 × 20% = 54,054.474 ✓ |
| L4 | ÖTV `TaxAmount` = ÖTV `TaxableAmount` × `Percent` / 100 (≤ 0.02 TL deviation) | 254,747.57 × 6.09418963…% = 15,524.80 ✓ |
| L5 | Line `TaxTotal/TaxAmount` = KDV + ÖTV amounts | 54,054.474 + 15,524.80 = 69,579.274 ✓ |

> **Note on ÖTV `Percent`:** ÖTV on petroleum/gas products is a fixed amount per unit (maktu). Publish the **back-calculated effective rate with full decimal precision** so that TaxableAmount × Percent = TaxAmount holds to the kuruş. Rounding the percent to 2 decimals breaks the arithmetic check. The reference invoice uses two effective rates: `6.0941896325056211527356276647` and `5.4055035873217691399509581328`.

Lines with no ÖTV (e.g. lines 12, 16–18) keep the standard single KDV `TaxSubtotal` where `TaxableAmount = LineExtensionAmount`.

---

## 2. Document level — one `TaxSubtotal` per (scheme, rate)

The document `TaxTotal` in the reference invoice:

| Scheme | Code | Percent | TaxableAmount | TaxAmount |
|--------|------|---------|--------------:|----------:|
| KDV | 0015 | 20 | 1,035,569.52 | 207,113.904 |
| KDV | 0015 | 10 | 4,708.50 | 470.85 |
| ÖTV | 0071 | 5.40550359… | 3,303.30 | 178.56 |
| ÖTV | 0071 | 6.09418963… | 252,305.90 | 15,376.00 |
| ÖTV | 0071 | 5.40550359… | 25,875.85 | 1,398.72 |
| ÖTV | 0071 | 5.40550359… | 1,651.65 | 89.28 |
| ÖTV | 0071 | 6.09418963… | 224,633.64 | 13,689.60 |
| ÖTV | 0071 | 6.09418963… | 104,991.81 | 6,398.40 |
| ÖTV | 0071 | 6.09418963… | 254,747.57 | 15,524.80 |
| ÖTV | 0071 | 5.40550359… | 35,235.20 | 1,904.64 |
| ÖTV | 0071 | 6.09418963… | 66,738.98 | 4,067.20 |

**Rules:**

| # | Rule | Check |
|---|------|-------|
| D1 | Document `TaxTotal/TaxAmount` = Σ all line `TaxTotal/TaxAmount` (KDV + ÖTV) | 266,211.95 = 266,211.95 ✓ |
| D2 | Σ document KDV `TaxableAmount` = Σ line KDV taxable amounts (ÖTV-inclusive) | 1,035,569.52 + 4,708.50 = 1,040,278.02 ✓ |
| D3 | Σ document ÖTV `TaxAmount` = Σ line ÖTV amounts | 58,627.20 = 58,627.20 ✓ |

> The reference invoice repeats one ÖTV subtotal per line rather than grouping by rate. Grouping into one subtotal per rate (2 ÖTV rows instead of 9) is also acceptable and cleaner; the sums are what must reconcile. Do **not**, however, split a single KDV rate across multiple subtotals with different exemption codes — that causes rejection.

---

## 3. `LegalMonetaryTotal` — the part most vendors get wrong

```xml
<cbc:LineExtensionAmount>981650.82</cbc:LineExtensionAmount>
<cbc:TaxExclusiveAmount>1040278.02</cbc:TaxExclusiveAmount>
<cbc:TaxInclusiveAmount>1247862.77</cbc:TaxInclusiveAmount>
<cbc:AllowanceTotalAmount>0.00</cbc:AllowanceTotalAmount>
<cbc:PayableAmount>1247862.77</cbc:PayableAmount>
```

| # | Rule | Check |
|---|------|-------|
| M1 | `LineExtensionAmount` = Σ line nets (ÖTV **excluded**) | 981,650.82 ✓ |
| M2 | `TaxExclusiveAmount` = Σ line nets **+ Σ ÖTV** = Σ KDV taxable amounts | 981,650.82 + 58,627.20 = 1,040,278.02 ✓ |
| M3 | `TaxInclusiveAmount` = `TaxExclusiveAmount` + Σ KDV | 1,040,278.02 + 207,584.75 = 1,247,862.77 ✓ |
| M4 | `PayableAmount` = `TaxInclusiveAmount` − allowances | 1,247,862.77 ✓ |

> **Key insight:** `TaxExclusiveAmount` means "exclusive of **KDV** only", not "exclusive of all taxes". ÖTV rides inside it. M2 is the anchor identity that Amazon's engine reconciles against.

---

## Common mistakes that cause rejection

1. Setting KDV `TaxableAmount` = `LineExtensionAmount` on ÖTV lines (forgetting the cascade) — KDV then under-computes.
2. `TaxExclusiveAmount` = Σ line nets without ÖTV — breaks reconciliation with the KDV base.
3. Rounding the effective ÖTV `Percent` to 2 decimals — arithmetic check fails beyond the 0.02 TL tolerance.
4. Putting ÖTV inside `LineExtensionAmount` — double-counts ÖTV in the KDV base.
5. Omitting the ÖTV `TaxSubtotal` at document level while including it at line level (or vice versa).

---

*All figures above are taken verbatim from the reference invoice and can be cross-checked against `docs/OTV_extracted/f0c69bc5-ac3c-49c5-9937-1fc08ae2828c.xml`.*
