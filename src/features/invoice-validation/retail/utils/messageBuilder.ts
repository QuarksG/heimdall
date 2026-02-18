const stripIndent = (html: string) =>
  html
    .replace(/^\s{2,}/gm, "")
    .replace(/>\s+</g, "><")
    .trim();

export const getInitialGreeting = (): string =>
  stripIndent(`
    <div class="greeting-card" style="width:94%;max-width:1040px;margin:0 auto;padding:32px 40px;border-radius:22px;background:#fff;border:1px solid rgba(0,0,0,0.06);box-shadow:0 2px 10px rgba(0,0,0,0.06);line-height:1.6;">
      <p class="greeting-title" style="margin:0 0 18px 0;font-weight:700;">
        Faturanızın XML formatını yükleyerek aşağıdaki XML satırlarının Amazon standartlarına uygun olup olmadığını doğrulayabilirsiniz:
      </p>

      <p class="greeting-subtitle" style="margin:0 0 22px 0;">
        Bu araç, faturanıza ait aşağıdaki XML satırlarını doğrular:
      </p>

      <div class="xml-list" style="display:flex;flex-direction:column;gap:26px;margin:0 0 22px 0;">
        <p class="xml-item" style="margin:0;"><strong>cbc:InvoiceTypeCode:</strong> Fatura türü</p>
        <p class="xml-item" style="margin:0;"><strong>cbc:Musterino:</strong> Müşteri No</p>
        <p class="xml-item" style="margin:0;"><strong>cac:OrderReference/cbc:ID:</strong> Amazon sipariş numarası</p>
        <p class="xml-item" style="margin:0;"><strong>cac:BuyersItemIdentification/cbc:ID:</strong> ASIN veya ürün kodları</p>
        <p class="xml-item" style="margin:0;"><strong>cac:AccountingCustomerParty/cbc:ID:</strong> Amazon Address</p>
        <p class="xml-item" style="margin:0;"><strong>cac:LineExtensionAmount/cbc:ID:</strong> KDV/Vergi detayları</p>
        <p class="xml-item" style="margin:0;"><strong>cbc:Note:</strong> Amazon Retail AP için iade faturaları ve onlara özgü ek notlar</p>
      </div>

      <p class="greeting-footnote" style="margin:0;">
        Doğrulamaya başlamak için bir XML veya birden fazla xml dosyasını hızlıca yüklemek için bir zip dosyası halinde de yükleyebilirsiniz.
        Bu araç, teknik sorunları (mükerrer PO numarası, iade faturası yerine satış faturası, PO numarasında belirtilen tutardan fazla fiyat girmek ve diğer teknik sorunları)
        kontrol etmemektedir.
      </p>
    </div>
  `);

export const getFixAndResendBlock = (): string =>
  stripIndent(`
    <p style="margin:0 0 10px 0;">Lütfen yukarıdaki hataları düzelterek faturayı yeniden gönderiniz. Sorularınız olursa bizimle iletişime geçebilirsiniz.</p>
    <p style="margin:0 0 10px 0;">Bizimle iletişime geçmek için destek kaydı oluşturmanız gerekmektedir. Faturalarla ilgili destek kaydı için aşağıdaki adımları takip ederek destek kaydı oluşturmanızı rica ederiz:</p>
    <p style="margin:0;">Vendor Central &gt; Destek &gt; Bize Ulaşın &gt; Ödemeler &gt; Fatura iptali ve eski durumuna getirme</p>
    <p style="margin:0;">Teşekkür ederiz.</p>
  `);

export const getContactSupportBlock = (): string =>
  stripIndent(`
    <p style="margin:0 0 10px 0;">Bizimle iletişime geçmek için destek kaydı oluşturmanız gerekmektedir. Faturalarla ilgili destek kaydı için aşağıdaki adımları takip ederek destek kaydı oluşturmanızı rica ederiz:</p>
    <p style="margin:0 0 10px 0;">Vendor Central &gt; Destek &gt; Bize Ulaşın &gt; Ödemeler &gt; Fatura iptali ve eski durumuna getirme</p>
    <p style="margin:0;">Teşekkür ederiz.</p>
  `);
