import { NAMESPACES } from '../constants/namespaces';
import type { FieldDefinition } from '../constants/fieldDefinitions';
import { initialFieldDefinitions } from '../constants/fieldDefinitions';

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
        if (type === 'DespatchLine' && (def.key === 'unit_price' || def.key === 'line_total' || def.key.includes('tax'))) {
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
      rows.push(rowData);
    }
    return rows;
  }
}