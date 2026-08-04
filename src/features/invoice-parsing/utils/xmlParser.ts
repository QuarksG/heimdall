import { NAMESPACES } from '../constants/namespaces';
import type { FieldDefinition } from '../constants/fieldDefinitions';
import { initialFieldDefinitions } from '../constants/fieldDefinitions';

export interface TaxSchemePair {
  code: string;
  name: string;
}

/**
 * GİB tax type code → canonical scheme name.
 * Used as fallback when a TaxScheme omits <cbc:Name> (the code is the
 * authoritative field; the name is optional in practice).
 */
const TAX_TYPE_CODE_NAMES: Record<string, string> = {
  '0015': 'KDV',
  '0071': 'ÖTV', // Petrol ve doğalgaz ürünleri (I sayılı liste)
  '0073': 'ÖTV', // Kolalı gazoz, alkollü içecek ve tütün mamulleri
  '0074': 'ÖTV', // Dayanıklı tüketim ve diğer mallar
  '0075': 'ÖTV', // Alkollü içecekler
  '0076': 'ÖTV', // Tütün mamulleri
  '0077': 'ÖTV', // Kolalı gazozlar
};

export class XMLToExcelConverter {
  xpathEvaluator: XPathEvaluator;

  constructor() {
    this.xpathEvaluator = new XPathEvaluator();
  }


