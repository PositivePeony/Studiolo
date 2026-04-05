import React, { useState, useEffect, useRef } from "react";
import {
  Tldraw,
  createShapeId,
  AssetRecordType,
  useEditor,
  useValue,
  type TLComponents,
  useTools,
  DefaultToolbar,
  TldrawUiMenuItem
} from "tldraw";
import "tldraw/tldraw.css";
import "./App.css";
import { convertPdfToImages, createSmallThumbnail, type PdfPageImage } from "./pdf-loader";

const STORAGE_KEY = "studiolo-pdfs";

interface StoredPdfMeta {
  id: string;
  name: string;
  thumbnail: string;
}

// --- TYPES ---
interface PdfEntry {
  id: string;
  name: string;
  images: PdfPageImage[];
  thumbnail: string;
}

interface Tab {
  id: string;
  pdfId: string;
  name: string;
}

// --- CUSTOM TOOLBAR (unchanged) ---
const CustomToolbar = (props: any) => {
  const tools = useTools();
  const editor = useEditor();
  const [showExtras, setShowExtras] = useState(false);

  const activeToolId = useValue('currentToolId', () => editor.getCurrentToolId(), [editor]);

  return (
    <DefaultToolbar {...props}>
      <TldrawUiMenuItem {...tools['select']} isSelected={activeToolId === 'select'} />
      <TldrawUiMenuItem {...tools['text']} isSelected={activeToolId === 'text'} />
      <TldrawUiMenuItem {...tools['draw']} isSelected={activeToolId === 'draw'} />
      <TldrawUiMenuItem {...tools['highlight']} isSelected={activeToolId === 'highlight'} />
      <TldrawUiMenuItem {...tools['arrow']} isSelected={activeToolId === 'arrow'} />
      <TldrawUiMenuItem {...tools['eraser']} isSelected={activeToolId === 'eraser'} />

      <button
        className="more-toggle-btn"
        onClick={() => setShowExtras(!showExtras)}
        title="More Tools"
      >
        {showExtras ? '⬇️' : '➕'}
      </button>

      {showExtras && (
        <div className="extras-popup" onClick={() => setShowExtras(false)}>
          <TldrawUiMenuItem {...tools['note']} isSelected={activeToolId === 'note'} />
          <TldrawUiMenuItem {...tools['rectangle']} isSelected={activeToolId === 'rectangle'} />
          <TldrawUiMenuItem {...tools['ellipse']} isSelected={activeToolId === 'ellipse'} />
          <TldrawUiMenuItem {...tools['triangle']} isSelected={activeToolId === 'triangle'} />
          <TldrawUiMenuItem {...tools['diamond']} isSelected={activeToolId === 'diamond'} />
          <TldrawUiMenuItem {...tools['hexagon']} isSelected={activeToolId === 'hexagon'} />
        </div>
      )}
    </DefaultToolbar>
  );
};

const components: TLComponents = {
  Toolbar: CustomToolbar,
};

// --- AUTO PDF LOADER (loads PDF pages into Tldraw on first open) ---
function AutoPdfLoader({ images }: { images: PdfPageImage[] }) {
  const editor = useEditor();
  const loaded = useRef(false);
  const shapeCount = useValue('shapeCount', () => editor.getCurrentPageShapeIds().size, [editor]);

  useEffect(() => {
    // Skip if canvas already has content (restored from Tldraw persistence) or no images to load
    if (loaded.current || shapeCount > 0 || images.length === 0) return;
    loaded.current = true;

    let currentY = 50;
    images.forEach((img, index) => {
      const assetId = AssetRecordType.createId();
      const targetWidth = 1600;
      const scaleFactor = targetWidth / img.width;
      const targetHeight = img.height * scaleFactor;

      editor.createAssets([{
        id: assetId,
        type: "image",
        typeName: "asset",
        meta: {},
        props: {
          name: `page-${index}`,
          w: targetWidth,
          h: targetHeight,
          mimeType: "image/png",
          src: img.src,
          isAnimated: false,
        }
      }]);

      editor.createShapes([{
        id: createShapeId(),
        type: "image",
        x: 100,
        y: currentY,
        isLocked: true,
        meta: {},
        props: {
          assetId,
          w: targetWidth,
          h: targetHeight,
        }
      }]);

      currentY += targetHeight;
    });
  }, [editor, images, shapeCount]);

  return null;
}

