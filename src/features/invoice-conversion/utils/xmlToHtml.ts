import { decodeBase64Native, safeExtractAttr } from './formatters';
import { extractInvoiceData } from '../../invoice-parsing/utils/dataExtractor';
import type { ExtractedInvoiceData } from '../../invoice-parsing/utils/dataExtractor';

export interface ParsedInvoice extends ExtractedInvoiceData {
  path: string;
  rawXml: string;
  blobUrl: string;
  htmlContent: string;
  xmlUrl: string;
  digestValue: string;
}

export const xmlToHtml = (fileName: string, xmlContent: string): ParsedInvoice => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");
    
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) throw new Error("Invalid XML structure");

    const extractedData = extractInvoiceData(xmlContent);

    let xsltContent = "";
    const embeddedObjects = xmlDoc.getElementsByTagNameNS('*', 'EmbeddedDocumentBinaryObject');
    
    for (let i = 0; i < embeddedObjects.length; i++) {
      const element = embeddedObjects[i];
      const filenameAttr = safeExtractAttr(element, 'filename', '')?.toLowerCase();
      const formatAttr = safeExtractAttr(element, 'format', '')?.toLowerCase();
      
      if (filenameAttr?.endsWith('.xslt') || filenameAttr?.endsWith('.xsl') || formatAttr === 'xslt') {
        xsltContent = decodeBase64Native(element.textContent || '') || '';
        if (xsltContent) break;
      }
    }

    if (!xsltContent) {
      const legacyObjects = xmlDoc.getElementsByTagName('EmbeddedDocumentBinaryObject');
      for (let i = 0; i < legacyObjects.length; i++) {
        const element = legacyObjects[i];
        const filenameAttr = safeExtractAttr(element, 'filename', '')?.toLowerCase();
        if (filenameAttr?.includes('.xsl')) {
          xsltContent = decodeBase64Native(element.textContent || '') || '';
          if (xsltContent) break;
        }
      }
    }

    if (!xsltContent) throw new Error("XSLT stylesheet missing from invoice");

    const xsltProcessor = new XSLTProcessor();
    const xslStylesheet = parser.parseFromString(xsltContent, "text/xml");
    
    const xsltParserError = xslStylesheet.querySelector("parsererror");
    if (xsltParserError) throw new Error("Corrupt XSLT stylesheet");

    xsltProcessor.importStylesheet(xslStylesheet);
    
    const resultFragment = xsltProcessor.transformToFragment(xmlDoc, document);
    const tempContainer = document.createElement('div');
    tempContainer.appendChild(resultFragment);

    const finalHtml = `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <title>Invoice Preview</title>
</head>
<body>
    ${tempContainer.innerHTML}
</body>
</html>`;
    
    const blob = new Blob([finalHtml], { type: "text/html;charset=utf-8;" });
    const blobUrl = URL.createObjectURL(blob);
    const xmlUrl = URL.createObjectURL(new Blob([xmlContent], { type: "text/xml;charset=utf-8;" }));

    const digestValueResult = xmlDoc.evaluate(
      '//ds:DigestValue',
      xmlDoc,
      (prefix) => prefix === 'ds' ? 'http://www.w3.org/2000/09/xmldsig#' : null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;

    return {
      ...extractedData,
      path: fileName,
      rawXml: xmlContent,
      blobUrl,
      htmlContent: finalHtml,
      xmlUrl,
      digestValue: digestValueResult?.textContent || ''
    };

  } catch (error: any) {
    console.error(`XML Processing Error for ${fileName}:`, error);
    throw new Error(`Parsing Failed: ${error.message}`);
  }
};