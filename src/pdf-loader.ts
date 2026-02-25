import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export interface PdfPageImage {
  src: string;
  width: number;
  height: number;
}

export async function convertPdfToImages(file: File): Promise<PdfPageImage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: PdfPageImage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    
    // THE FIX: We bumped the scale from 1.5 to 3.0! 
    // (You can even push this to 4.0 if you want it insanely sharp, 
    // though it might take a few seconds longer to load)
    const viewport = page.getViewport({ scale: 3.0 });
    
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    if (context) {
      await page.render({ canvasContext: context, viewport }).promise;
      
      images.push({
        src: canvas.toDataURL(), // Converts the high-res canvas into the image
        width: viewport.width,
        height: viewport.height
      });
    }
  }
  return images;
}