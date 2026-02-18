export interface RegionConfig {
  regionCode: string;
  regionName: string;
  currency: string;
  dateFormat: string;
  numberFormat: {
    decimalSeparator: string;
    thousandsSeparator: string;
  };
  processorClass: string;
  classifierClass: string;
  localization: {
    paymentLabel: string;
    invoiceLabel: string;
    disclaimerText: string;
  };
}

export interface RegionConfigFactory {
  getConfig(regionCode: string): RegionConfig;
  getSupportedRegions(): string[];
}