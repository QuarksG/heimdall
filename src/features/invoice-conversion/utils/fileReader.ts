export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export const FILE_ACCEPT = {
  'application/xml': ['.xml'],
  'application/zip': ['.zip']
};

export const readFile = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`File ${file.name} exceeds maximum size of 100MB`));
      return;
    }
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    fr.readAsText(file);
  });
};

export const readFileBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error(`File ${file.name} exceeds maximum size of 100MB`));
      return;
    }
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(new Error(`Failed to read file buffer: ${file.name}`));
    fr.readAsArrayBuffer(file);
  });
};