// --- PDF WORKSPACE (Tldraw canvas for one PDF tab) ---
function PdfWorkspace({ pdf }: { pdf: PdfEntry }) {
  return (
    <div className="pdf-workspace">
      <Tldraw persistenceKey={`pdf-${pdf.id}`} components={components}>
        <AutoPdfLoader images={pdf.images} />
      </Tldraw>
    </div>
  );
}

// --- HOME GRID ---
function HomeGrid({ pdfs, onAddPdf, onOpenPdf }: {
  pdfs: PdfEntry[];
  onAddPdf: (pdf: PdfEntry) => void;
  onOpenPdf: (pdfId: string) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== "application/pdf") return;

    setIsLoading(true);
    try {
      const [images, thumbnail] = await Promise.all([
        convertPdfToImages(file),
        createSmallThumbnail(file),
      ]);
      const newPdf: PdfEntry = {
        id: Date.now().toString(),
        name: file.name.replace(".pdf", ""),
        images,
        thumbnail,
      };
      onAddPdf(newPdf);
    } catch (err) {
      alert("Error loading PDF. Check console.");
      console.error(err);
    }
    setIsLoading(false);
    e.target.value = "";
  };

  return (
    <div className="home-grid-container">
      <div className="home-grid">

        {/* Add PDF card */}
        <label className="pdf-card add-card">
          <input type="file" accept="application/pdf" onChange={handleFileSelect} />
          {isLoading ? (
            <span className="add-card-label">⏳ Loading...</span>
          ) : (
            <>
              <span className="add-card-plus">+</span>
              <span className="add-card-label">Add PDF</span>
            </>
          )}
        </label>

        {/* PDF cards */}
        {pdfs.map(pdf => (
          <div key={pdf.id} className="pdf-card" onClick={() => onOpenPdf(pdf.id)}>
            <div className="pdf-card-thumbnail">
              <img src={pdf.thumbnail} alt={pdf.name} />
            </div>
            <div className="pdf-card-name">{pdf.name}</div>
          </div>
        ))}

      </div>
    </div>
  );
}

// --- MAIN APP ---
export default function App() {
  const [pdfs, setPdfs] = useState<PdfEntry[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const metas: StoredPdfMeta[] = JSON.parse(stored);
      // Restore cards with empty images — Tldraw has the full canvas saved already
      return metas.map(m => ({ ...m, images: [] }));
    } catch {
      return [];
    }
  });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('home');

  const handleAddPdf = (pdf: PdfEntry) => {
    setPdfs(prev => {
      const updated = [...prev, pdf];
      const toStore: StoredPdfMeta[] = updated.map(({ id, name, thumbnail }) => ({ id, name, thumbnail }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      return updated;
    });
    const newTab: Tab = { id: `tab-${pdf.id}`, pdfId: pdf.id, name: pdf.name };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleOpenPdf = (pdfId: string) => {
    const existing = tabs.find(t => t.pdfId === pdfId);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const pdf = pdfs.find(p => p.id === pdfId);
    if (!pdf) return;
    const newTab: Tab = { id: `tab-${pdfId}`, pdfId, name: pdf.name };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs(prev => prev.filter(t => t.id !== tabId));
    if (activeTabId === tabId) setActiveTabId('home');
  };

  const activeTab = tabs.find(t => t.id === activeTabId);
  const activePdf = activeTab ? pdfs.find(p => p.id === activeTab.pdfId) : null;

  return (
    <div className="app-layout">

      {/* TAB BAR */}
      <div className="tab-bar">
        <button
          className={`tab ${activeTabId === 'home' ? 'tab-active' : ''}`}
          onClick={() => setActiveTabId('home')}
        >
          🏠 Home
        </button>
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTabId === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span className="tab-name">{tab.name}</span>
            <span className="tab-close" onClick={(e) => handleCloseTab(tab.id, e)}>×</span>
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      <div className="tab-content">
        {activeTabId === 'home' ? (
          <HomeGrid pdfs={pdfs} onAddPdf={handleAddPdf} onOpenPdf={handleOpenPdf} />
        ) : activePdf ? (
          <PdfWorkspace pdf={activePdf} />
        ) : null}
      </div>

    </div>
  );
}
