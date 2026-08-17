import { DataSanitizer } from '../dataSanitizer';
import { AMOUNT_MATCH_TOLERANCE, findOpenItems, rowNet } from '../../matchers/openItemFinder';
import { claimChainRoot } from './claimGrammar';
import type { PaymentRecord, InvoiceCategory } from '../../../types/regional.types';
import type { OperationResult, OperationChain } from './operations.types';

/**
 * QPD OPERATIONS — quick-pay-discount verification (referential model).
 *
 * BUSINESS PROCESS: QPD is a CONTRACT discount — Amazon deducts the
 * agreed % from a WHOLESALE invoice's total on its payment day; the
 * deducted amount is recorded in "Uygulanan indirim" and the cash column
 * is NET of it (gross = cash + indirim). QPD applies ONLY to wholesale
 * (Toptan Satış) invoices — no other type carries the contract.
 *
 * Claim rounds interact with the discount: an SC claws back the discount
 * share of shorted goods (negative indirim on the SC row) and the SCR
 * returns GROSS — the clawed discount comes back in cash. So the
 * discount Amazon is ENTITLED to keep for invoice B is:
 *
 *   legitQpd(B) = Σ Uygulanan indirim over B's family
 *                 (sales row + all claim rows; reversals carry 0)
 *
 * Worked example AND2024080032793:
 *   sales ind +4,749.12; SC ind −203.62; SCR ind 0
 *   legitQpd = 4,545.50 — the amount the QPD document must settle.
 *
 * INVESTIGATION UNIVERSE — DEBIT ENTRIES ONLY (analyst ruling): a QPD
 * INVOICE is always a debt entry. Credit QPD entries are NOISE — manual
 * postings with a variety of reasons (offsetting a wrong QPD before
 * reissuing, "Dummy_…" clearing rows, …) — and must NEVER generate
 * chains or attention. They still participate in the domain's raw
 * netEffect (conservation ties back to type totals), but the
 * verification logic sees only the debit side.
 *
 * THE QPD DOCUMENT is referential: its description names the parent
 * ("QPD Return Invoice for Original Invoice : {B}" /
 *  "Creating QPD for parent invoice {B}"). A suffixed reference
 * (…SC/…SCR) is stripped to its chain root so the parent is always the
 * sales invoice. Verification per parent, over DEBIT docs only:
 *
 *   qpdNet(B)   = Σ (Borç − Alacak) over B's debit QPD rows
 *   VERIFIED    |qpdNet(B) − legitQpd(B)| ≤ ε    → closed
 *   MISMATCH    otherwise, family in file         → Anomaly - Check
 *   CROSS-PERIOD sales root not in this file      → Review Final Invoice
 *                (partial family — verification impossible; a partial
 *                 Σ indirim must never produce a false mismatch)
 *
 * Debit QPD rows WITHOUT a parseable parent reference fall back to
 * amount netting (the pre-referential rule): unmatched rows are 'Açık'
 * open items with balance impact.
 *
 * PENDING-SETTLEMENT CANDIDATES — THE MAIN GOAL: wholesale families
 * with applied discount (Uygulanan indirim > 0) and NO debit QPD
 * document in this file are CANDIDATES for "deducted but not invoiced".
 * A single remittance cannot prove the negative — the settlement may
 * exist outside this file — so the model does not assert it: the
 * population is aggregated into ONE attention chain (state
 * 'Reconciled - Pending Invoice Creation') whose document trail lists
 * EVERY affected invoice with its discount amount, and the ANALYST
 * verifies each against its sales invoice reference codes in FinOps.
 */
export const QPD_OWNED_TYPES: readonly InvoiceCategory[] = ['QPD'];

/** Currency tolerance ε — shared with amount-based open-item matching. */
export const QPD_TOLERANCE = AMOUNT_MATCH_TOLERANCE;

/**
 * Parent reference inside a QPD document description (uppercased, İ→I):
 *   "… FOR ORIGINAL INVOICE : AN12024000000065"
 *   "… FOR PARENT INVOICE #AN12024000000065"
 *   "QPD KESINTI FATURASI AN12024000000065"
 * Separators tolerated around the reference: ':', '#', spaces.
 */
