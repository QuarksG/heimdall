# Payment Reconciliation as an Inverse-Function Audit Model

## Abstract

A remittance advice is downstream evidence of upstream business events: a purchase order was accepted; goods were shipped, counted, and scanned; an e-invoice passed validation; quantities and prices were matched; claims were opened, released, or converted; discounts were applied; and a wire was issued. This paper defines the inverse function. Starting from remittance evidence, it reconstructs those events and their accounting or economic effects, then tests whether they explain the **Giden Havale** (outgoing wire) to one kuruş.

The model is deterministic: identical workbook evidence produces identical admission decisions, classifications, reconstructions, and verdicts. It also has explicit refusal boundaries. When one remittance cannot establish a fact, the correct result is a named review state and a prescribed analyst action—not an inference.

## Executive thesis

Every major audit step follows the same chain:

```text
upstream business event
  → remittance evidence
  → mathematical treatment
  → contribution to reconstructed wire
  → analyst decision or refusal
```

Two propositions govern the model:

1. **Inverse-function thesis.** Every recognized row is the documentary fingerprint of an upstream event. The model maps that fingerprint back to its business cause, lifecycle, and monetary effect.
2. **Cashier/wire identity.** The reconstructed effects must equal the actual **Giden Havale**. Equality produces a GREEN verdict only when all independent controls also pass. Otherwise, the model names the exact residue, failed control, or review condition.

An auditor, finance analyst, or engineer should be able to reproduce the verdict by hand from the admitted workbook evidence.

## Navigation

