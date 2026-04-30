import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

const IDB_NAME = "studiolo-db";
const IDB_STORE = "pdf-images";
const IDB_VERSION = 1;

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveImagesToIDB(id: string, images: PdfPageImage[]): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(images, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadImagesFromIDB(id: string): Promise<PdfPageImage[]> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteImagesFromIDB(id: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface TextMetadata {
  x: number;
  y: number;
  size: number;
}

export interface PdfPageImage {
  src: string;
  width: number;
  height: number;
  textData: TextMetadata[];
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

export async function convertPdfToImages(file: File): Promise<{images: PdfPageImage[], bodySize: number}> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: PdfPageImage[] = [];
  
  const fontSizeVotes: Record<number, number> = {};
  const scanLimit = Math.min(pdf.numPages, 10); 

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 3.0 }); 
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const textContent = await page.getTextContent();
    const textData = textContent.items.map((item: any) => {
      const size = Math.round(item.transform[0]);
      if (i <= scanLimit) {
        fontSizeVotes[size] = (fontSizeVotes[size] || 0) + 1;
      }
      return { x: item.transform[4], y: item.transform[5], size };
    });

    if (context) {
      await page.render({ canvasContext: context, viewport }).promise;
      images.push({
        src: canvas.toDataURL(),
        width: viewport.width,
        height: viewport.height,
        textData,
      });
    }
  }

  let detectedBodySize = 12; 
  let maxVotes = 0;
  Object.entries(fontSizeVotes).forEach(([size, votes]) => {
    if (votes > maxVotes && Number(size) > 6) {
      maxVotes = votes;
      detectedBodySize = Number(size);
    }
  });

  return { images, bodySize: detectedBodySize };
}