export const decodeBase64Native = (base64Str: string): string | null => {
  try {
    const cleanStr = base64Str.replace(/\s/g, '');
    const binaryString = window.atob(cleanStr);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  } catch (error) {
    console.error('TextDecoder error:', error);
    return null;
  }
};

export const formatPrice = (price: number, currency = 'TRY'): string => {
  try {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: currency,
    }).format(price || 0);
  } catch (error) {
    return `${price || 0} ${currency}`;
  }
};

export const safeExtractText = (node: any, fallback: string | null = null): string | null => {
  try {
    return node?.textContent || node?.innerHTML || fallback;
  } catch (error) {
    return fallback;
  }
};

export const safeExtractAttr = (node: any, attrName: string, fallback: string | null = null): string | null => {
  try {
    return node?.getAttribute(attrName) || fallback;
  } catch (error) {
    return fallback;
  }
};