export const QPD_PARENT_PATTERNS: readonly RegExp[] = [
  /(?:ORIGINAL|PARENT)\s+INVOICE\s*[:#\s]*([A-Z][A-Z0-9]{5,})/,
  /QPD\s+KESINTI\s+FATURASI\s*[:#\s]*([A-Z][A-Z0-9]{5,})/,
];

const SALES_TYPE: InvoiceCategory = 'Toptan Satis Faturasi';

const round2 = DataSanitizer.roundAmount;
const fmt = DataSanitizer.formatNumber;

/**
 * Extracts the parent wholesale invoice from a QPD description, or null.
 * Tries every known description shape; a suffixed reference
 * (…SC/…SCR/…SCRI, PC family alike) is stripped to its chain ROOT —
 * source data shows QPD descriptions occasionally name a claim document
 * instead of the sales invoice itself.
 */
export function qpdParentRef(description: string): string | null {
  const folded = description.toUpperCase().replace(/İ/g, 'I');
  for (const pattern of QPD_PARENT_PATTERNS) {
    const match = folded.match(pattern);
    if (match) return claimChainRoot(match[1]) ?? match[1];
  }
  return null;
}

/** Discount ledger of one wholesale invoice family. */
interface FamilyDiscount {
  /** Σ Uygulanan indirim over the family rows present in this file. */
  legit: number;
  /** Whether the sales ROOT row itself is in this file (full family). */
  hasSalesRoot: boolean;
}

export function runQpdOperations(records: PaymentRecord[]): OperationResult {
  const owned = records.filter(r => QPD_OWNED_TYPES.includes(r.invoiceType));
  const chains: OperationChain[] = [];

  // ---- Family discount ledger: parent root → Σ indirim over its rows ----
  // (sales row keys on its own number; claim rows key on their chain root)
  const familyByParent = new Map<string, FamilyDiscount>();
  records.forEach(row => {
    if (QPD_OWNED_TYPES.includes(row.invoiceType)) return; // QPD docs are the other side
    const inv = row.invoiceNumber.toUpperCase();
    const root = claimChainRoot(inv) ?? inv;
    if (!familyByParent.has(root)) {
      familyByParent.set(root, { legit: 0, hasSalesRoot: false });
    }
    const family = familyByParent.get(root)!;
    family.legit = round2(family.legit + row.discount);
    if (inv === root && row.invoiceType === SALES_TYPE) family.hasSalesRoot = true;
  });

  // ---- Investigation universe: DEBIT entries only (credits = noise) ----
  const debitDocs = owned.filter(r => round2(r.debit - r.credit) > QPD_TOLERANCE);

  // ---- Group debit QPD documents by parent reference ----
  const docsByParent = new Map<string, PaymentRecord[]>();
  const unreferenced: PaymentRecord[] = [];
  debitDocs.forEach(row => {
    const parent = qpdParentRef(row.description);
    if (parent === null) {
      unreferenced.push(row);
    } else {
      if (!docsByParent.has(parent)) docsByParent.set(parent, []);
      docsByParent.get(parent)!.push(row);
    }
  });

  // ---- Referential verification, parent by parent ----
  docsByParent.forEach((docRows, parent) => {
    const qpdNet = round2(docRows.reduce((sum, record) => sum + record.debit - record.credit, 0));
    const family = familyByParent.get(parent);
    const verifiable = family !== undefined && family.hasSalesRoot;
    const net = round2(docRows.reduce((sum, record) => sum + record.credit - record.debit, 0));
    const documentTrail = docRows.map(
      r => `${r.invoiceNumber} (Ödeme No: ${r.paymentNumber})`,
    );
    const base = {
      reference: parent,
      rows: docRows,
      net,
      discount: verifiable ? family.legit : 0,
      actionInvoice: docRows[docRows.length - 1].invoiceNumber,
      invoiceDate: docRows[0].invoiceDate,
      documentTrail,
      finalDocNet: qpdNet,
      rounds: docRows.length,
    };

    // DUPLICATE RULE (analyst ruling): one deduction must carry ONE QPD
    // invoice. Multiple rows under the SAME document number are
    // installments (legitimate — mirrors the IQV partial-deduction rule);
    // multiple DISTINCT document numbers are duplicate issuance and win
    // over verification even when the totals coincide.
    const uniqueDocs = [...new Set(docRows.map(r => r.invoiceNumber.toUpperCase()))];
    if (uniqueDocs.length > 1) {
      const overDeduction = verifiable ? round2(qpdNet - family.legit) : qpdNet;
      chains.push({
        ...base,
        rounds: uniqueDocs.length, // 'Tur Sayısı' = how many QPD invoices issued
        state: 'Duplicate QPD - Review',
        residual: verifiable ? round2(family.legit - qpdNet) : round2(-qpdNet),
        attention: true,
        narrative:
          `DUPLICATE QPD issuance for ${parent}: ${uniqueDocs.length} distinct QPD invoices ` +
          `(${uniqueDocs.join(', ')}) charged against ONE deduction — total ${fmt(qpdNet)}` +
          (verifiable
            ? ` vs legitimate discount ${fmt(family.legit)}; over-deduction ${fmt(overDeduction)}`
            : ' (sales root not in this file — compute the legitimate discount from prior remittances)') +
          '. One deduction must carry ONE QPD invoice; review and claim the excess back.',
      });
      return;
    }

    if (verifiable) {
      const residual = round2(family.legit - qpdNet);
      if (Math.abs(residual) <= QPD_TOLERANCE) {
        // VERIFIED: the QPD document equals the legitimate discount.
        // Dedicated QPD state (analyst ruling 2026-08): distinguishes a
        // verified settlement from PQV/PPV matching releases on the sheet.
        chains.push({
          ...base,
          state: 'QPD Deduction Reconciled with Invoice',
          residual: 0,
          attention: false,
          narrative:
            `QPD verified for ${parent}: document ${fmt(qpdNet)} equals the legitimate discount ` +
            `Σ(Uygulanan indirim) over the invoice family (${fmt(family.legit)}) — contract % applied at ` +
            'payment day, claim-round clawbacks accounted. Closed, no action.',
        });
      } else {
        chains.push({
          ...base,
          state: 'Anomaly - Check',
          residual,
          attention: true,
          narrative:
            `QPD MISMATCH for ${parent}: document ${fmt(qpdNet)} vs legitimate discount ${fmt(family.legit)} ` +
            `(difference ${fmt(residual)}) — the settlement does not equal Σ(Uygulanan indirim) over the ` +
            'family; review the contract %, the claim clawbacks and the document amount.',
        });
      }
    } else {
      // Sales root not in this remittance — cross-period document; a
      // partial family Σ indirim must never produce a false mismatch.
      chains.push({
        ...base,
        state: 'Review Final Invoice',
        residual: round2(net),
        attention: true,
        narrative:
          `QPD document ${fmt(qpdNet)} references ${parent}, whose sales invoice is not in this file — ` +
          'the discount family lives in an earlier remittance period; verify against prior remittances.',
      });
    }
  });

  // ---- Fallback: QPD rows without a parent reference (pre-referential rule) ----
  findOpenItems(unreferenced).forEach(row => {
    const net = rowNet(row);
    chains.push({
      reference: row.invoiceNumber.toUpperCase(),
      rows: [row],
      state: 'Açık',
      net,
      discount: round2(row.discount),
      residual: round2(net + row.discount),
      narrative:
        `QPD ${fmt(net)} carries NO parent-invoice reference and no amount counterpart — ` +
        'open quick-pay-discount item; identify its parent invoice manually.',
      actionInvoice: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      attention: true,
      documentTrail: [`${row.invoiceNumber} (Ödeme No: ${row.paymentNumber})`],
    });
  });

  // ---- THE MAIN GOAL — "should be invoiced": wholesale families with
  //      Uygulanan indirim > 0 and NO debit QPD document in this file.
  //      QPD was deducted from the payment but never invoiced — the
  //      vendor's problem population, listed invoice by invoice in the
  //      document trail so each case is auditable.
  const pendingParents: string[] = [];
  let pendingTotal = 0;
  familyByParent.forEach(({ legit, hasSalesRoot }, parent) => {
    if (!hasSalesRoot) return; // QPD is a wholesale contract — sales root required
    if (legit <= QPD_TOLERANCE) return; // main goal: applied discount > 0 only
    if (docsByParent.has(parent)) return; // settled/verified above
    pendingTotal = round2(pendingTotal + legit);
    pendingParents.push(`${parent} (indirim ${fmt(legit)})`);
  });
  if (pendingParents.length > 0) {
    chains.push({
      reference: 'QPD Deducted Check Reversal (PENDING SETTLEMENT)',
      rows: [],
      state: 'Reconciled - Pending Invoice Creation',
      net: 0,
      discount: pendingTotal,
      residual: 0,
      narrative:
        `${pendingParents.length} wholesale invoice family(ies) carry ${fmt(pendingTotal)} of applied discount ` +
        '(Uygulanan indirim) with NO QPD settlement document in this file. ANALYST TASK: verify each ' +
        'listed invoice against its sales invoice reference codes in FinOps before treating the amount as ' +
        'uninvoiced — a settlement may exist outside this remittance. Unconfirmed cases are expected to be ' +
        'invoiced in following remittances (observed lag: months); each affected invoice is listed in ' +
        'Zincir Belgeleri.',
      actionInvoice: 'QPD Deducted Check Reversal',
      attention: true,
      documentTrail: pendingParents,
    });
  }

  // Deterministic output: attention first, then by reference.
  chains.sort((a, b) =>
    a.attention === b.attention ? a.reference.localeCompare(b.reference) : a.attention ? -1 : 1,
  );

  // Conservation: net effect over ALL owned rows.
  const netEffect = round2(owned.reduce((sum, record) => sum + record.credit - record.debit, 0));

  return { domain: 'QPD', ownedTypes: QPD_OWNED_TYPES, chains, netEffect };
}
