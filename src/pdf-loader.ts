import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export interface TextMetadata {
  x: number;
  y: number;
  size: number;
}

export interface PdfPageImage {
  src: string;
  width: number;
  height: number;
  textData: TextMetadata[]; // This stores the font sizes and positions
}

export async function createSmallThumbnail(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 0.4 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  if (context) {
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.75);
  }
  return "";
}

export async function convertPdfToImages(file: File): Promise<PdfPageImage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: PdfPageImage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 3.0 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // --- NEW: Extract Text Metadata ---
    const textContent = await page.getTextContent();
    const textData: TextMetadata[] = textContent.items.map((item: any) => ({
        // transform[4] is X, transform[5] is Y, transform[0] is font size
        x: item.transform[4],
        y: item.transform[5],
        size: item.transform[0],
    }));

    if (context) {
      await page.render({ canvasContext: context, viewport }).promise;
      images.push({
        src: canvas.toDataURL(),
        width: viewport.width,
        height: viewport.height,
        textData, // Save the text info here
      });
    }
  }
  return images;
}