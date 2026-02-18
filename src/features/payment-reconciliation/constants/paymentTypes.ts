export const RegionCode = {
  TR: 'TR',
  DE: 'DE',
  UK: 'UK',
  US: 'US',
} as const;

export type RegionCode = typeof RegionCode[keyof typeof RegionCode];

export const CurrencyCode = {
  TRY: 'TRY',
  EUR: 'EUR',
  GBP: 'GBP',
  USD: 'USD',
  JPY: 'JPY',
} as const;

export type CurrencyCode = typeof CurrencyCode[keyof typeof CurrencyCode];

export const DataSource = {
  OFA_REMITTANCE: 'OFA_REMITTANCE',
  FINOPS: 'FINOPS',
  VENDOR_STATEMENT: 'VENDOR_STATEMENT',
} as const;

export type DataSource = typeof DataSource[keyof typeof DataSource];