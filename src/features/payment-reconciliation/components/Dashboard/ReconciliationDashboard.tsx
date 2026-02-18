import React, { useMemo, useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import {
  DollarSign,
  TrendingUp,
  FileText,
  Package,
  ArrowDownRight,
  Building2,
  Coins,
  CreditCard,
  Calculator,
  AlertCircle
} from 'lucide-react';
import type { PaymentRecord } from '../../types/regional.types';

import '../../../../styles/components/recon.css';

interface DashboardProps {
  data: PaymentRecord[];
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  icon: React.ElementType;
  colorClass: string;
  borderClass: string;
  cagr?: number;
  count?: number;
  countLabel?: string;
  metric?: { label: string; value: string };
  children?: React.ReactNode;
}

const COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#6366f1',
  '#14b8a6',
  '#f43f5e',
  '#9ca3af'
];

const CagrBadge = ({ value }: { value?: number }) => {
  if (value === undefined || Number.isNaN(value)) return <span className="text-xs text-gray-400">N/A</span>;
  const isPositive = value >= 0;
  return (
    <div
      className={`flex items-center text-xs font-bold px-2 py-0.5 rounded-full ${
        isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
      {Math.abs(value).toFixed(1)}% CAGR
    </div>
  );
};

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtext,
  icon: Icon,
  colorClass,
  borderClass,
  cagr,
  count,
  countLabel = 'Invoices',
  metric,
  children
}) => (
  <div className={`stat-card ${borderClass} flex flex-col justify-between h-full`}>
    <div>
      <div className="stat-card-header mb-3">
        <div className={`stat-icon ${colorClass}`}>
          <Icon className="w-6 h-6" />
        </div>
        <span className="stat-label text-sm font-bold text-gray-600 uppercase">{title}</span>
      </div>

      {children ? (
        children
      ) : (
        <>
          <div className="stat-value text-2xl font-extrabold text-gray-900 mb-1">{value}</div>

          <div className="flex flex-col gap-1 mt-2">
            {count !== undefined && (
              <div className="flex items-center text-sm text-gray-600">
                <FileText className="w-3 h-3 mr-1.5 text-gray-400" />
                <span className="font-medium">{count.toLocaleString()}</span>
                <span className="ml-1 text-gray-400 text-xs">{countLabel}</span>
              </div>
            )}

            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
              <span className="text-xs text-gray-400 font-medium">Growth (Annualized)</span>
              <CagrBadge value={cagr} />
            </div>

            {metric && (
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400 font-medium">{metric.label}</span>
                <span className="text-xs font-extrabold text-gray-800">{metric.value}</span>
              </div>
            )}
          </div>

          {subtext && <div className="stat-subtext mt-2 text-xs text-gray-400">{subtext}</div>}
        </>
      )}
    </div>
  </div>
);

const ChartCard: React.FC<{
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}> = ({ title, children, className = '', action }) => (
  <div className={`chart-card ${className}`}>
    <div className="flex justify-between items-center mb-6 border-b border-gray-100 pb-2">
      <h2 className="chart-title mb-0 border-0 pb-0">{title}</h2>
      {action}
    </div>
    {children}
  </div>
);

type PieDatum = { name: string; value: number; netValue: number };

const PieTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: PieDatum; value?: number }>;
  currency: string;
  formatCurrency: (n: number, c: string) => string;
}> = ({ active, payload, currency, formatCurrency }) => {
  if (!active || !payload || payload.length === 0) return null;

  const item = payload[0].payload;
  const absolute = payload[0].value ?? item.value;
  const net = item.netValue;

  return (
    <div
      style={{
        backgroundColor: '#fff',
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        padding: '10px 14px'
      }}
    >
      <div className="text-sm font-semibold text-gray-800 mb-1">{item.name}</div>
      <div className="text-sm text-gray-700">
        <strong>Absolute:</strong> {formatCurrency(Number(absolute) || 0, currency)}
      </div>
      <div className="text-sm text-gray-700">
        <strong>Net:</strong> {formatCurrency(Number(net) || 0, currency)}
      </div>
      <div className="text-xs mt-1 text-gray-500">{net >= 0 ? '💰 Net Income' : '💸 Net Expense'}</div>
    </div>
  );
};

const ReconciliationDashboard: React.FC<DashboardProps> = ({ data }) => {
  const availableCurrencies = useMemo(() => {
    if (!data || data.length === 0) return ['USD'];
    const currencies = new Set((data || []).map(row => row.currency?.trim() || 'USD'));
    return Array.from(currencies).sort();
  }, [data]);

  const [selectedCurrency, setSelectedCurrency] = useState<string>(availableCurrencies[0] || 'USD');

  useEffect(() => {
    if (availableCurrencies.length > 0 && !availableCurrencies.includes(selectedCurrency)) {
      setSelectedCurrency(availableCurrencies[0]);
    }
  }, [availableCurrencies, selectedCurrency]);

  const filteredData = useMemo(() => {
    return (data || [])
      .filter(row => (row.currency?.trim() || 'USD') === selectedCurrency)
      .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());
  }, [data, selectedCurrency]);

  const localeMap: Record<string, string> = { USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', TRY: 'tr-TR' };

  const getCurrencySymbol = (currencyCode: string) => {
    try {
      const parts = new Intl.NumberFormat(localeMap[currencyCode] || 'en-US', {
        style: 'currency',
        currency: currencyCode
      }).formatToParts(0);
      return parts.find(p => p.type === 'currency')?.value || currencyCode;
    } catch {
      return currencyCode;
    }
  };

  const normalizeTryCurrency = (formatted: string, currencySymbol: string) => {
    const trimmed = formatted.trim();
    const isNegative = trimmed.startsWith('-');
    const withoutSymbol = trimmed.replace(currencySymbol, '').replace(/\s+/g, '');
    const core = isNegative ? withoutSymbol.replace('-', '') : withoutSymbol;
    return `${isNegative ? '-' : ''}${currencySymbol}${core}`;
  };

  const formatCurrency = (val: number, currencyCode: string = 'USD'): string => {
    const nf = new Intl.NumberFormat(localeMap[currencyCode] || 'en-US', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    const out = nf.format(val);
    return currencyCode === 'TRY' ? normalizeTryCurrency(out, getCurrencySymbol(currencyCode)) : out;
  };

  const formatCompactCurrency = (val: number, currencyCode: string = 'USD'): string => {
    const nf = new Intl.NumberFormat(localeMap[currencyCode] || 'en-US', {
      style: 'currency',
      currency: currencyCode,
      notation: 'compact',
      compactDisplay: 'short'
    });
    const out = nf.format(val);
    return currencyCode === 'TRY' ? normalizeTryCurrency(out, getCurrencySymbol(currencyCode)) : out;
  };

  const formatPercent = (v?: number) => {
    if (v === undefined || Number.isNaN(v)) return 'N/A';
    return `${v.toFixed(1)}%`;
  };

  // Uploaded data period label (for the notice), per selected currency
  const uploadedPeriodLabel = useMemo(() => {
    if (!filteredData.length) return 'N/A';

    let min: Date | null = null;
    let max: Date | null = null;

    for (const r of filteredData) {
      const d = new Date(r.paymentDate);
      if (Number.isNaN(d.getTime())) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }

    if (!min || !max) return 'N/A';

    const fmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short' });
    const a = fmt.format(min);
    const b = fmt.format(max);
    return a === b ? a : `${a} – ${b}`;
  }, [filteredData]);

  const kpis = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return null;

    const parseCurrency = (input?: string | number | null): number => {
      if (input === null || input === undefined) return 0;
      const str = String(input);
      const clean = str.replace(/[^\d.-]/g, '');
      const val = parseFloat(clean);
      return Number.isNaN(val) ? 0 : val;
    };

    const companyName = filteredData[0]?.payee || 'Company Name';

    const calculateCAGR = (records: PaymentRecord[], valueFn: (r: PaymentRecord) => number): number => {
      if (records.length < 2) return 0;

      const sorted = [...records].sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());
      const startDate = new Date(sorted[0].paymentDate);
      const endDate = new Date(sorted[sorted.length - 1].paymentDate);

      const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const years = diffDays / 365.25;

      if (years < 0.08) return 0;

      const chunkSize = Math.max(1, Math.floor(sorted.length * 0.2));
      const startChunk = sorted.slice(0, chunkSize);
      const endChunk = sorted.slice(-chunkSize);

      const startSum = startChunk.reduce((sum, r) => sum + valueFn(r), 0);
      const endSum = endChunk.reduce((sum, r) => sum + valueFn(r), 0);

      if (startSum === 0) return 0;

      const totalGrowth = endSum / startSum;
      const cagr = (Math.pow(totalGrowth, 1 / years) - 1) * 100;
      return Number.isFinite(cagr) ? cagr : 0;
    };

    // Sales
    const salesRecords = filteredData.filter(row => row.invoiceType === 'Toptan Satis Faturasi');
    const totalSalesRevenue = salesRecords.reduce((sum, row) => sum + parseCurrency(row.credit), 0);
    const totalDiscountOnSales = salesRecords.reduce((sum, row) => sum + parseCurrency(row.discount), 0);
    const totalSalesWithDiscount = totalSalesRevenue + totalDiscountOnSales;
    const salesCount = salesRecords.length;
    const salesCAGR = calculateCAGR(salesRecords, r => parseCurrency(r.credit) + parseCurrency(r.discount));

    // Sales year range label (NO hooks inside hooks)
    let minYear = Number.POSITIVE_INFINITY;
    let maxYear = Number.NEGATIVE_INFINITY;
    for (const r of salesRecords) {
      const d = new Date(r.paymentDate);
      if (Number.isNaN(d.getTime())) continue;
      const y = d.getFullYear();
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    const salesYearRangeLabel =
      Number.isFinite(minYear) && Number.isFinite(maxYear)
        ? minYear === maxYear
          ? `${minYear}`
          : `${minYear}–${maxYear}`
        : '';

    // Remittance
    const remittanceRecords = filteredData.filter(row => (row.invoiceType || '').toUpperCase().includes('HAVALE'));
    const totalRemittance = remittanceRecords.reduce((sum, row) => {
      const val = Math.max(parseCurrency(row.debit), parseCurrency(row.paymentAmount));
      return sum + val;
    }, 0);
    const uniquePaymentNumbers = new Set(remittanceRecords.map(r => r.paymentNumber)).size;
    const remittanceCAGR = calculateCAGR(remittanceRecords, r =>
      Math.max(parseCurrency(r.debit), parseCurrency(r.paymentAmount))
    );

    // CCOGS
    const ccogsRecords = filteredData.filter(row => row.invoiceType === 'Ticari Isbirligi Faturasi');
    const totalCCOGS = ccogsRecords.reduce((sum, row) => sum + (parseCurrency(row.debit) - parseCurrency(row.credit)), 0);
    const ccogsCount = ccogsRecords.length;
    const ccogsCAGR = calculateCAGR(ccogsRecords, r => parseCurrency(r.debit) - parseCurrency(r.credit));
    const ccogsToSalesPct = totalSalesWithDiscount !== 0 ? (totalCCOGS / totalSalesWithDiscount) * 100 : NaN;

    // AP variances
    const pqvRecords = filteredData.filter(row => row.invoiceType === 'Eksik Miktar Kesinti Faturasi');
    const pqvAmount = pqvRecords.reduce((sum, row) => sum + (parseCurrency(row.debit) - parseCurrency(row.credit)), 0);
    const pqvCount = pqvRecords.length;

    const ppvRecords = filteredData.filter(row => row.invoiceType === 'Fiyat Farki Kesinti Faturasi');
    const ppvAmount = ppvRecords.reduce((sum, row) => sum + (parseCurrency(row.debit) - parseCurrency(row.credit)), 0);
    const ppvCount = ppvRecords.length;

    // QPD: DEBIT-only
    const qpdRecords = filteredData.filter(row => row.invoiceType === 'QPD');
    const qpdAmount = qpdRecords.reduce((sum, row) => sum + parseCurrency(row.debit), 0);
    const qpdCount = qpdRecords.length;

    // Trend aggregation
    const quarterlyData: Record<
      string,
      { sales: number; ccogs: number; havale: number; pqv: number; ppv: number; returns: number }
    > = {};

    const isUrunIadesiFaturasi = (invoiceType?: string) => {
      const t = (invoiceType || '').toLowerCase();
      return t.includes('urun iadesi') || t.includes('ürün iadesi');
    };

    filteredData.forEach(row => {
      const d = new Date(row.paymentDate);
      if (Number.isNaN(d.getTime())) return;

      const q = Math.floor(d.getMonth() / 3) + 1;
      const key = `${d.getFullYear()}-Q${q}`;

      if (!quarterlyData[key]) quarterlyData[key] = { sales: 0, ccogs: 0, havale: 0, pqv: 0, ppv: 0, returns: 0 };

      if (row.invoiceType === 'Toptan Satis Faturasi') {
        quarterlyData[key].sales += parseCurrency(row.credit) + parseCurrency(row.discount);
      }
      if (row.invoiceType === 'Ticari Isbirligi Faturasi') {
        quarterlyData[key].ccogs += parseCurrency(row.debit) - parseCurrency(row.credit);
      }
      if ((row.invoiceType || '').toUpperCase().includes('HAVALE')) {
        quarterlyData[key].havale += Math.max(parseCurrency(row.debit), parseCurrency(row.paymentAmount));
      }
      if (row.invoiceType === 'Eksik Miktar Kesinti Faturasi') {
        quarterlyData[key].pqv += parseCurrency(row.debit) - parseCurrency(row.credit);
      }
      if (row.invoiceType === 'Fiyat Farki Kesinti Faturasi') {
        quarterlyData[key].ppv += parseCurrency(row.debit) - parseCurrency(row.credit);
      }
      if (isUrunIadesiFaturasi(row.invoiceType)) {
        quarterlyData[key].returns += parseCurrency(row.debit) - parseCurrency(row.credit);
      }
    });

    const trendData = Object.entries(quarterlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([quarter, val]) => ({
        quarter,
        sales: val.sales,
        ccogs: val.ccogs,
        havale: val.havale,
        pqv: val.pqv,
        ppv: val.ppv,
        returns: val.returns
      }));

   
    const typeBreakdown: Record<string, { credit: number; debit: number; net: number }> = {};
    filteredData.forEach(row => {
      const type = row.invoiceType || 'Unknown';
      if (!type.toLowerCase().includes('fatura')) return;

      const credit = parseCurrency(row.credit);
      const debit = parseCurrency(row.debit);

      if (!typeBreakdown[type]) typeBreakdown[type] = { credit: 0, debit: 0, net: 0 };
      typeBreakdown[type].credit += credit;
      typeBreakdown[type].debit += debit;
    });

    Object.keys(typeBreakdown).forEach(type => {
      typeBreakdown[type].net = typeBreakdown[type].credit - typeBreakdown[type].debit;
    });

    let totalVolume = 0;
    Object.values(typeBreakdown).forEach(({ net }) => {
      totalVolume += Math.abs(net);
    });

    const rawTypeData = Object.entries(typeBreakdown)
      .map(([name, { net }]) => ({ name, value: Math.abs(net), netValue: net }))
      .filter(item => item.value > 0.01)
      .sort((a, b) => b.value - a.value);

    const groupedTypeData: PieDatum[] = [];
    let otherSum = 0;
    let otherNetSum = 0;

    if (totalVolume > 0) {
      rawTypeData.forEach(item => {
        const percentage = (item.value / totalVolume) * 100;
        if (percentage >= 5) groupedTypeData.push(item);
        else {
          otherSum += item.value;
          otherNetSum += item.netValue;
        }
      });

      if (otherSum > 0.01) groupedTypeData.push({ name: 'Other', value: otherSum, netValue: otherNetSum });
    }

    const topInvoiceType = rawTypeData.length > 0 ? rawTypeData[0].name : 'N/A';
    const topInvoiceValue = rawTypeData.length > 0 ? rawTypeData[0].value : 0;

    // Seasonality by month (sales only)
    const monthlyData: Record<string, number> = {};
    salesRecords.forEach(row => {
      const d = new Date(row.paymentDate);
      if (Number.isNaN(d.getTime())) return;

      const monthName = d.toLocaleString('en-US', { month: 'short' });
      monthlyData[monthName] = (monthlyData[monthName] || 0) + parseCurrency(row.credit) + parseCurrency(row.discount);
    });

    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const seasonalData = monthOrder
      .filter(month => monthlyData[month] !== undefined)
      .map(month => ({ month, amount: monthlyData[month] }));

    return {
      companyName,
      currency: selectedCurrency,
      sales: { total: totalSalesWithDiscount, count: salesCount, cagr: salesCAGR, discountAmount: totalDiscountOnSales },
      remittance: { total: totalRemittance, count: uniquePaymentNumbers, cagr: remittanceCAGR },
      ccogs: { total: totalCCOGS, count: ccogsCount, cagr: ccogsCAGR, ccogsToSalesPct },
      apVariances: {
        pqv: { total: pqvAmount, count: pqvCount },
        ppv: { total: ppvAmount, count: ppvCount },
        qpd: { total: qpdAmount, count: qpdCount }
      },
      trendData,
      typeData: groupedTypeData,
      seasonalData,
      transactionCount: filteredData.length,
      topInvoiceType,
      topInvoiceValue,
      salesYearRangeLabel
    };
  }, [filteredData, selectedCurrency]);

  if (!kpis) {
    return (
      <div className="dashboard-empty">
        <FileText className="w-16 h-16 text-gray-300" />
        <p className="text-gray-500 mt-4">No data available. Please upload a file to view the dashboard.</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded-r-lg">
        <div className="flex items-start">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            <p className="font-semibold mb-1">Data Processing Notice</p>
            <p className="mb-1">
              Uploaded data period:{' '}
              <span className="font-semibold">
                {uploadedPeriodLabel} ({kpis.currency})
              </span>
            </p>
            <p>
              The EFT(EFT Remittance Advice) period data was processed and provided data can be misleading because of input data variances and
              invoice classifications. It is recommended to check by downloading the Excel for much more granular
              analysis.
            </p>
          </div>
        </div>
      </div>

      {availableCurrencies.length > 1 && (
        <div className="flex items-center space-x-2 mb-6 border-b border-gray-200 pb-2">
          <Coins className="w-5 h-5 text-gray-500 mr-2" />
          <span className="text-sm font-medium text-gray-500 mr-4">Select Currency:</span>
          {availableCurrencies.map(curr => (
            <button
              key={curr}
              onClick={() => setSelectedCurrency(curr)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors relative top-[1px] ${
                selectedCurrency === curr
                  ? 'bg-white text-blue-600 border-t border-x border-gray-200 shadow-sm z-10'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {curr}
            </button>
          ))}
        </div>
      )}

      <div className="company-header">
        <Building2 className="w-8 h-8 text-blue-500" />
        <h2 className="company-name">{kpis.companyName}</h2>
        {availableCurrencies.length === 1 && <span className="currency-badge">{kpis.currency}</span>}
      </div>

      <div className="kpi-grid">
        <StatCard
          title="Total Sales"
          value={formatCurrency(kpis.sales.total, kpis.currency)}
          subtext="Toptan Satis Faturasi"
          icon={DollarSign}
          colorClass="text-blue-500"
          borderClass="border-blue-500"
          count={kpis.sales.count}
          cagr={kpis.sales.cagr}
        />

        <StatCard
          title="Remittance(Net Fund Transfer)"
          value={formatCurrency(kpis.remittance.total, kpis.currency)}
          subtext="Giden Havale"
          icon={CreditCard}
          colorClass="text-green-600"
          borderClass="border-green-600"
          count={kpis.remittance.count}
          countLabel="Unique Payments"
          cagr={kpis.remittance.cagr}
        />

        <StatCard
          title="C-COGS (Cost of Goods Sold)"
          value={formatCurrency(kpis.ccogs.total, kpis.currency)}
          subtext="Ticari İşbirliği"
          icon={Package}
          colorClass="text-purple-500"
          borderClass="border-purple-500"
          count={kpis.ccogs.count}
          cagr={kpis.ccogs.cagr}
          metric={{
            label: 'CCOGS / Total Sales',
            value: `= ${formatPercent(kpis.ccogs.ccogsToSalesPct)}`
          }}
        />

        <StatCard title="AP Variances" value="" icon={Calculator} colorClass="text-red-500" borderClass="border-red-500">
          <div className="flex flex-col h-full justify-center gap-3">
            <div className="border-b border-dashed border-gray-200 pb-2">
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">
                <strong>PQV-RI:</strong>
              </div>
              <div className="text-sm text-gray-700">
                Count of <span className="font-bold">{kpis.apVariances.pqv.count}</span> in the amount of{' '}
                <span className="font-bold">{formatCurrency(kpis.apVariances.pqv.total, kpis.currency)}</span>
              </div>
            </div>

            <div className="border-b border-dashed border-gray-200 pb-2">
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">
                <strong>PPV-RI:</strong>
              </div>
              <div className="text-sm text-gray-700">
                Count of <span className="font-bold">{kpis.apVariances.ppv.count}</span> in the amount of{' '}
                <span className="font-bold">{formatCurrency(kpis.apVariances.ppv.total, kpis.currency)}</span>
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-600 uppercase tracking-wide mb-1">
                <strong>QPD:</strong>
              </div>
              <div className="text-sm text-gray-700">
                Aggregated total count of records{' '}
                <span className="font-bold">{kpis.apVariances.qpd.count}</span>, in the amount of{' '}
                <span className="font-bold">{formatCurrency(kpis.apVariances.qpd.total, kpis.currency)}</span>
              </div>
            </div>
          </div>
        </StatCard>
      </div>

      <div className="mb-8">
        <ChartCard title="Quarterly Trend: Sales vs C-COGS(Cost of Goods Sold) vs Remittance(Net Fund Transfer)" className="w-full">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={kpis.trendData} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ccogsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="havaleGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="quarter" stroke="#6b7280" style={{ fontSize: '12px' }} tickMargin={12} />
              <YAxis
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
                tickFormatter={(val: number) => formatCompactCurrency(val, kpis.currency)}
              />

              <RechartsTooltip
                formatter={(value: unknown, name: string | number | undefined) => {
                  const labels: Record<string, string> = {
                    sales: 'Sales Revenue',
                    ccogs: 'C-COGS',
                    havale: 'Paid Remittance'
                  };
                  return [formatCurrency(Number(value) || 0, kpis.currency), labels[String(name)] || String(name)];
                }}
                contentStyle={{
                  backgroundColor: '#fff',
                  borderRadius: '12px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
              />

              <Legend verticalAlign="top" height={36} iconType="line" wrapperStyle={{ paddingBottom: '20px' }} />

              <Line
                type="monotone"
                dataKey="sales"
                name="Sales"
                stroke="#2563eb"
                strokeWidth={4}
                dot={{ fill: '#2563eb', r: 6, strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 8, strokeWidth: 2 }}
                fill="url(#salesGradient)"
              />

              <Line
                type="monotone"
                dataKey="ccogs"
                name="C-COGS"
                stroke="#dc2626"
                strokeWidth={4}
                strokeDasharray="5 5"
                dot={{ fill: '#dc2626', r: 6, strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 8, strokeWidth: 2 }}
                fill="url(#ccogsGradient)"
              />

              <Line
                type="monotone"
                dataKey="havale"
                name="Remittance"
                stroke="#059669"
                strokeWidth={3}
                strokeDasharray="3 3"
                dot={{ fill: '#059669', r: 5, strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7, strokeWidth: 2 }}
                fill="url(#havaleGradient)"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="charts-grid-2col">
        <ChartCard title="Invoice Type Distribution (> 5%)">
          <div className="mb-3 px-2">
            <div className="text-xs text-gray-600 font-medium mb-1">Includes only types containing "Fatura"</div>
          </div>

          <ResponsiveContainer width="100%" height={280}>
            {kpis.typeData.length > 0 ? (
              <PieChart>
                <Pie
                  data={kpis.typeData}
                  cx="50%"
                  cy="50%"
                  labelLine
                  label={({ name, percent }: any) => `${name} (${(percent * 100).toFixed(1)}%)`}
                  outerRadius={85}
                  dataKey="value"
                  paddingAngle={2}
                >
                  {kpis.typeData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="#fff" strokeWidth={2} />
                  ))}
                </Pie>

                <RechartsTooltip content={<PieTooltip currency={kpis.currency} formatCurrency={formatCurrency} />} />
              </PieChart>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">No "Fatura" invoice data available</div>
            )}
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Seasonal Sales Impact by Month">
          <div className="mb-3 px-2">
            <div className="text-xs text-gray-600 font-medium mb-1">
              Aggregated sales across {kpis.salesYearRangeLabel || 'available periods'} by month in the current currency
            </div>
          </div>

          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={kpis.seasonalData} margin={{ top: 10, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis
                dataKey="month"
                stroke="#6b7280"
                style={{ fontSize: '11px' }}
                tick={{ fill: '#6b7280' }}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
                tickFormatter={(val: number) => formatCompactCurrency(val, kpis.currency)}
              />
              <RechartsTooltip
                formatter={(value: unknown) => [formatCurrency(Number(value) || 0, kpis.currency), 'Sales Amount']}
                cursor={{ fill: '#f3f4f6' }}
                contentStyle={{
                  backgroundColor: '#fff',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb',
                  padding: '10px 14px'
                }}
              />
              <Bar dataKey="amount" radius={[8, 8, 0, 0]} maxBarSize={60} fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mb-8">
        <ChartCard title="Quarterly Trend: PQV/PPV vs Vendor Returns" className="w-full">
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={kpis.trendData} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
              <defs>
                <linearGradient id="pqvGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ppvGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ec4899" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="returnsGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6b7280" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#6b7280" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="quarter" stroke="#6b7280" style={{ fontSize: '12px' }} tickMargin={12} />
              <YAxis
                stroke="#6b7280"
                style={{ fontSize: '12px' }}
                tickFormatter={(val: number) => formatCompactCurrency(val, kpis.currency)}
              />

              <RechartsTooltip
                formatter={(value: unknown, name: string | number | undefined) => {
                  const labels: Record<string, string> = {
                    pqv: 'PQV-RI (Qty Variance)',
                    ppv: 'PPV-RI (Price Variance)',
                    returns: 'Urun Iadesi Faturasi'
                  };
                  return [formatCurrency(Number(value) || 0, kpis.currency), labels[String(name)] || String(name)];
                }}
                contentStyle={{
                  backgroundColor: '#fff',
                  borderRadius: '12px',
                  border: '1px solid #e5e7eb',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}
              />

              <Legend verticalAlign="top" height={36} iconType="line" wrapperStyle={{ paddingBottom: '20px' }} />

              <Line
                type="monotone"
                dataKey="pqv"
                name="PQV-RI"
                stroke="#f59e0b"
                strokeWidth={3}
                strokeDasharray="2 2"
                dot={{ fill: '#f59e0b', r: 5, strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7, strokeWidth: 2 }}
                fill="url(#pqvGradient)"
              />

              <Line
                type="monotone"
                dataKey="ppv"
                name="PPV-RI"
                stroke="#ec4899"
                strokeWidth={3}
                strokeDasharray="6 2"
                dot={{ fill: '#ec4899', r: 5, strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7, strokeWidth: 2 }}
                fill="url(#ppvGradient)"
              />

              <Line
                type="monotone"
                dataKey="returns"
                name="Vendor Returns"
                stroke="#6b7280"
                strokeWidth={3}
                strokeDasharray="8 4"
                dot={{ fill: '#6b7280', r: 5, strokeWidth: 2, stroke: '#fff' }}
                activeDot={{ r: 7, strokeWidth: 2 }}
                fill="url(#returnsGradient)"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
};

export default ReconciliationDashboard;