- [Part I — Business process and evidentiary foundation](#part-i--business-process-and-evidentiary-foundation)
- [Part II — Formal admission, normalization, and classification](#part-ii--formal-admission-normalization-and-classification)
- [Part III — Claim lifecycles and discount algebra](#part-iii--claim-lifecycles-and-discount-algebra)
- [Part IV — Reconstructing and testing the wire](#part-iv--reconstructing-and-testing-the-wire)
- [Part V — Invariants, refusal boundaries, and conclusion](#part-v--invariants-refusal-boundaries-and-conclusion)

# Part I — Business process and evidentiary foundation

## 1. Evidentiary vocabulary

The paper distinguishes five kinds of statement so that observed facts, modeling choices, calculations, and human decisions remain auditable.

| Status | Meaning |
|---|---|
| **Observed business fact** | A fact evidenced by the source process or remittance population. |
| **Model axiom** | A stated accounting interpretation required to read the evidence consistently. |
| **Derived rule** | A consequence calculated from observed facts and axioms. |
| **Invariant** | A condition that must remain true for the reconstruction to be internally valid. |
| **Analyst decision** | A question the remittance alone cannot settle; the required external check is stated rather than guessed. |

English explanations accompany Turkish source labels. Documentary trigger tokens—including `SC`, `SCR`, `IQV`, and `QPD`—remain unchanged because they are evidence, not concepts to be translated.

## 2. From the upstream event to the remittance

### 2.1 Forward business process

**Observed business facts.** Amazon issues a Purchase Order (PO) identified by an 8-character alphanumeric token that begins with a digit and ends with a letter. The vendor accepts the PO in Vendor Central. Under Turkish tax law, the vendor must invoice only goods confirmed as shipped to the designated Fulfillment Center (FC), no later than eight days after delivery. Cancelled or undelivered items must not be invoiced. In practice, undelivered goods may nevertheless be invoiced without notice to Amazon.

The FC initially confirms only that goods entered “Goods Received for Counting and Scanning.” Item-level confirmation of received and missing units follows later. This evidence lag causes the quantity-variance process: Amazon pays against received goods, not merely against invoices, so an unconfirmed portion can be withheld while receipt evidence remains pending.

The official e-invoice follows this path:

```text
vendor → SOVOS → GIS → VPS
```

- SOVOS performs GİB signature and regulatory checks.
- GIS routes the invoice to the correct legal entity and business line, here Retail.
- VPS/FinOps performs commercial validation and tax or legislative classification.
- A failed validation receives a defect category and is parked for analyst action.

**Audit interpretation.** A row that reaches the remittance has passed upstream authenticity, regulatory, commercial, and tax controls. This model does not re-adjudicate invoice authenticity. It tests the arithmetic, documentary references, lifecycle, and settlement effect that those upstream controls do not certify.

Retail payment validation is a three-way match among:

1. PO-confirmed goods;
2. goods received after counting and scanning; and
3. invoiced quantities and prices.

A full match schedules payment on the due date: invoice date plus the vendor’s payment term. Payments are grouped under predefined rules, and contractual deductions—principally CCOGS—are taken at execution.

A partial quantity match creates a **Shortage Claim (SC)** debit and an **SCR (Shortage Claim Reversal)** credit process. The process searches for matching receipt evidence through due date + 60 days. Matched amounts accumulate for the vendor’s payment cycle, typically seven days. Price mismatches produce the parallel **PC/PCR** process for Purchase Price Variance (PPV).

**Observed timing fact.** An SC posts in OFA (Oracle Financial Application) on the parent invoice’s due date, not on an FC event date. Every remittance row represents a transaction that occurred; the file is cross-sectional transaction evidence. Row age and the claim window can therefore be reconstructed from the file.

Upon payment:

- the AP side records Purchase Quantity Variance (PQV: SC/SCR) and Purchase Price Variance (PPV: PC/PCR); and
- the AR side records contractual and commercial deductions such as CCOGS, vendor returns (VRET), advertising deductions, non-invoiced provisions, and Quick Pay Discount (QPD).

### 2.2 Reverse audit reading

The forward process creates documentary rows. The inverse audit reads those rows back into business events, evaluates each event’s lifecycle, assigns the required gross or cash basis, and contributes only the permitted effect to the reconstructed wire.

| Upstream business event | Remittance evidence | Mathematical treatment | Wire contribution | Decision or refusal |
|---|---|---|---|---|
| Matched sale paid on due date | **Toptan Satış Faturası** (wholesale sales invoice), age = term | Gross amount | Gross sale owed | Accept if structural evidence verifies the sale |
| Confirmation lag at due date | `…SC`, net of discount | Claim-round gross netting | Open-chain gross only while legitimately open | Pending, stuck, anomaly, or later closure |
| Late receipt evidence found | `…SCR`, gross | Referential closure and `K1` | Removes a resolved provisional withholding | **RELEASED** lifecycle verdict |
| Receipt evidence never found | `IQV`/`AQV` final invoice | Final conversion and `K2` | Final deduction | **VALIDATED** if conversion matches |
| Price disagreement | `…PC`/`…PCR`, then `IPV`/`APV` | Parallel claim lifecycle | Open gross or final IPV gross | Lifecycle verdict or review |
| Contractual program | CCOGS, VRET, ADD, dispute, or payback row | Final cash effect | Retained/final deduction | Count unless independently unresolved |
| Accrual hygiene | Provision posting and release | Amount-matched residual | Open provision residual only | Analyst selects if carrier is ambiguous |
| Early-payment program | QPD evidence plus **Uygulanan indirim** | Learned-rate discount algebra | `KEEP_QPD` derived from all rows | Reconcile, flag duplicate, or refuse |
| Settlement | **Giden Havale** (outgoing wire) | Actual target | Compared with reconstructed amount | GREEN only if identity and gates pass |

This event-to-evidence-to-math-to-wire-to-decision chain is the organizing rule for every later section.

# Part II — Formal admission, normalization, and classification

## 3. Workbook evidence and admission controls

### 3.1 Stable evidence model

Treat a remittance worksheet as a finite matrix:

```text
M ∈ (V ∪ {∅})^(R×C)
```

Every cell has a unique coordinate `(r,c)`. Stable coordinates make the evidence reproducible in a way that rendered email or PDF text is not: `M[r,c]` has one location and one value.

Fields are located relative to the issuer’s invariant disclaimer sentence `D`, the documentary anchor:

```text
a = (r₀,c₀) = min(row-major){(r,c) : normalize(M[r,c]) contains D}
```

Here, `normalize` is fixed uppercasing with Turkish-aware folding. The header and invoice table are read relative to `a`. The first worksheet is the stated evidence scope. If additional sheets exist, the limitation must be disclosed and the analyst must be directed to place the remittance evidence on the first sheet.

**Narrative checkpoint.** The upstream settlement becomes admissible remittance evidence only after the anchor and section controls succeed. Failed admission contributes nothing to the reconstructed wire; the analyst receives a precise rejection or warning instead.

### 3.2 Admission and degradation rules

| Control | Required behavior |
|---|---|
| **Pre-admission gate** | If `D` is absent from the first `K` rows, read no amount. Reject the file with a bilingual, actionable reason. |
| **Section containment** | If a payment marker is absent for one anchored section, exclude that section and warn with the row number. Other sections remain reviewable. |
| **Header evidence** | Require **Ödeme yapılacak taraf** (payee), **Tedarikçi Numaranız** (vendor number), **Tedarikçi site adı** (vendor site), **Ödeme numarası** (payment number), **Ödeme tarihi** (payment date), **Ödeme para birimi** (currency), and **Ödeme tutarı** (payment amount). |
| **Invoice evidence** | Require **Fatura Numarası** (invoice number), **Fatura Tarihi** (invoice date), **Fatura Açıklaması** (description), **Uygulanan indirim** (applied discount), **Ödenen Tutar** (paid amount), and **Kalan Tutar** (remaining amount). |
| **Positional fallback** | Disclose the coordinate and assumed meaning of every label or layout fallback. No heuristic or excluded section may remain silent. |
| **Money reading** | Read parenthesized paid amounts as debits and bare amounts as credits. Assume comma thousands and dot decimals. Convert an unreadable amount to zero and name it in the completeness control. |
| **Date reading** | Accept `D-MMM-YY(YY)`, a spreadsheet serial in `[20000,80000]`, or a last-resort generic date. Failure is null, never day zero. A claim with an unknown date receives an anomaly state. |

**Invariant—loud degradation.** Every exclusion, heuristic binding, multi-sheet limitation, unreadable field, or positional fallback must name its coordinate, group, or reason in the audit warnings.

## 4. Monetary axioms and structural controls

### 4.1 Money model

For each row `x`:

```text
round2(x) = round(100·x)/100
cash(x)   = credit(x) − debit(x)             (Alacak − Borç)
gross(x)  = cash(x) + ind(x)                 (ind = Uygulanan indirim)
a ≈ b     ⇔ |a − b| ≤ ε,  ε = 0.01
```

**Model Axiom M1—net-of-discount withholding.** Cash columns are net of QPD. A discount clawback appears in `ind(x)` with a negative sign. Therefore, `gross(x)` is the vendor-facing economic value of the row. The tolerance `ε` is one kuruş: a numerical guard, not a business threshold.

**Business interpretation.** The upstream event determines whether cash or gross is economically faithful. The row’s remittance fields provide the inputs; the formulas produce the amount eligible for the reconstructed wire. Choosing the wrong basis can create a false residue even when the business events reconcile.

### 4.2 Age and structural validation

```text
age(x) = days(invoiceDate(x), paymentDate(x))
```

Sales invoices are paid on due date, so sales-row age reveals the contractual payment term. An SC posts on its parent invoice’s due date, so the SC payment date starts the claim window. Large age outliers identify invoices that aged before settlement; the full age column is the aged report. A bimodal age profile flags mixed populations.

The following structural laws are observed:

- **Tedarikçi site adı** has 8 characters in `ORG_CC` form. For example, `ZL7LD_TR` means organization `ZL7LD`, Türkiye. The suffix identifies the regulatory country.
- **Ödeme numarası** is exactly 9 digits. A malformed number invalidates payment grouping and is flagged.
- Reversal numbers must extend an existing document number; this is referential integrity.
- Notification/reversal families must exhibit the M1 claw/give-back pattern.
- Rows with no amount are named and linked to any simultaneous payment-total mismatch.

### 4.3 Independent payment-total control and synthetic transfer

For group `g = (paymentNumber, paymentDate)`, let the declared header amount be `P(g)` and the row-derived net be `N(g)`:

```text
N(g) = Σ{x∈g} cash(x)
CHECK: |P(g) − |N(g)|| ≤ ε
```

The header and table are independent evidence of one payment. Failure means that rows were omitted or misread; the result must identify the group and delta.

For audit presentation, place one **Giden Havale** row `t(g)` on the side opposite the sign of `N(g)`, with magnitude `|N(g)|`, so the group closes:

```text
Σ credit − Σ debit − transfer(g) = 0
```

The transfer is excluded from the independent total check because it is derived from `N(g)`. Including it would make the control circular.

**Narrative checkpoint.** The upstream payment event supplies two independent pieces of remittance evidence: the declared header and the transaction rows. Their mathematical agreement admits a synthetic transfer presentation. That transfer becomes the actual target for the later cashier identity; disagreement requires analyst review before any GREEN decision.

## 5. Classification as an audit ruling

### 5.1 Total, ordered classification

Classification is a total function:

```text
F : Σ* × Σ* × Context → T
F = tᵢ*,  i* = argmin{ρᵢ : πᵢ holds}; otherwise Sınıflandırılmamış
```

It maps invoice number, description, and file context to exactly one type. Inputs are uppercased. Predicates have distinct precedence and first-match semantics. Structural and referential evidence precedes weak prefix evidence. The visible fallback **Sınıflandırılmamış** (unclassified) ensures that no row silently disappears.

**Length ruling.** Sales invoice numbers have at most 16 characters. Claim documents consist of the 16-character root plus a suffix and are normally 18–20 characters. A 16-character number is therefore an invoice, never a notification or reversal, regardless of description.

### 5.2 Recognition table

| Classified type | Documentary trigger |
|---|---|
| **Giden Havale** (outgoing wire) | Synthetic transfer row |
| **Ticari İşbirliği Faturası** (commercial cooperation invoice) | `FLEXIBLEAGREEMENTS` |
| **Eksik Miktar Kesinti Bildirimi** (shortage deduction notice) | Number ends `SC`, or guarded shortage wording |
| **Eksik Miktar Kesinti Bildirimi Ters Kayıt** (shortage reversal) | Number ends `SCR` or `SCRI` |
| **Fiyat Farkı Kesinti Bildirimi** (price-variance deduction notice) | Number ends `PC` or contains `FOR PPV` |
| **Fiyat Farkı Kesinti Bildirimi Ters Kayıt** (price-variance reversal) | Number ends `PCR`/`PCRI` or contains `PRICE CLAIM REVERSAL` |
| **Eksik Miktar Kesinti Faturası** (final shortage invoice) | `IQV` + exactly 13 digits |
| **Arşiv Eksik Miktar Kesinti Faturası** (archive final shortage invoice) | `AQV` + exactly 13 digits |
| **Fiyat Farkı Kesinti Faturası** (final price-variance invoice) | `IPV` + exactly 13 digits |
| **Arşiv Fiyat Farkı Kesinti Faturası** (archive final price-variance invoice) | `APV` + exactly 13 digits |
| **İade Faturası** (return invoice; dispute signature) | `FOR TRANSACTION … V-token … DSPT` |
| **Toptan Satış Faturası** (wholesale sales invoice) | Verified PO path and echo |
| **Ticari İşbirliği Faturası** (cooperation) | `C1`/`C0` plus evidence |
| **İade Edilen Ürünler** (returned products) | `V1`/`V0`, `VRET`, or V-token evidence |
| **Provisions** (two provision types) | `PROVISION_FOR_…` |
| **Bank Ücreti**, **CRTR**, **AR Faturası**, **Amazon İtirazları**, **QPD**, **Payback** | Dedicated description markers |
| **DROPSHIP** | `DROPSHIP-PO` echo |
| **Sınıflandırılmamış** (unclassified) | Total-function fallback |

Each ruling connects documentary evidence to an upstream event class. The class then determines the row’s mathematical basis, its eligibility for the reconstructed wire, and whether the analyst may accept it or must review it.

### 5.3 Verified sales and file-specific series inference

A row is a verified sales invoice only when all three conditions hold:

1. `len(n) ≤ 16`;
2. its description contains `{PO}/{warehouse}/`, where the PO is 8 alphanumerics, digit-first and letter-last, and `warehouse` belongs to the closed warehouse-code set; and
3. the path tail is empty or its first token exactly echoes `n`.

**Observed ruling A1.** This predicate has no known false positives in the source population and is the only evidence strong enough to support learning.

A vendor’s own sales series may begin with `C` or `V`, colliding with weak cooperation or return prefixes. Let `V` be verified sales rows and `V_c` those beginning with character `c`:

```text
own(c) ⇔ |V| ≥ m ∧ |V_c|/|V| ≥ θ
m = 5,  θ = 0.33
```

When `own(c)` is true, bare-prefix cooperation or return rules move from normal precedence 13/14 to last-resort precedence 25/26, immediately before fallback. Evidence-based branches never move. This changes a result only where stronger evidence also matches. The ruling is file-scoped and deterministic; its status must be disclosed with counts or the exact reason it was inactive.

**Self-echo guard.** A cited token equal to the row’s own number is not reference evidence. Reference predicates require `cited ≠ self`.

**Return-dispute ruling.** If the description contains, in order, `FOR TRANSACTION`, then a V-token consisting of `V`, one digit, and 14 alphanumerics, then `DSPT`, classify the row as an **İade Faturası** regardless of its own prefix. This rule has precedence 12.5, above cooperation. The token after `FOR TRANSACTION` is the cited transaction, not the row’s preceding self-echo.

### 5.4 Origin determines balance treatment

| Category | Upstream cause, mathematical treatment, and audit consequence |
|---|---|
| **Giden Havale** | Actual settlement, not an invoice. It is the target that all other rows must reconstruct. |
| **Toptan Satış Faturası** | Legal source of money owed; always contributes gross. Early-payment discount remains in `ind`, not the invoice amount. |
| **SC/SCR; PC/PCR** | Provisional protective withholding and release; not legal invoices. A deduction is net and a release is gross, so amount pairing is prohibited. Use references and lifecycle rounds. |
| **IQV/AQV; IPV/APV** | Final legal conversion outcomes; never net and never reverse. Archive variants differ only by channel. |
| **İade** | Final invoice for returned goods. |
| **Ticari İşbirliği (CCOGS)** | Final negotiated contra-COGS program; debit and credit dispute adjustments both count. |
| **Provisions** | Internal accrual hygiene with no direct vendor-cash meaning. Posting and release have no reference linkage, so amount matching is the available basis; only unreleased residuals matter. |
| **Bank Ücreti** | Pass-through fee, usually self-cancelling; any residual remains visible. |
| **CRTR / AR Faturası / Amazon İtirazları / Payback** | Final postings or dispute adjustments; always balance-impacting. |
| **QPD / QPD Ters Kayıt** | Discount evidence whose economics also reside in affected rows’ `ind` values; governed by Section 7. |
| **Sınıflandırılmamış** | Visible evidence gap requiring extension of the rulebook; never an absorber. |
| **MISSING_ACTUAL_OR_BAN** | Source data-quality marker, not a business event; retained conservatively and never netted away. |

# Part III — Claim lifecycles and discount algebra

## 6. Claim lifecycle: documents, rounds, windows, and states

### 6.1 Claim grammar and root

Quantity and price claims share one policy-regulated lifecycle over referenced documents:

```text
number = B · tail
tail   = ((SC | PC)(R | RI)?)+
```

`B` is the wholesale sales root. `root(x)` removes the longest parseable **mixed** tail because one root may interleave families—for example, `…SCRPCRI`. Family ownership follows the terminal token: `SC*` is PQV and `PC*` is PPV.

### 6.2 The round as the audit unit

One root may contain several independent lifecycles. For family token `τ`:

- deduction `d` ends with `τ`;
- the only valid closure is exactly `d·R` (**RELEASED**) or `d·RI` (**VALIDATED**), with validation prevailing if both exist;
- finals are `IQV`/`IPV` documents paired by reference; and
- rounds are ordered by deduction-number length as tokens are appended.

A round is referential, never amount-matched. M1 makes a valid deduction and release unequal in cash whenever QPD is active.

A final carries `RI|family|seg₁|seg₂`. Pairing uses `seg₁` only. For round 1, `seg₁` is the root. `seg₂` is always the root and must never be used, because doing so would attach later or sibling finals to round 1. If `seg₁` resolves nowhere, a final may attach to the sole validated round still awaiting a final; otherwise, it remains **UNATTACHED — Review Final Invoice**.

**Narrative checkpoint.** The upstream variance event creates a chain of documentary fingerprints. Referential parsing assigns those rows to a round; round mathematics determines whether money was released, validated, or remains open; only legitimate open or final effects may reach the reconstructed wire. Ambiguous attachment ends in review, not inference.

### 6.3 Round arithmetic and policy window

For round `r`, where `C(r)` contains its deduction and closure rows:

```text
net(r)  = Σ{x∈C(r)} cash(x)
disc(r) = Σ{x∈C(r)} ind(x)
res(r)  = round2(net(r) + disc(r))                 [gross netting]
K1(r)   : |res(r)| ≤ ε                            [knock-out]

G(r)    = −Σ{deduction rows of r} gross(x)         [confirmed variance]
ipv(r)  = Σ(debit − credit) over paired finals,
          grouped by document number               [installments allowed]
K2(r)   : |ipv(r) − G(r)| ≤ ε                     [conversion match]

due(r)  = payment date of r’s own deduction
H       = maximum parseable payment date in the file
e(r)    = days(due(r), H)
L       = 63 = due date + 60-day policy + 72-hour document lag
```

Each round uses its own deduction date, never the first round’s date. The historical predecessor to `L` was invoice date + 33 days.

### 6.4 Lifecycle verdicts

The first matching case controls.

| Documentary shape | Mathematical test | Verdict and business/audit meaning |
|---|---|---|
| VALIDATED with finals | `K1 ∧ K2` | **Reconciled with Invoice**—closed |
| VALIDATED with finals | `K1 ∧ ipv < G−ε` | **Partially Deducted — Pending** |
| VALIDATED with finals | otherwise | **Reconciled with Slips**—review |
| VALIDATED, no finals | `K1` | **Reconciled — Pending Invoice Creation** |
| VALIDATED, no finals | `¬K1` | **Anomaly — Check** |
| RELEASED | finals present | **Reconciled with Slips**—released money re-invoiced creates over-deduction risk |
| RELEASED | `K1`, no finals | **Reconciled with Matching**—closed |
| RELEASED | `¬K1`, no finals | **Anomaly — Check** |
| OPEN, no closure | finals present | **Anomaly — Check** |
| OPEN, no closure | `e ≤ L` | **Pending Matching — Review** |
| OPEN, no closure | `e > L` | **Pending Invoice Cancelation / Stuck — Review**—dispute |
| OPEN, no closure | dates unparseable | **Anomaly — Check** |
| Orphan closure | `cash > ε` | **Excess Credit — Review** |
| Orphan closure | otherwise | **Reconciled without Shortage/Price Claim**—cross-period or stuck |

Root-level `K1` remains a cross-check. If round accounting and root-level gross netting disagree, the result is **Anomaly — Check**, never a confident closure.

### 6.5 Business scenarios and required analyst actions

| Scenario | Upstream event and evidence | Mathematical/wire treatment | Analyst decision |
|---|---|---|---|
| **S1—Open inside window (`e ≤ L`)** | Matching evidence is still pending. | Amount remains in suspense and enters as a legitimate open-chain contribution; it is not established loss, although the vendor ledger shows it as overdue. | Inform the vendor that matching remains in progress. |
| **S2—Open beyond window (`e > L`) without an official document** | The claim aged without release or final conversion. Known causes include a vendor balance below the remittance trigger while the claim aged in OFA; one-sided cancellation in SC state, contrary to the requirement that a transacted invoice receive either a final invoice or a reversal; or another unprocessed condition. | Treat as a stuck open chain under the defined state, not as a resolved claim. | Mandatory analyst action; this is a dispute condition. |
| **S3—Converted** | Final `IQV`/`IPV` exists. | `K1 ∧ K2` proves a lawful confirmed variance, including the population in which invoiced goods never arrived. | Accept as converted. |
| **S4—Closure without deduction in the file** | The remittance contains an orphan closure. | A root-level knock-out needs no attention. A positive payout is **Excess Credit**. | Search prior periods for the deduction. If found, treat as a legitimate cross-period release. If absent, track the excess because a future clawback is expected and must not be mistaken for a new withholding. |
| **S5—QPD-active round** | Deduction is net and release is gross. | Apply QPD algebra; cash-only comparison is invalid. | Accept only under the discount controls in Section 7. |

### 6.6 Worked example: FKF multi-round chain

Root `FKF2025000000378` contains three PPV rounds in one file:

```text
Round 1: …PC (3,977.51) → …PCRI → IPV2025000002975 (3,977.51)
         K1 ∧ K2; validated and converted; closed.

Round 2: …SCRPC (4,896.16) → …SCRPCRI → IPV2025000003603 (4,896.16)
         Closed. RI|PPV|…SCR|… names round 2 through seg₁.

Round 3: …SCRSCRPC (1,745.23)
         Required closure: …SCRSCRPCR or …SCRSCRPCRI, plus a third IPV
         naming …SCRSCR. Neither exists; rounds 1–2 already consume both
         PCRI reversals. At day 77 > L, round 3 is OPEN and Stuck (S2).
```

A root-level view can point to a correct IPV while hiding the open `1,745.23`. Round segmentation preserves the event trail and prevents a converted round from concealing an independent open deduction. The open third round—not either closed predecessor—is the amount and state relevant to the wire reconstruction and analyst worklist.

## 7. QPD discount algebra

### 7.1 QPD as a learned-rate overlay

QPD does not remain within rows labelled QPD. Its economics appear in `ind(x)` on affected invoices and alter all claim-pair arithmetic. Deductions withhold net of discount; reversals return gross.

For wholesale root `B`, face value `F = gross(B)`, and first claim gross magnitude `G₁`, learn the contractual rate from the file; never hardcode it:

```text
r = ind(B) / F
q₁ = r × G₁ = −ind(SC₁)
reversal₁ = G₁                   [gross; ind = 0]
rounds k ≥ 2: ind = 0 and cash = gross
```

Round 1 claws back the discount attributable to shorted goods; its reversal restores the gross amount. Later rounds are discount-free.

**Narrative checkpoint.** The upstream early-payment program leaves evidence both in QPD documents and in affected rows’ `ind` fields. Learned-rate algebra prevents double counting, derives the proper contribution to the reconstructed wire, and refuses a confident settlement when the independent QPD evidence disagrees.

### 7.2 Worked example: AND2026000010288 at 5.00%

```text
root: cash +168,771.11; ind +8,882.69 → F = +177,653.80           ✓
SC:   cash −129,261.69; ind −6,803.25 → −G₁ = −136,064.94         ✓
r = 8,882.69 / 177,653.80 = 5.00%
q₁ = 5.00% × 136,064.94 = 6,803.25 = −ind(SC)                     ✓
reversal₁ = 136,064.94 gross                                      ✓
K1: grossNet(B) = +6,803.25 − 6,803.25 = 0                        ✓
K2: iqv(B) = 15,100.34 = G(d_last)                                ✓

F − G₁ = 177,653.80 − 136,064.94 = 41,588.86      [paid portion]
QPDdoc(B) = Σ ind over {root ∪ C(B)}
          = 8,882.69 − 6,803.25 = 2,079.44
          = 5.00% × 41,588.86                                      ✓
CASH(B) = F − iqv(B) − QPDdoc(B)
        = 177,653.80 − 15,100.34 − 2,079.44
        = 160,474.02                                                ✓
```

The vendor’s cash equals face value less confirmed shortage and the discount retained on the portion actually paid. Every term, including the rate, comes from the remittance evidence.

### 7.3 QPD settlement verdicts

```text
legit(B)  = Σ ind over B’s family rows
            [root + claim rows; reversals carry 0]
qpdNet(B) = Σ(debit − credit) over B’s debit QPD documents,
            grouped by the parent reference and reduced to chain root
```

| Evidence and test | Verdict |
|---|---|
| `|qpdNet − legit| ≤ ε` | **QPD Deduction Reconciled with Invoice**—closed |
| More than one distinct document number for one deduction | **Duplicate QPD — Review**; overrides numerical verification. Installments under one number are legitimate. |
| Family is present but totals disagree | **Anomaly — Check** |
| Sales root is absent | **Review Final Invoice**; partial `Σ ind` must not create a false mismatch. |

Credit-side QPD entries are manual clearing noise. They create neither chains nor attention, but remain in the QPD conservation total.

**Analyst decision—pending settlement candidates.** A wholesale family with `legit(B) > ε` and no debit QPD document in the file is a candidate—not proof—of “deducted but not invoiced.” Aggregate all candidates into one work item and verify each invoice’s sales-reference codes in FinOps.

# Part IV — Reconstructing and testing the wire

## 8. The cashier/wire identity

The cashier identity converts reconstructed business effects into the amount that should have been wired, then compares that amount with **Giden Havale**. It is the audit spine joining classification, lifecycle, discount, and settlement.

### 8.1 Layer 1: type aggregation and conservation

Per currency and type `t`:

```text
Fark(t) = Σ credit − Σ debit
```

**Theorem T1—Fark conservation.**

```text
Σ_t Fark(t) = Σ cash over the currency population
```

Both sides sum every row exactly once under a total, disjoint classification. Failure invalidates the reconstruction. The aggregation also reports the trading period as the minimum and maximum parseable invoice date over sales rows only. Type totals show **how much** effect exists; lifecycle rounds show **which invoices** carry it.

### 8.2 Layer 2: reconstructed wire

Per currency, only the following components are permitted:

| Component | Formula and basis | Business interpretation |
|---|---|---|
| `SALES` | `Σ gross` over sales and dropship rows—gross | Legal source of trade money owed |
| `DEDUCTION_t` | `Σ cash` for each final-deduction type—cash | Final deduction effect |
| `DEDUCTION_IPV` | Exception: `Σ gross` over IPV rows—gross | Final price-variance effect on its required basis |
| `OPEN_PROVISION` | `Σ cash` over open provision carriers—cash | Unreleased accrual residual |
| `OPEN_SC_SCR` | `Σ gross` over SC/SCR rows belonging to open chains—gross | Legitimate unresolved PQV withholding |
| `OPEN_PC_PCR` | `Σ gross` over PC/PCR rows belonging to open chains—gross | Legitimate unresolved PPV withholding |
| `KEEP_QPD` | `−Σ ind` over all rows in the currency—derived; invoiced QPD cash is excluded because QPD documents can be created manually | Discount retained across the population |
| `KEEP_t` | `Σ cash` for other retained types | Other permitted final effects |
| `UNRESOLVED_t` | `Σ cash`, explicitly annotated as conservative inclusion | Visible unresolved evidence, never silently absorbed |

```text
Computed = Σ components
Actual   = Σ(debit − credit) over Giden Havale rows
Diff     = Computed − Actual

QPD-mismatch ⇔ |Σ debit over QPD rows − Σ ind(all rows)| > ε
GATE = GREEN ⇔ |Diff| ≤ ε ∧ ¬QPD-mismatch
```

A QPD mismatch forces RED even when `Diff = 0`, because the derived discount can balance the identity while manually creatable QPD documents disagree.

Only **Pending Matching** and **Stuck** chains are open-chain contributions. Problem states—**Anomaly**, **Reconciled with Slips**, **Excess Credit**, and **Review Final Invoice**—do not enter as resolved effects. Their money remains an unresolved residue instead of being absorbed into a false balance.

**Narrative checkpoint.** Every admitted row now has a business origin, documentary class, and required mathematical basis. Permitted effects contribute to `Computed`; the remittance’s settlement evidence supplies `Actual`. Equality plus the independent QPD gate permits GREEN. Any other outcome produces RED, a named residue, or a review/refusal state.

### 8.3 Open-claw lemma: why open claims contribute gross

**Lemma L1.** If open claim rows enter at cash instead of gross:

```text
Diff_cash − Diff_gross = −Σ ind over open claim rows
```

An open deduction withholds cash net of the QPD claw, while `KEEP_QPD = −Σ ind(all)` already includes that claw. Cash basis therefore understates the withholding by the same amount. Gross basis restores it and makes the two effects cancel.

**Observed confirmation.** Two open rounds carried claws of `549.01` and `617.63`. Cash basis produced a permanent RED difference of `1,166.64`; gross basis closed the difference to zero. Gross is also the vendor-facing exposure and equals the open chains’ **Kalıntı (Brüt)** (gross residual) total.

### 8.4 Worked example: a GREEN file

```text
Toptan Satış (sales, gross)                  +118,375,252.78
Ticari İşbirliği (CCOGS)                     −18,129,139.81
İade Faturası (vendor returns)                −8,758,891.54
Fiyat Farkı Kesinti Faturası (IPV)               −28,224.94
Eksik Miktar Kesinti Faturası (IQV)           −4,451,814.63
AR Faturası                                     −401,475.39
Aged provision residual                          −66,619.80
──────────────────────────────────────────────────────────
Computed havale                               86,539,086.67
Actual Giden Havale                           86,539,086.67
Difference                                             0.00 → GREEN
```

Each line is a classified upstream effect on its required cash or gross basis. Together, they explain the outgoing wire to one kuruş.

### 8.5 Layer 3: ledger closure

The vendor ledger admits all target, included, kept, and unresolved rows, plus only the following offset:

```text
offset = salesDiscount + ipvDiscount
       + openScScrDiscount + openPcPcrDiscount
       + (−Σ ind(all)) − cash(QPD rows)
```

**Theorem T2—ledger closure.**

```text
GREEN ⇒ Σ(Borç − Alacak) over the ledger ≈ offset
```

Failure of this implication invalidates the claimed GREEN result. A balanced cashier identity is not sufficient if the admitted ledger rows fail this independent closure.

# Part V — Invariants, refusal boundaries, and conclusion

## 9. Audit invariants

| ID | Invariant |
|---|---|
| **I1 Determinism** | Every classification, derivation, and verdict is a pure function of the admitted workbook evidence. |
| **I2 Conservation** | No owned row vanishes. Each row belongs to exactly one chain; chain nets reproduce raw type totals; unpairable documents become flagged chains. |
| **I3 Row uniqueness** | No record is counted twice across the wire identity, open-item population, or ledger. |
| **I4 Explained or flagged** | Every row ends closed, open within its policy window, or in a named review/anomaly state. **Sınıflandırılmamış** is a flag, not an absorber. |
| **I5 Loud degradation** | Every lossy or heuristic evidence step names its coordinate, group, or reason. |

These invariants hold independently of whether the final gate is GREEN or RED. A numerically balancing file is not auditable if it violates conservation, uniqueness, classification visibility, or QPD consistency.

## 10. Refusal boundaries and analyst decisions

| Boundary | What the remittance cannot establish | Required decision or refusal |
|---|---|---|
| **B1 Cross-period evidence** | Whether an orphan closure’s deduction or an unattached final’s chain exists in an earlier remittance | Return a review state that names the prior-period search; never guess. |
| **B2 Pending QPD settlement** | Whether an absent QPD document was never issued | Produce a candidate population for FinOps verification. |
| **B3 Ambiguous provision carrier** | Which tied row carries a family residual | List every candidate; the analyst selects. |
| **B4 Manually creatable QPD record** | Whether invoiced QPD cash is authoritative | Exclude it from the identity; any disagreement forces RED. |

Refusal is a correct audit output. A deterministic reconstruction must not state a confident fact whose truth depends on evidence outside the file.

## 11. Recorded constants and rulings

| Symbol or value | Ruling |
|---|---|
| `ε = 0.01` | One kuruş; numerical tolerance, not a business value |
| `L = 63` | Due date + 60-day policy + 72-hour document-creation lag; historical predecessor: invoice date + 33 |
| `θ = 0.33` | Vendor-series ownership share among verified sales |
| `m = 5` | Minimum verified-sales sample for series inference |
| `16` | Sales invoice number ceiling; claim numbers are normally 18–20 |
| `8` | PO token length, digit-first and letter-last |
| `8` | Vendor-site length in `ORG_CC` form |
| `9` | Payment-number digit count |

Each constant is a separately reviewable business ruling. Changing one requires an explicit one-number policy decision.

## 12. End-to-end audit conclusion

```text
PO issued → accepted → goods shipped → FC counting and evidence lag
→ e-invoice → SOVOS → GIS → VPS → three-way match
→ matched portion paid on due date / variance withheld
→ SCR or PCR seeks evidence → release or final conversion
→ OFA settlement → REMITTANCE EVIDENCE

REMITTANCE EVIDENCE
→ admission and anchor controls → money/date normalization
→ independent payment-total check → total classification
→ referenced rounds and lifecycle verdicts → QPD overlay
→ cashier/wire identity → ledger closure

GREEN → actual wire explained to one kuruş; closed chains form the audit trail
RED   → exact unexplained residue or independent control failure is named
ALWAYS → analyst worklist identifies open items, days in window,
         excess credits, anomalies, cross-period questions, and refusals
```

The inverse function is therefore complete and auditable:

1. **Upstream business event:** establish the process event that could have generated the row.
2. **Remittance evidence:** admit, locate, normalize, and classify its documentary fingerprint.
3. **Mathematical treatment:** apply the event’s required cash or gross basis, referential lifecycle, policy window, and discount algebra.
4. **Contribution to the reconstructed wire:** include only permitted final, retained, or legitimately open effects; preserve unresolved money as visible residue.
5. **Analyst decision or refusal:** return GREEN only when the wire identity and independent gates pass; otherwise name RED, the lifecycle state, the failed control, or the external evidence required.

Observed evidence is thus traced back to business cause, translated into accounting effect, carried into the reconstructed wire, and resolved as a controlled verdict or a precise analyst action.