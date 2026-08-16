/**
 * DISCLAIMER CONTENT — the invoice-class explanations of
 * `docs/Disclaimer of Reconciliation.xlsx` (sheet 'Destek'), structured
 * per invoice class with an English translation of every paragraph.
 *
 * The Turkish column is the SOURCE OF TRUTH (verbatim from the analyst
 * workbook, typos preserved only where meaning-neutral fixes were not
 * obvious); the English column is a faithful translation. Each section
 * also names the workbook's related `Fatura Türü` classes so the reader
 * can jump from any classified row to its dedicated explanation.
 */

/** One bilingual paragraph (or list step / literal line). */
export interface DisclaimerParagraph {
  tr: string;
  en: string;
}

/** One invoice-class section of the disclaimer. */
export interface DisclaimerSection {
  /** Section number as in the source document (1–7). */
  no: number;
  titleTr: string;
  titleEn: string;
  /** The workbook's related 'Fatura Türü' classifications. */
  relatedClasses: string[];
  paragraphs: DisclaimerParagraph[];
}

/**
 * The payment-control message shown at the TOP of the Disclaimer sheet,
 * above the invoice-class sections (analyst instruction). One tall
 * wrapped cell per language; the embedded newlines are intentional.
 */
export const DISCLAIMER_INTRO: DisclaimerParagraph = {
  tr:
    'Ödemelerinizi kontrol etmek için;\n\n' +
    'Vendor Central > Ödemeler > Para Transferleri > Fatura Numarasına/Ödeme Numarasına Göre Ara > ' +
    'Mevcut Ödeme Numarası seçeneğine tıklayarak ödeme numarası ile yapılan ödemeleri görebilirsiniz.\n\n' +
    'Ödeme numarası ile ödenen tutar, kesinti ve satış faturalarının toplam tutarıdır. Bu durumda ödeme ' +
    'numarasını tıklayarak fatura numarası bölümüne girdiğimizde, fatura numarasının karşısında yazan tutar ' +
    'faturaya göre ödenen/kesilen tutardır.\n\n' +
    'Bu yüzden ödeme numarası altında yer alan kesintileri fatura türlerine göre aşağıdaki şekilde size ' +
    'iletiyoruz; kabul etmediğiniz bir durum veya fatura varsa ilgili itiraz yöntemini takip ediniz.',
  en:
    'To check your payments;\n\n' +
    'You can see the payments made under a payment number by clicking Vendor Central > Payments > ' +
    'Remittance > Search by Invoice Number/Payment Number > Existing Payment Number.\n\n' +
    'The amount paid under a payment number is the total of the deduction and sales invoices. When you ' +
    'click the payment number and open the invoice number section, the amount shown against each invoice ' +
    'number is the amount paid/deducted for that invoice.\n\n' +
    'For this reason, we present the deductions under the payment number by invoice type as below; if there ' +
    'is a situation or an invoice you do not accept, please follow the relevant dispute method.',
};

