export const wrapText = (text: string | null | undefined, maxChars = 60): string => {
  if (!text) return '';
  const str = String(text);
  if (str.length <= maxChars) return str;
  

  const chunks = str.match(new RegExp(`.{1,${maxChars}}`, 'g'));
  return chunks ? chunks.join('\n') : str;
};