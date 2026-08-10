import type { PaymentRecord } from '../../../types/regional.types';

/**
 * CLAIM ROUND SEGMENTATION — shared by the PQV and PPV operations.
 *
 * FINDING (FKF2025000000378 chain): one root can carry SEVERAL
 * independent claim lifecycles — e.g. round 1 `…PC→…PCRI→IPV`, round 2
 * `…SCRPC→…SCRPCRI→IPV`, round 3 `…SCRSCRPC` still OPEN. Evaluating the
 * whole chain at once (Σ all final docs vs gross of ONLY the last
 * deduction) misdiagnoses every multi-round chain and — worse — the
 * `hasFinal` branch swallows open deductions, so an unclosed round can
 * never reach the window states ('Pending Matching' / 'Stuck').
 *
 * THE ROUND MODEL (strictly referential, no amount guessing):
 *   deduction  d   — document number ending with the family token
 *                    (`SC` or `PC`)
 *   closure of d   — the document whose number is EXACTLY d+'R'
 *                    (release) or d+'RI' (validation); nothing else can
 *                    close d
 *   final doc of d — the IQV/IPV whose structured pipe reference names
 *                    d's PREDECESSOR document (segment + token = d)
 *
 * Everything that cannot be paired stays visible: orphan closures,
 * unattached final documents and unshaped claim numbers are returned
 * separately so the owning module flags them instead of losing them —
 * conservation: no owned row may vanish.
 */

export type ClaimToken = 'SC' | 'PC';

/** How a round's deduction was closed, when it was. */
export type RoundClosure = 'RELEASED' | 'VALIDATED' | null;

/** One claim lifecycle: a deduction document with its closure and finals. */
export interface ClaimRound {
  /** 1-based round position (by deduction number length = chain order). */
  ordinal: number;
  /** The deduction document number (…SC / …PC). */
  deductionNumber: string;
  /** All rows of the deduction document (installment slices share a number). */
  deductionRows: PaymentRecord[];
  /** Rows of d+'R' and/or d+'RI' — empty when the round is OPEN. */
  closureRows: PaymentRecord[];
  /** VALIDATED when d+'RI' exists (wins over a coexisting d+'R'). */
  closure: RoundClosure;
  /** Final IQV/IPV rows paired to this round via the pipe reference. */
  finalRows: PaymentRecord[];
}

/** One document that could not join any round (kept for flagging). */
export interface UnpairedDoc {
  number: string;
  rows: PaymentRecord[];
}

export interface RoundSegmentation {
  rounds: ClaimRound[];
  /** Closure documents (…R / …RI) with no deduction in this file. */
  orphanClosures: UnpairedDoc[];
  /** Claim documents whose number is neither deduction- nor closure-shaped. */
  unshapedDocs: UnpairedDoc[];
  /** Final documents that could not be paired to any round. */
  unattachedFinals: PaymentRecord[];
}

/**
 * Segments a chain's claim rows into rounds and distributes the final
 * documents to the round each one converts.
 *
 * Final-doc pairing order:
 *   1. REFERENTIAL — pipe segment + token = a round's deduction number
 *      (both segments tried; the reference names the predecessor doc);
 *   2. SOLE-VALIDATED fallback — exactly one RI-validated round without
 *      finals yet takes the document;
 *   3. otherwise UNATTACHED (the module emits 'Review Final Invoice').
 */
export function segmentRounds(
  claimRows: PaymentRecord[],
  finalRows: PaymentRecord[],
  token: ClaimToken,
  finalDocRefPattern: RegExp,
): RoundSegmentation {
  // Group claim rows by exact document number (installments share one).
  const docs = new Map<string, PaymentRecord[]>();
  claimRows.forEach(row => {
    const num = row.invoiceNumber.toUpperCase();
    if (!docs.has(num)) docs.set(num, []);
    docs.get(num)!.push(row);
  });

  const deductionNumbers: string[] = [];
  const closureNumbers = new Set<string>();
  const unshapedDocs: UnpairedDoc[] = [];

  docs.forEach((rows, num) => {
    if (num.endsWith(token)) {
      deductionNumbers.push(num);
    } else if (num.endsWith(`${token}R`) || num.endsWith(`${token}RI`)) {
      closureNumbers.add(num);
    } else {
      // Claim-typed row whose number carries no recognizable terminal
      // token — referentially anomalous; the module must flag it.
      unshapedDocs.push({ number: num, rows });
    }
  });

  // Chain order: each round appends tokens, so length = position.
  deductionNumbers.sort((a, b) => a.length - b.length || a.localeCompare(b));

  const consumedClosures = new Set<string>();
  const rounds: ClaimRound[] = deductionNumbers.map((deductionNumber, index) => {
    const releaseNum = `${deductionNumber}R`;
    const validationNum = `${deductionNumber}RI`;
    const closureRows: PaymentRecord[] = [];
    let closure: RoundClosure = null;

    if (closureNumbers.has(releaseNum)) {
      closureRows.push(...docs.get(releaseNum)!);
      consumedClosures.add(releaseNum);
      closure = 'RELEASED';
    }
    if (closureNumbers.has(validationNum)) {
      closureRows.push(...docs.get(validationNum)!);
      consumedClosures.add(validationNum);
      closure = 'VALIDATED'; // validation wins when both exist
    }

    return {
      ordinal: index + 1,
      deductionNumber,
      deductionRows: docs.get(deductionNumber)!,
      closureRows,
      closure,
      finalRows: [],
    };
  });

  const orphanClosures: UnpairedDoc[] = [...closureNumbers]
    .filter(num => !consumedClosures.has(num))
    .sort()
    .map(num => ({ number: num, rows: docs.get(num)! }));

  // ---- Final-document distribution ----
  const roundByDeduction = new Map(rounds.map(round => [round.deductionNumber, round]));
  const unattachedFinals: PaymentRecord[] = [];

  finalRows.forEach(row => {
    const match = row.description.toUpperCase().match(finalDocRefPattern);

    // 1. Referential: ONLY the FIRST pipe segment names the round's
    //    predecessor document (round 1: the root itself → root+token).
    //    The SECOND segment is ALWAYS the root and MUST NOT pair —
    //    root+token maps to round 1 for EVERY conversion, so using it
    //    as fallback glues later rounds' (or sibling chains') finals
    //    onto round 1 (observed: IQV2023000000217, whose first segment
    //    named a sibling invoice's chain doc, landed on a RELEASED
    //    round 1 via the root segment).
    const referential = match ? roundByDeduction.get(`${match[1]}${token}`) : undefined;
    if (referential) {
      referential.finalRows.push(row);
      return;
    }

    // 2. Sole-validated fallback: one RI round still awaiting its document.
    const awaiting = rounds.filter(r => r.closure === 'VALIDATED' && r.finalRows.length === 0);
    if (awaiting.length === 1) {
      awaiting[0].finalRows.push(row);
      return;
    }

    unattachedFinals.push(row);
  });

  return { rounds, orphanClosures, unshapedDocs, unattachedFinals };
}
