import { useDropzone as useReactDropzone } from 'react-dropzone';
import type { DropzoneOptions } from 'react-dropzone';

export const useDropzone = (options: DropzoneOptions) => {
  return useReactDropzone(options);
};