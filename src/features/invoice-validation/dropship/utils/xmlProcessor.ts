import JSZip from 'jszip';

export type ProcessedFile = {
  fileName: string;
  xmlDoc: Document;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const parseXmlString = (xmlContent: string): Document | null => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
    const parserErrors = xmlDoc.getElementsByTagName('parsererror');
    if (parserErrors.length > 0) {
      console.error('XML parse hatası:', parserErrors[0].textContent);
      return null;
    }
    return xmlDoc;
  } catch (e) {
    console.error('XML dönüştürme hatası:', e);
    return null;
  }
};

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });

export const processUploadedFile = async (
  file: File
): Promise<{ files: ProcessedFile[]; error: string | null }> => {
  if (file.size > MAX_FILE_SIZE) {
    return { files: [], error: 'Dosya boyutu çok büyük. Lütfen 100MB\'dan küçük bir dosya yükleyin.' };
  }

  const fileName = file.name.toLowerCase();
  const isXML = fileName.endsWith('.xml');
  const isZip = fileName.endsWith('.zip');

  if (!isXML && !isZip) {
    return { files: [], error: 'Lütfen geçerli bir XML veya ZIP dosyası yükleyin.' };
  }

  try {
    if (isXML) {
      const content = await readFileAsText(file);
      const xmlDoc = parseXmlString(content);
      if (!xmlDoc) {
        return { files: [], error: `${file.name}: XML dosyası okunamadı.` };
      }
      return { files: [{ fileName: file.name, xmlDoc }], error: null };
    }

  
    const zip = await JSZip.loadAsync(file);
    const xmlFiles = zip.file(/.*\.xml$/i);

    if (xmlFiles.length === 0) {
      return { files: [], error: 'ZIP arşivinde XML dosyası bulunamadı.' };
    }

    const results: ProcessedFile[] = [];
    for (const entry of xmlFiles) {
      const content = await entry.async('text');
      const xmlDoc = parseXmlString(content);
      if (xmlDoc) {
        results.push({ fileName: entry.name, xmlDoc });
      }
    }

    return { files: results, error: null };
  } catch (err) {
    return { files: [], error: `Dosya işlenirken hata oluştu: ${(err as Error).message}` };
  }
};