export const DISCLAIMER_SECTIONS: readonly DisclaimerSection[] = [
  {
    no: 1,
    titleTr: 'Provizyonlar',
    titleEn: 'Provisions',
    relatedClasses: ['Alacak Provizyonu', 'Vadesi Geçmis Alacak Provizyonu'],
    paragraphs: [
      {
        tr: 'Ödeme detaylarınızı kontrol ederken görebileceğiniz kesinti türlerinden biri Provizyonlardır.',
        en: 'Provisions are one of the deduction types you may see when reviewing your payment details.',
      },
      {
        tr: 'Provizyonlar, hesabınızda borç bakiyesi oluşmasını önlemek için alınan önlem adımlarıdır. Amazon açısından alacaklar borçlarından fazlaysa hesabınıza provizyon koyarız.',
        en: 'Provisions are precautionary steps taken to prevent a debit balance from forming on your account. If, from Amazon’s perspective, receivables exceed payables, we place a provision on your account.',
      },
      {
        tr: 'Başka bir deyişle eğer Amazon’un sunduğu hizmetlere istinaden sizden alacaklı olduğu tutarlar, faturalarınıza istinaden size borçlu olduğu ve ödemesi gereken tutarlardan daha fazla ise, Amazon alacaklı olduğundan bu durum geçene kadar hesabınıza provizyon konur.',
        en: 'In other words, if the amounts Amazon is owed by you for the services it provides exceed the amounts Amazon owes you and must pay for your invoices, a provision is placed on your account until this situation clears, since Amazon is the creditor.',
      },
      {
        tr: 'Alacaklar faturalandırılmadan anlaşılan ödeme koşullarına göre ödemeleri gerçekleştirirsek hesabınızda borç bakiyesi oluşabilir.',
        en: 'If we make payments according to the agreed payment terms before receivables are invoiced, a debit balance may form on your account.',
      },
      {
        tr: 'Tedarikçinin alacaklarını ve borçlarını önceden tahmin edip sadece risk miktarı kadar provizyon koyarız.',
        en: 'We estimate the vendor’s receivables and payables in advance and only place a provision equal to the amount at risk.',
      },
      {
        tr: 'Provizyonlar/Risk = Amazon açısından Alacaklar - Borçlar.',
        en: 'Provisions/Risk = Receivables − Payables, from Amazon’s perspective.',
      },
      {
        tr: 'Provizyon faturaları ekstrenizde şu şekilde yer alır:',
        en: 'Provision invoices appear on your statement as:',
      },
      {
        tr: 'XXXX(tarih)_PROVISON_FOR_RECEIVABLE',
        en: 'XXXX(date)_PROVISON_FOR_RECEIVABLE',
      },
      {
        tr: 'Borçlar arttığında veya alacaklar Ticari işbirliği/iadeler faturalandırıldığında provizyon kaldırılır.',
        en: 'The provision is removed when payables increase or when receivables are invoiced through Co-op/returns.',
      },
      {
        tr: 'Provizyonun kaldırılıp kaldırılmadığını, güncel olarak aldığınız her ödemenin detaylarını inceleyerek takip edebilirsiniz. Ödeme detaylarınızın herhangi birinde aşağıdaki gibi bir ibare görüyorsanız provizyonunuzun kaldırıldığı anlamına gelir:',
        en: 'You can track whether the provision has been removed by reviewing the details of each payment you receive. If you see a line like the following in any of your payment details, it means your provision has been removed:',
      },
      {
        tr: 'REVERSAL FOR XXXX(tarih)_PROVISON_FOR_RECEIVABLE-M',
        en: 'REVERSAL FOR XXXX(date)_PROVISON_FOR_RECEIVABLE-M',
      },
      {
        tr: 'Buradaki Reversal ifadesi provizyonunuzun kaldırıldığına işaret eder.',
        en: 'The word “Reversal” here indicates that your provision has been removed.',
      },
      {
        tr: "Alacaklar için provizyon koşulları, Vendor Central'ın Kaynak Merkezindeki Tedarikçi Şartları ve Koşullarında bulunabilir.",
        en: 'The provision terms for receivables can be found in the Vendor Terms and Conditions in Vendor Central’s Resource Center.',
      },
      {
        tr: 'https://vendorcentral.amazon.com.tr/gp/vendor/members/downloads/download',
        en: 'https://vendorcentral.amazon.com.tr/gp/vendor/members/downloads/download',
      },
      {
        tr: 'VC > Ayarlar > Sözleşmeler > Kabul edildi/Red edildi > Şartlar ve Koşullar > 11. Muhtelif Hükümler:',
        en: 'VC > Settings > Agreements > Accepted/Rejected > Terms and Conditions > 11. Miscellaneous Provisions:',
      },
      {
        tr: 'Amazon, Tedarikçi’nin Amazon’a borçlu olduğu meblağları alıkoyabilir veya Amazon’un Tedarikçiye borçlu olduğu meblağlardan mahsup veya takas edebilir. Amazon, işbu Sözleşme uyarınca yapılan ödemeleri doğrulaması için gerekli olan belgeleri Tedarikçiden talep edebilir. Tedarikçi makul bir süre içerisinde bu belgeleri sunmazsa, Amazon ödenmemiş her meblağı Tedarikçiye yapılacak sonraki ödemeden mahsup etmekte serbest olacaktır. Taraflardan birinin bir veya birden fazla hakkını veya hukuki yolunu kullanması başka bir hakkını veya hukuki yolu kullanmasını engellemeyecektir.',
        en: 'Amazon may withhold amounts the Vendor owes to Amazon, or set off or net them against amounts Amazon owes to the Vendor. Amazon may request from the Vendor the documents necessary to verify payments made under this Agreement. If the Vendor fails to provide these documents within a reasonable period, Amazon will be free to set off any unpaid amount against the next payment to be made to the Vendor. The exercise by either party of one or more of its rights or remedies will not prevent it from exercising any other right or remedy.',
      },
    ],
  },
  {
    no: 2,
    titleTr: 'Ticari İşbirliği Faturaları (C Faturaları)',
    titleEn: 'Trade Co-operation Invoices (C Invoices / Co-op)',
    relatedClasses: ['Ticari Isbirligi Faturasi'],
    paragraphs: [
      {
        tr: 'Ticari işbirliği (Coop yani Cxx) faturaları, pazarlama kesintileri olarak bilinen, Amazon’un tarafınıza sunduğu hizmetlerden dolayı yaptığı kesinti faturaları olarak bilinir.',
        en: 'Trade co-operation (Co-op, i.e. Cxx) invoices, known as marketing deductions, are deduction invoices issued for the services Amazon provides to you.',
      },
      {
        tr: 'Bu faturalar “PGÖ/Coop Sözleşmesi” başlıklı anlaşmalara istinaden tarafınıza yapılan pazarlama kesintileri sonucu oluşturulur.',
        en: 'These invoices are created as a result of the marketing deductions applied to you under agreements titled “PGÖ/Co-op Agreement”.',
      },
      {
        tr: 'Pazarlama kesintileri ile ilgili detaylı bilgi edinmek için CoOp anlaşmalarınızı Vendor Central hesabınız üzerinden inceleyebilirsiniz.',
        en: 'For detailed information about marketing deductions, you can review your Co-op agreements through your Vendor Central account.',
      },
      {
        tr: 'Faturaların neye istinaden oluşturulduğunu öğrenmek için ise Vendor Central hesabınız aracılığıyla Ödemeler > CoOp adımlarını takip ederek ilgili faturanın yanında bulunan “Mevcut İndirmeler” seçeneğinden fatura raporlarını indirip detaylı bilgi sahibi olabilirsiniz.',
        en: 'To find out what an invoice was issued for, follow Payments > CoOp in your Vendor Central account and download the invoice reports from the “Available Downloads” option next to the relevant invoice.',
      },
      {
        tr: 'Anlaşmalara ulaşmak için Vendor Central > Ayarlar > Sözleşmeler adımlarını takip edebilirsiniz. Kabul Edildi/Reddedildi sekmesinde, Ticari işbirliği başlığı altında anlaşmanızı görüntüleyebilirsiniz.',
        en: 'To access the agreements, follow Vendor Central > Settings > Agreements. On the Accepted/Rejected tab you can view your agreement under the Trade Co-operation heading.',
      },
      {
        tr: 'Sözleşme detayları ile ilgili görüşmek istediğiniz konular için tedarikçi yöneticinizle iletişime geçebilirsiniz.',
        en: 'For matters you wish to discuss regarding agreement details, you can contact your vendor manager.',
      },
      {
        tr: 'Coop faturaları ile ilgili raporları ve anlaşmayı inceledikten sonra size faturalandırılan tutarın doğru olmadığını ve faturaların kesilmemesi gerektiğini düşünmeniz durumunda “C” ile başlayan bu faturaya Vendor Central aracılığıyla itiraz edebilirsiniz.',
        en: 'After reviewing the Co-op reports and the agreement, if you believe the amount invoiced to you is incorrect and the invoices should not have been issued, you can dispute this invoice starting with “C” through Vendor Central.',
      },
      {
        tr: 'İtirazınızı göndermek için lütfen aşağıdaki adımları takip edin:',
        en: 'To submit your dispute, please follow the steps below:',
      },
      {
        tr: '1. Ödemeler > İtiraz Yönetimi sekmesine gidin.',
        en: '1. Go to Payments > Dispute Management.',
      },
      {
        tr: '2. Yeni itiraz oluştur’a tıklayın.',
        en: '2. Click Create new dispute.',
      },
      {
        tr: '3. İtiraz konusu olarak “Ticari İşbirliği”ni seçin.',
        en: '3. Select “Trade Co-operation” as the dispute subject.',
      },
      {
        tr: '4. Aşağıdaki boşluğa işlem kaydı üzerinden ilettiğiniz fatura numarasını girin ve İleri’ye tıklayın.',
        en: '4. Enter the invoice number you provided on the case log into the field below and click Next.',
      },
      {
        tr: '5. Gerekli alanları doldurarak Gönder’e tıklayın.',
        en: '5. Fill in the required fields and click Submit.',
      },
      {
        tr: 'İtirazları inceleyen ekibin farklı bir ekip olduğunu ve Tedarikçi Destek Ekibinin bu itirazlar üzerinde herhangi bir kontrolü olmadığını bildirmek isteriz.',
        en: 'Please note that the team reviewing disputes is a separate team, and the Vendor Support Team has no control over these disputes.',
      },
      {
        tr: 'Not: Bu kesintiler herhangi bir faturaya karşılık kesilmez, tedarikçi ile yapılan Ticari İşbirliği anlaşmalarının şartlarına istinaden kesilir.',
        en: 'Note: these deductions are not issued against any specific invoice; they are issued under the terms of the Trade Co-operation agreements made with the vendor.',
      },
    ],
  },
  {
    no: 3,
    titleTr: 'İade Edilen Ürünler İçin Kesilen İade Faturaları (V Faturaları)',
    titleEn: 'Return Invoices for Returned Products (V Invoices / Vendor Returns)',
    relatedClasses: ['Iade Edilen Ürünler Için Kesilen Iade Faturasi'],
    paragraphs: [
      {
        tr: 'V ile başlayan iade faturaları; Amazon’un, tedarikçilerle yaptığı satın alma sözleşmelerinde yer alan ve kabul edilen iade şartları altındaki geçerli sebeplerden herhangi birinin olması (stok fazlası, hasarlı ürün gönderimi vs.) durumunda ürünleri fiziksel olarak tedarikçiye iade etmesi ve bu iadeler için V ile başlayan bir iade faturası kesmesi olarak tanımlanır.',
        en: 'Return invoices starting with V are issued when Amazon physically returns products to the vendor for any of the valid reasons under the return terms accepted in the purchase agreements made with vendors (overstock, damaged product shipment, etc.), and issues a return invoice starting with V for these returns.',
      },
      {
        tr: 'Yani diğer bir deyişle Amazon, tedarikçiyle yaptığı ve tarafların karşılıklı mutabık olduğu şartlara bağlı olarak ürünleri iade ettiğinde bu iadeler için V ile başlayan bir iade faturası keser.',
        en: 'In other words, when Amazon returns products under the terms mutually agreed with the vendor, it issues a return invoice starting with V for those returns.',
      },
      {
        tr: 'Amazon ile yapmış olduğunuz satın alma anlaşmalarına buradan ulaşabilir ve göz atabilirsiniz:',
        en: 'You can access and review your purchase agreements with Amazon here:',
      },
      {
        tr: 'Vendor Central > Ayarlar > Sözleşmeler > Kabul Edildi/Reddedildi > Satın alma şartları > TR-xxxxxxxxx',
        en: 'Vendor Central > Settings > Agreements > Accepted/Rejected > Purchase terms > TR-xxxxxxxxx',
      },
      {
        tr: 'Yapılan iadelerin anlaşma kapsamı dışında olduğuna kanaat getirir ve itiraz etmek isterseniz aşağıda verilen adımları takip ederek V faturasına itiraz açabilirsiniz:',
        en: 'If you conclude that the returns are outside the scope of the agreement and wish to dispute them, you can open a dispute against the V invoice by following the steps below:',
      },
      {
        tr: 'Vendor Central > Ödemeler > İtiraz Yönetimi > Yeni itiraz Oluştur > Tedarikçi İadeleri seçeneğine tıklayın, ardından alttaki kutucuğa V ile başlayan fatura numarasını yapıştırın ve + işaretine basın.',
        en: 'Click Vendor Central > Payments > Dispute Management > Create new dispute > Vendor Returns, then paste the invoice number starting with V into the box below and press the + sign.',
      },
      {
        tr: 'Bunun ardından gösterilen adımları takip ederek itirazınızı tamamlayın.',
        en: 'Then complete your dispute by following the steps shown.',
      },
      {
        tr: 'Gönderdiğiniz itirazları yine aynı adımları takip ederek ekranda bulunan İtirazların özeti başlığı altından takip edebilirsiniz.',
        en: 'You can track the disputes you have submitted under the Dispute Summary heading on the screen by following the same steps.',
      },
    ],
  },
  {
    no: 4,
    titleTr: 'SCR Faturaları ve Self Servis İtiraz Yöntemi',
    titleEn: 'SCR Invoices and the Self-Service Dispute Method',
    relatedClasses: [
      'Eksik Miktar Kesinti Bildirimi',
      'Eksik Miktar Kesinti Bildirimi Ters kayit',
    ],
    paragraphs: [
      {
        tr: 'Sipariş gönderiminizi yaptıktan sonra fatura kesmenizin ardından, vade tarihine kadar sistem depoya giriş yapan ürünler ile faturalandırdığınız ürün miktarını eşleştirmeye başlar.',
        en: 'After you ship your order and issue your invoice, the system starts matching the products received into the warehouse against the quantity you invoiced, up to the due date.',
      },
      {
        tr: 'Mal alım sürecindeki kontrollerin ve barkod girişlerinin zaman alması nedeniyle sistem üzerinde adet farklılıkları oluşabilmektedir. Kontroller ve barkod girişleri tamamlandığında göndermiş olduğunuz ürünler “alındı” olarak işaretlenir ve Vendor Central hesabınıza yansır.',
        en: 'Because the checks and barcode entries in the goods-receipt process take time, quantity differences may appear in the system. When the checks and barcode entries are completed, the products you shipped are marked as “received” and reflected in your Vendor Central account.',
      },
      {
        tr: 'Eğer ürünleriniz faturanızın vade tarihinden önce sipariş emrinize “alındı” olarak işlenmez ise tarafınıza SCR ile biten bir eksik teslimat faturası kesilir.',
        en: 'If your products are not recorded as “received” on your purchase order before your invoice’s due date, a shortage invoice ending in SCR is issued to you.',
      },
      {
        tr: 'Eğer ürünlerin tamamını gönderdiğinizden eminseniz, oluşan bu miktar eksikliği için bir itiraz kaydı oluşturmanız istenecektir.',
        en: 'If you are sure you shipped all the products, you will be asked to create a dispute for this quantity shortage.',
      },
      {
        tr: 'İtiraz kaydını faturanızın vade tarihi dolduğunda oluşturabilirsiniz. Eğer vade tarihi dolmadan önce oluşan SCR faturasına itiraz etmeyi denerseniz sistem hata verecektir; bu nedenle vade tarihinin dolmasını beklemeniz gerekmektedir.',
        en: 'You can create the dispute once your invoice’s due date has passed. If you try to dispute an SCR invoice before its due date, the system will return an error, so you must wait for the due date to pass.',
      },
      {
        tr: 'Miktar eksikliği sebebiyle oluşan SCR ile biten kesintiye itiraz etmek için aşağıdaki adımları takip ediniz:',
        en: 'To dispute a deduction ending in SCR arising from a quantity shortage, follow the steps below:',
      },
      {
        tr: '1. Vendor Central hesabınıza giriş yapın.',
        en: '1. Sign in to your Vendor Central account.',
      },
      {
        tr: '2. Ödemeler > İtiraz Yönetimi adımlarını takip edin ve "Yeni itiraz oluştur" butonuna tıklayın.',
        en: '2. Follow Payments > Dispute Management and click the “Create new dispute” button.',
      },
      {
        tr: '3. İtiraz türü olarak "Eksik teslimat faturası"nı seçin.',
        en: '3. Select “Shortage invoice” as the dispute type.',
      },
      {
        tr: '4. "Girişleri ekle" yazan boşluğa fatura numaranızı sonuna SCR harflerini ekleyerek girin (XXXXXSCR) ve artı butonuna tıklayın; fatura numarası sağ boşluğa geçecektir.',
        en: '4. In the “Add entries” field, enter your invoice number with the letters SCR appended (XXXXXSCR) and click the plus button; the invoice number will move to the field on the right.',
      },
      {
        tr: '5. İtiraz edilecek sipariş numarasının yanındaki kutucuğu işaretleyin; miktarını, sevk edilen ürün sayısını ve sevk tarihini girerek sonraki adıma ilerleyin.',
        en: '5. Tick the box next to the purchase order number to be disputed; enter the quantity, the number of units shipped and the ship date, then proceed to the next step.',
      },
      {
        tr: '6. İtirazınızı detaylandırın; dilerseniz teslimat belgelerinizi Göz at kısmında ekleyebilirsiniz.',
        en: '6. Provide the details of your dispute; if you wish, you can attach your delivery documents via Browse.',
      },
      {
        tr: '7. Devam et butonuna tıklayın ve itirazınızı gönderin.',
        en: '7. Click Continue and submit your dispute.',
      },
      {
        tr: 'Gönderdiğiniz itirazları yine aynı adımları takip ederek ekranda bulunan İtirazların özeti başlığı altından takip edebilirsiniz.',
        en: 'You can track the disputes you have submitted under the Dispute Summary heading on the screen by following the same steps.',
      },
      {
        tr: 'İtirazları inceleyen ekibin farklı bir ekip olduğunu ve Tedarikçi Destek Ekibinin bu itirazlar üzerinde herhangi bir kontrolü olmadığını bildirmek isteriz.',
        en: 'Please note that the team reviewing disputes is a separate team, and the Vendor Support Team has no control over these disputes.',
      },
    ],
  },
  {
    no: 5,
    titleTr: 'Eksik Miktar Kesinti Faturaları (IQV ile Başlayan Faturalar)',
    titleEn: 'Shortage Quantity Deduction Invoices (Invoices Starting with IQV)',
    relatedClasses: [
      'Eksik Miktar Kesinti Faturasi',
      'Arsiv Eksik Miktar Kesinti Faturasi',
    ],
    paragraphs: [
      {
        tr: 'IQV ile başlayan kesinti faturaları, depolarımızda ilgili sipariş emrinde bulunan (tedarikçi tarafından gönderilecek olarak bildirilen) tüm ürünlerin giriş yapmaması durumunda oluşur.',
        en: 'Deduction invoices starting with IQV are created when not all of the products on the relevant purchase order (declared by the vendor as to be shipped) are received into our warehouses.',
      },
      {
        tr: 'Sistem, depomuza fiziksel olarak gelen siparişler ile sipariş emrindeki ürünleri eşleştirmeye çalışırken bu eksikliği tespit eder.',
        en: 'The system detects this shortage while matching the orders that physically arrive at our warehouse against the products on the purchase order.',
      },
      {
        tr: 'Bu eksikliğin, ilgili sipariş emrine istinaden kesilen faturanızın vade tarihinden sonraki 30 güne kadar giderilmemesi / tüm ürünlerin sistemde eşleşmemesi halinde sistem, IQV ile başlayan bir eksik miktar kesinti faturası oluşturur.',
        en: 'If this shortage is not resolved — that is, all products are not matched in the system — within 30 days after the due date of the invoice issued for the relevant purchase order, the system creates a shortage quantity deduction invoice starting with IQV.',
      },
      {
        tr: 'Bu faturalar, ürünlerin tarafınıza fiziksel olarak iade edileceği anlamını taşımaz; zira bu ürünler eksik geldiği için ödemesinin yapılmayacağı anlamına gelir, bu sebeple de kesinti faturası olarak anılabilir.',
        en: 'These invoices do not mean the products will be physically returned to you; since the products arrived short, it means they will not be paid for — which is why they are referred to as deduction invoices.',
      },
      {
        tr: 'Tarafınıza kesilen bu faturalar, ürün iadesi faturası olmamakla birlikte halihazırda mahsup olmuş miktarlar için kesilmiştir.',
        en: 'Although these invoices are not product-return invoices, they are issued for amounts that have already been offset.',
      },
      {
        tr: 'İade faturasına itiraz sürecinde yeni bir prosedüre geçmiş bulunmaktayız. İlgili değişiklikle birlikte artık tüm eksik ürün iade faturalarınıza (IQV ile başlayan), ön onay alınmadan ve tarafımıza bildirimde bulunmadan, ekteki şartları sağlayan iade faturası keserek itiraz sürecini başlatabilirsiniz.',
        en: 'We have moved to a new procedure for the return-invoice dispute process. With this change, you can now start the dispute process for all your shortage return invoices (starting with IQV) by issuing a counter return invoice that meets the attached conditions, without prior approval and without notifying us.',
      },
      {
        tr: 'Lütfen IQV itiraz işlemi için aşağıdaki adımları takip ediniz:',
        en: 'Please follow the steps below for the IQV dispute process:',
      },
      {
        tr: 'Oluşturacağınız iade faturasının (faturanızın türüne göre aşağıdaki kanallar aracılığıyla) gönderimini yapınız:',
        en: 'Send the return invoice you create (through the channels below, depending on your invoice type):',
      },
      {
        tr: '1. E-fatura ise GİB üzerinden',
        en: '1. If it is an e-invoice, via GİB (the Turkish Revenue Administration)',
      },
      {
        tr: 'a) E-Arşiv ise ist11-invoices@amazon.com adresine',
        en: 'a) If it is an e-Archive invoice, to ist11-invoices@amazon.com',
      },
      {
        tr: 'b) Kağıt fatura ise aşağıda iade fatura şartlarında yer alan ofis adresimize',
        en: 'b) If it is a paper invoice, to our office address given in the return invoice terms below',
      },
      {
        tr: 'c) (Fatura bize ulaştıktan 2 iş günü sonrası)',
        en: 'c) (2 business days after the invoice reaches us)',
      },
      {
        tr: '2. Daha sonra aşağıda belirtilen adımlar ile faturanızı inceleyecek ekibe yeni bir talep formu üzerinden ulaşınız:',
        en: '2. Then reach the team that will review your invoice via a new case form, following the steps below:',
      },
      {
        tr: 'a) Vendor Central > Destek > Bize Ulaşın > Ödemeler > Eksik Teslimat İçin Hak Talebi (SC) / Teslim Alındığında Ödeme (POR)',
        en: 'a) Vendor Central > Support > Contact Us > Payments > Shortage Claim (SC) / Pay on Receipt (POR)',
      },
      {
        tr: 'b) Satış faturasını, teslimat belgesini ve karşı iade faturanızın PDF formatını iletiniz.',
        en: 'b) Provide the sales invoice, the proof of delivery and a PDF of your counter return invoice.',
      },
      {
        tr: 'İlgili ekip itirazınızı değerlendirerek onay veya ret kararını, açtığınız talep formu üzerinden size ileteceklerdir.',
        en: 'The relevant team will evaluate your dispute and communicate the approval or rejection decision to you through the case form you opened.',
      },
    ],
  },
  {
    no: 6,
    titleTr: 'Fiyat Farkı Kesinti Faturaları (IPV ile Başlayan Faturalar)',
    titleEn: 'Price Difference Deduction Invoices (Invoices Starting with IPV)',
    relatedClasses: [
      'Fiyat Farki Kesinti Faturasi',
      'Arsiv Fiyat Farki Kesinti Faturasi',
      'Fiyat Farki Kesinti Bildirimi',
      'Fiyat Farki Kesinti Bildirimi Ters Kayit',
    ],
    paragraphs: [
      {
        tr: 'IPV ile başlayan faturalar, tarafınızdan kesilen bir faturanın tutarının ilgili sipariş emri tutarından fazla kesilmiş olması durumunda ortaya çıkar.',
        en: 'Invoices starting with IPV arise when an invoice you issued exceeds the amount of the relevant purchase order.',
      },
      {
        tr: 'Örnekle anlatmak gerekirse; XXX numaralı sipariş emrinin tutarı toplamda 2.300 lira iken kestiğiniz fatura tutarı 2.700 lira ise, burada maliyetinden fazla fatura kesmiş olduğunuzdan bir fiyat farkı kesinti faturası oluşur.',
        en: 'For example, if the total of purchase order XXX is 2,300 lira and the invoice you issued is 2,700 lira, a price difference deduction invoice is created because you invoiced above the cost.',
      },
      {
        tr: 'Artık, önceden PC (Price Claim) ile gösterilen fiyat farkı kesinti bildirimleri IPV/APV ile başlayan faturalar ile faturalandırılmaktadır.',
        en: 'Price difference deduction notifications, previously shown as PC (Price Claim), are now invoiced through invoices starting with IPV/APV.',
      },
      {
        tr: 'Tarafınıza kesilen bu faturalardaki tutarlara bir itirazınız olması dahilinde; Vendor Central > Destek > Bize Ulaşın > Ödemeler > Fiyat Hak Talebi (PC) bölümünden tarafımıza yeni bir işlem kaydı açarak, mesajınızda kestiğiniz faturadaki ürün birim tutarlarının tarafınıza açtığımız sipariş emrindeki birim tutarından neden farklı bir tutarda oluşturulduğunu belirtip orijinal faturanızın bir kopyasını PDF olarak ekleyerek itirazınızı başlatabilirsiniz.',
        en: 'If you dispute the amounts on these invoices, you can start your dispute by opening a new case with us via Vendor Central > Support > Contact Us > Payments > Price Claim (PC), stating in your message why the unit amounts on your invoice differ from the unit amounts on the purchase order we opened for you, and attaching a PDF copy of your original invoice.',
      },
    ],
  },
  {
    no: 7,
    titleTr: 'Erken Ödeme İndirimi (QPD) Faturaları (IFC ile Başlayan Faturalar)',
    titleEn: 'Quick Pay Discount (QPD) Invoices (Invoices Starting with IFC)',
    relatedClasses: ['QPD'],
    paragraphs: [
      {
        tr: 'Bu faturalar tarafınıza belirli ürünler ya da faturalar için kesilmemiştir. Vade tarihi gelmeden önce ödeme (erken ödeme kesintisi) yaptığımızdan, hızlı ödeme kesintilerine istinaden oluşturulur.',
        en: 'These invoices are not issued to you for specific products or invoices. They are created for quick-payment deductions, because we pay before the due date (early-payment deduction).',
      },
      {
        tr: 'Bu kesintiler, Amazon ile yaptığınız anlaşmaya istinaden hızlı ödeme indirimleri (Amazon’un vade tarihinden önce yaptığı ödemeler) için yapılır. İlgili faturalar yalnızca muhasebesel amaç için oluşturulur ve bu faturalar için herhangi bir ödeme beklenmemektedir.',
        en: 'These deductions are made for quick-payment discounts (payments Amazon makes before the due date) under your agreement with Amazon. The invoices are created for accounting purposes only, and no payment is expected for them.',
      },
      {
        tr: 'Vendor Central > Ayarlar > Sözleşmeler > Kabul Edildi/Reddedildi > Satın Alma Şartları’nda aktif bulunan ilgili sözleşmeye istinaden Amazon, ödemelerinizi vade tarihinden önce ilgili oranda kesinti yaparak gerçekleştirebilir.',
        en: 'Per the agreement active under Vendor Central > Settings > Agreements > Accepted/Rejected > Purchase Terms, Amazon may make your payments before the due date with the corresponding deduction rate applied.',
      },
      {
        tr: 'Örneğin anlaşmada yer alan ibare 7NET, %2 ise; Amazon, vade tarihinden önceki 7 gün içerisinde faturanızın ödemesini yaptığı takdirde toplam ödenen fatura tutarınızdan %2’lik bir indirim alır. Eğer ödeme, belirlenen erken ödeme tarihinden sonra yapılırsa Amazon herhangi bir erken ödeme kesintisi yapmaz.',
        en: 'For example, if the term in the agreement is 7NET, 2%, and Amazon pays your invoice within 7 days before the due date, it takes a 2% discount off your total paid invoice amount. If the payment is made after the specified early payment date, Amazon does not apply any early payment discount.',
      },
      {
        tr: 'İlgili anlaşmalar gereğince Amazon’un, vade tarihinden önce yapılan ödeme sonucu yaptığı kesinti için tedarikçi firmaya önceden bildirim verme ve ilgili tedarikçi firmadan izin alma sorumluluğu bulunmamaktadır.',
        en: 'Under the relevant agreements, Amazon has no obligation to give prior notice to, or obtain permission from, the vendor for deductions made as a result of payments before the due date.',
      },
      {
        tr: 'Bu faturalar ile alakalı bir hesap dökümü bulunmamaktadır.',
        en: 'There is no account statement associated with these invoices.',
      },
    ],
  },
];
