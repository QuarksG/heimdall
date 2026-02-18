export const trRegionConfig = {
  countryCode: 'TR',
  currency: 'TRY',
  dateFormat: 'DD-MMM-YYYY',
  markers: {
    paymentStart: 'odeme yap',
    emailDisclaimer: 'bu e-posta, izlenmeyen bir hesaptan gonderilmistir'
  
  },
  headers: {
    payment: [
      'Odeme yap?lacak taraf:',
      'Tedarikci Numaran?z:',
      'Tedarikci site ad?:',
      'Odeme numaras?:',
      'Odeme tarihi:',
      'Odeme para birimi:',
      'Odeme tutar?:'
    ],
    invoice: [
      'Fatura Numaras?',
      'Fatura Tarihi',
      'Fatura Ac?klamas?',
      'Uygulanan ?ndirim',
      'Odenen Tutar',
      'Kalan Tutar'
    ],
    display: [
      'Satır Numarası',
      'Ödeme yapılacak taraf',
      'Ödeme para birimi',
      'Tedarikçi site adı',
      'Ödeme Numarası',
      'Ödeme tarihi',
      'Fatura Türü',
      'Fatura Numarası',
      'Fatura Tarihi',
      'PO: Sipariş Numarası',
      'Fatura Açıklaması',
      'Uygulanan indirim',
      'Alacak',
      'Borç',
      'Bakiye'
    ]
  },
  mappings: {
    'odeme yapilacak taraf': 'Odeme yap?lacak taraf:',
    'tedarikci numaran': 'Tedarikci Numaran?z:',
    'tedarikci site ad': 'Tedarikci site ad?:',
    'odeme numarasi': 'Odeme numaras?:',
    'odeme tarihi': 'Odeme tarihi:',
    'odeme para birimi': 'Odeme para birimi:',
    'odeme tutari': 'Odeme tutar?:'
  }
};