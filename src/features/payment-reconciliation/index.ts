/**
 * Payment Reconciliation — public API.
 *
 * External consumers import from THIS barrel only. Everything below the
 * feature root (logic/, hooks/, components internals) is private.
 */
export { default as Recon } from './components/Recon';
export type { PaymentRecord, ParsingResult, InvoiceCategory } from './types/regional.types';