  static readonly namespaceResolver = (prefix: string | null): string | null => {
    if (!prefix) return null;
    return NAMESPACES[prefix] ?? null;
  };

 

  
  public extractFieldByKey(context: Document | Node, fieldKey: string): string {
    const def = initialFieldDefinitions.find(f => f.key === fieldKey);
    if (!def) return 'Unknown';
    return this.extractValue(context, def);
  }

 
  public extractFieldResult(
    context: Document | Node,
    fieldKey: string
  ): { found: boolean; value: string } {
    const def = initialFieldDefinitions.find(f => f.key === fieldKey);
    if (!def || !def.xpaths) return { found: false, value: '' };

    for (const xpath of def.xpaths) {
      try {
        const node = this.xpathEvaluator.evaluate(
          xpath,
          context,
          XMLToExcelConverter.namespaceResolver,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue as Element;

        if (node) {
          const val = def.attribute
            ? (node.getAttribute(def.attribute) ?? '').trim()
            : (node.textContent ?? '').trim();
          return { found: true, value: val };
        }
      } catch (e) {
        console.error(`XPath error for ${fieldKey}:`, e);
      }
    }
    return { found: false, value: '' };
  }

 
  public getNodesByXPath(context: Document | Node, xpath: string): Node[] {
    try {
      const snapshot = this.xpathEvaluator.evaluate(
        xpath,
        context,
        XMLToExcelConverter.namespaceResolver,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      const nodes: Node[] = [];
      for (let i = 0; i < snapshot.snapshotLength; i++) {
        const n = snapshot.snapshotItem(i);
        if (n) nodes.push(n);
      }
      return nodes;
    } catch (e) {
      console.error('XPath nodes error:', e);
      return [];
    }
  }

  

  public evaluateSingle(node: Node, xpath: string): string | null {
    const res = this.xpathEvaluator.evaluate(
      xpath,
      node,
      (prefix) => (prefix ? NAMESPACES[prefix] || null : null),
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
    return res ? res.textContent : null;
  }

 

  transformXML(xmlContent: string): Document | null {
    try {
      const parser = new DOMParser();
      return parser.parseFromString(xmlContent, 'application/xml');
    } catch (e) {
      console.error('Error transforming XML:', e);
      return null;
    }
  }

  extractValue(node: Node, definition: FieldDefinition): string {
    if (definition.customHandler && typeof (this as any)[definition.customHandler] === 'function') {
      return (this as any)[definition.customHandler](node);
    }

    if (definition.xpaths && definition.xpaths.length > 0) {
      if (definition.key === 'Notes' || definition.key === 'musterino') {
        return this.extractAll(node, definition.xpaths[0]);
      }

      for (const path of definition.xpaths) {
        const result = this.xpathEvaluator.evaluate(
          path,
          node,
          (prefix) => (prefix ? NAMESPACES[prefix] || null : null),
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue as Element;

        if (result) {
          return definition.attribute
            ? (result.getAttribute(definition.attribute) || '')
            : (result.textContent || '');
        }
      }
    }
    return 'Unknown';
  }

  private extractAll(node: Node, xpath: string): string {
    const result = this.xpathEvaluator.evaluate(
      xpath,
      node,
      (prefix) => (prefix ? NAMESPACES[prefix] || null : null),
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const values: string[] = [];
    for (let i = 0; i < result.snapshotLength; i++) {
      values.push(result.snapshotItem(i)?.textContent || '');
    }
    return values.join(', ');
  }

  /** ÖTV (special consumption tax) GİB code family. */
  private static readonly OTV_CODES = new Set(['0071', '0073', '0074', '0075', '0076', '0077']);

  /**
   * Splits a line's TaxSubtotals into KDV and ÖTV parts, keyed by
   * TaxTypeCode (0015 = KDV, 0071–0077 = ÖTV) with a name-based fallback
   * when the code is missing.
   *
   * Note the cascade on ÖTV-liable lines: KDV base = LineExtensionAmount
   * + ÖTV amount (KDV Kanunu m.24), so kdvBase intentionally differs from
   * the line net on those lines.
   */
  private collectLineTaxParts(lineNode: Node): { kdvBase: number | null; kdvAmount: number | null; otvAmount: number | null } {
    let kdvBase: number | null = null;
    let kdvAmount: number | null = null;
    let otvAmount: number | null = null;

    const subtotals = this.getNodesByXPath(lineNode, './/cac:TaxTotal/cac:TaxSubtotal');
    for (const st of subtotals) {
      const code = (this.evaluateSingle(st, './cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode') ?? '').trim();
      const name = (this.evaluateSingle(st, './cac:TaxCategory/cac:TaxScheme/cbc:Name') ?? '').trim().toLocaleUpperCase('tr-TR');
      const taxable = parseFloat(this.evaluateSingle(st, './cbc:TaxableAmount') ?? '');
      const amount = parseFloat(this.evaluateSingle(st, './cbc:TaxAmount') ?? '');

      const isKdv = code === '0015' || (!code && (name === 'KDV' || name.includes('KATMA DEĞER')));
      const isOtv = XMLToExcelConverter.OTV_CODES.has(code) || (!code && (name === 'ÖTV' || name.includes('ÖZEL TÜKETİM')));

      if (isKdv) {
        if (!Number.isNaN(taxable)) kdvBase = (kdvBase ?? 0) + taxable;
        if (!Number.isNaN(amount)) kdvAmount = (kdvAmount ?? 0) + amount;
      } else if (isOtv) {
        if (!Number.isNaN(amount)) otvAmount = (otvAmount ?? 0) + amount;
      }
    }
    return { kdvBase, kdvAmount, otvAmount };
  }

  extractLineKdvBase(lineNode: Node): string {
    const v = this.collectLineTaxParts(lineNode).kdvBase;
    return v == null ? '' : v.toFixed(2);
  }

  extractLineKdvAmount(lineNode: Node): string {
    const v = this.collectLineTaxParts(lineNode).kdvAmount;
    return v == null ? '' : v.toFixed(2);
  }

  extractLineOtvAmount(lineNode: Node): string {
    const v = this.collectLineTaxParts(lineNode).otvAmount;
    return v == null ? '' : v.toFixed(2);
  }

  /**
   * Extracts (TaxTypeCode, Name) pairs from TaxSubtotal nodes, reading both
   * values from the SAME node so they can never be mismatched.
   *
   * Background: some vendors (e.g. Kuzey Pet) omit <cbc:Name> on KDV
   * subtotals while ÖTV subtotals carry both Name and TaxTypeCode. Two
   * independent first-match XPaths then pair the ÖTV name with the KDV
   * code (0015). Pairing per node + code-based name fallback fixes this.
   *
   * Pairs are deduplicated by TaxTypeCode (the authoritative field),
   * preserving document order.
   */
  extractTaxSchemePairs(context: Node, subtotalXPath: string): TaxSchemePair[] {
    const pairs: TaxSchemePair[] = [];
    const seen = new Set<string>();

    const nodes = this.getNodesByXPath(context, subtotalXPath);
    for (const node of nodes) {
      const code = (this.evaluateSingle(node, './cac:TaxCategory/cac:TaxScheme/cbc:TaxTypeCode') ?? '').trim();
      let name = (this.evaluateSingle(node, './cac:TaxCategory/cac:TaxScheme/cbc:Name') ?? '').trim();

      if (!name) name = TAX_TYPE_CODE_NAMES[code] ?? code;
      if (!code && !name) continue;

      const key = code || name;
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({ code, name });
    }
    return pairs;
  }

  extractDocTaxNames(xmlDoc: Node): string {
    const pairs = this.extractTaxSchemePairs(
      xmlDoc,
      '//cac:TaxTotal[not(ancestor::cac:InvoiceLine)]/cac:TaxSubtotal'
    );
    return pairs.length > 0 ? pairs.map(p => p.name).join(', ') : 'Unknown';
  }

  extractDocTaxTypeCodes(xmlDoc: Node): string {
    const pairs = this.extractTaxSchemePairs(
      xmlDoc,
      '//cac:TaxTotal[not(ancestor::cac:InvoiceLine)]/cac:TaxSubtotal'
    );
    return pairs.length > 0 ? pairs.map(p => p.code || 'Unknown').join(', ') : 'Unknown';
  }

  extractCustomerAddress(xmlDoc: Node): string {
    const addressParts = [
      '//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:StreetName',
      '//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:BuildingNumber',
      '//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CitySubdivisionName',
      '//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CityName',
      '//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:PostalZone',
      '//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:Name',
    ];
    const lines = [];
    for (const part of addressParts) {
      const val = this.evaluateSingle(xmlDoc, part);
      if (val) lines.push(val);
    }
    return lines.join(', ') || 'Unknown';
  }

  extractInvoiceRef(xmlDoc: Node): string {
    let id = this.evaluateSingle(xmlDoc, '//cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID');
    if (id) return id;

    const refs = this.xpathEvaluator.evaluate(
      '//*[local-name()="AdditionalDocumentReference"]/*[local-name()="ID"]',
      xmlDoc,
      (prefix) => (prefix ? NAMESPACES[prefix] || null : null),
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0; i < refs.snapshotLength; i++) {
      const txt = refs.snapshotItem(i)?.textContent;
      if (txt && txt.length > 8) return txt;
    }
    return 'Unknown';
  }

  extractDeliveryNote(xmlDoc: Node): string {
    const despatchRefs = this.xpathEvaluator.evaluate(
      '//cac:DespatchDocumentReference',
      xmlDoc,
      (prefix) => (prefix ? NAMESPACES[prefix] || null : null),
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0; i < despatchRefs.snapshotLength; i++) {
      const node = despatchRefs.snapshotItem(i) as Element;
      const typeCode = this.evaluateSingle(node, './/cbc:DocumentTypeCode');
      if (typeCode === 'ERP_DELIVERY_NUMBER') {
        const id = this.evaluateSingle(node, './/cbc:ID');
        if (id) return id;
      }
    }

    const directID = this.evaluateSingle(xmlDoc, '//cac:DespatchDocumentReference/cbc:ID');
    if (directID) return directID;

    const addRefs = this.xpathEvaluator.evaluate(
      '//cac:AdditionalDocumentReference',
      xmlDoc,
      (prefix) => (prefix ? NAMESPACES[prefix] || null : null),
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0; i < addRefs.snapshotLength; i++) {
      const node = addRefs.snapshotItem(i) as Node;
      const type = this.evaluateSingle(node, './/cbc:DocumentType');
      if (type && type.includes('İrsaliye')) {
        const id = this.evaluateSingle(node, './/cbc:ID');
        if (id) return id;
      }
    }

    const notes = this.xpathEvaluator.evaluate(
      '//cbc:Note',
      xmlDoc,
      (prefix) => (prefix ? NAMESPACES[prefix] || null : null),
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    for (let i = 0; i < notes.snapshotLength; i++) {
      const txt = notes.snapshotItem(i)?.textContent || '';
      if (txt.includes('İrsaliye')) {
        const match = /İrsaliye No[: ]+(\S+)/i.exec(txt);
        if (match) return match[1];
        return txt;
      }
    }
    return 'Unknown';
  }

  extractDataForExcel(xmlDoc: Document, definitions: FieldDefinition[]): any[] {
    if (!xmlDoc) return [];

    const headerDefs = definitions.filter(d => !d.isLineItem);
    const lineDefs = definitions.filter(d => d.isLineItem);

    const headerData: any = {};
    headerDefs.forEach(def => {
      headerData[def.key] = this.extractValue(xmlDoc, def);
    });

    if (lineDefs.length === 0) return [headerData];

    const lineItems = this.processLineItems(xmlDoc, lineDefs, headerData);

    if (lineItems.length === 0) {
      const emptyLine: any = {};
      lineDefs.forEach(d => (emptyLine[d.key] = 'Unknown'));
      return [{ ...headerData, ...emptyLine }];
    }

    return lineItems.map(item => ({
      ...headerData,
      ...item
    }));
  }

  processLineItems(xmlDoc: Node, lineDefs: FieldDefinition[], headerData: any): any[] {
    const rows: any[] = [];

    let type = 'InvoiceLine';
    let snapshot = this.xpathEvaluator.evaluate(
      '//cac:InvoiceLine',
      xmlDoc,
      (p) => (p ? NAMESPACES[p] || null : null),
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );

    if (snapshot.snapshotLength === 0) {
      type = 'DespatchLine';
      snapshot = this.xpathEvaluator.evaluate(
        '//cac:DespatchLine',
        xmlDoc,
        (p) => (p ? NAMESPACES[p] || null : null),
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
    }

    const docTaxAmt = headerData['doc_tax_amount'] || 'Unknown';
    const docTaxCurr = headerData['doc_tax_currency'] || 'Unknown';
    const docTaxRate = headerData['doc_tax_rate'] || 'Unknown';

    for (let i = 0; i < snapshot.snapshotLength; i++) {
      const lineNode = snapshot.snapshotItem(i) as Node;
      const rowData: any = {};

      lineDefs.forEach(def => {
        if (type === 'DespatchLine' && (def.key === 'unit_price'|| def.key.includes('discount')|| def.key === 'line_total' || def.key.includes('tax') || def.key.includes('kdv') || def.key.includes('otv'))) {
          rowData[def.key] = 'N/A';
        } else {
          let val = this.extractValue(lineNode, def);
          if (val === 'Unknown' && type === 'InvoiceLine') {
            if (def.key === 'tax_amount') val = docTaxAmt;
            if (def.key === 'tax_currency') val = docTaxCurr;
            if (def.key === 'tax_rate') val = docTaxRate;
          }
          rowData[def.key] = val;
        }
      });

      // Tax Type / Tax Type Code: prefer this line's own TaxSubtotals over the
      // document-level value, so multi-tax lines (e.g. KDV + ÖTV) show all of
      // their schemes correctly paired. Falls back to headerData when the line
      // carries no tax scheme info.
      if (type === 'InvoiceLine') {
        const linePairs = this.extractTaxSchemePairs(lineNode, './/cac:TaxTotal/cac:TaxSubtotal');
        if (linePairs.length > 0) {
          rowData['doc_tax_name'] = linePairs.map(p => p.name).join(', ');
          rowData['doc_tax_type_code'] = linePairs.map(p => p.code || 'Unknown').join(', ');
        }
      }

      rows.push(rowData);
    }
    return rows;
  }
}