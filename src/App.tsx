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
  TldrawUiMenuItem,
  DefaultFontStyle,
  DefaultSizeStyle,
} from "tldraw";
import "tldraw/tldraw.css";
import "./App.css";
import { convertPdfToImages, createSmallThumbnail, type PdfPageImage } from "./pdf-loader";

const STORAGE_KEY = "studiolo-pdfs";

interface StoredPdfMeta {
  id: string;
  name: string;
  thumbnail: string;
  lastOpened: number;
  bodySize?: number; // <--- Add this!
}

// --- TYPES ---
interface PdfEntry {
  id: string;
  name: string;
  images: PdfPageImage[];
  thumbnail: string;
  lastOpened: number;
  bodySize?: number; // <--- This is the new line you needed!
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

// --- DEFAULT STYLE SETTER ---
function DefaultStyleSetter() {
  const editor = useEditor();

  useEffect(() => {
    editor.setStyleForNextShapes(DefaultFontStyle, 'mono'); // OpenDyslexic
    editor.setStyleForNextShapes(DefaultSizeStyle, 'l');
  }, [editor]);

  return null;
}

// --- TEXT WRAP ENFORCER (makes text tool wrap at a fixed width instead of one long line) ---
function TextWrapEnforcer() {
  const editor = useEditor();

  useEffect(() => {
    const unsub = editor.store.listen((entry) => {
      const widthBySize: Record<string, number> = { s: 235, m: 310, l: 465, xl: 570 };
      Object.values(entry.changes.added).forEach((record: any) => {
        if (record.typeName === 'shape' && record.type === 'text' && record.props?.autoSize === true) {
          const w = widthBySize[record.props.size] ?? 570;
          editor.updateShape({
            id: record.id,
            type: 'text',
            props: { autoSize: false, w },
          });
        }
      });
    }, { source: 'user' });
    return unsub;
  }, [editor]);

  return null;
}




// --- PDF WORKSPACE (Tldraw canvas for one PDF tab) ---
function PdfWorkspace({ pdf }: { pdf: PdfEntry }) {
  return (
    <div className="pdf-workspace">
      <Tldraw persistenceKey={`pdf-${pdf.id}`} components={components}>
        <AutoPdfLoader images={pdf.images} />
        <TextWrapEnforcer />
        <DefaultStyleSetter />
        <KinopioClickTool pdf={pdf} />
      </Tldraw>
    </div>
  );
}

// --- THE KINOPIO SUPER TOOL (v5: Final Vibe) ---
function KinopioClickTool({ pdf }: { pdf: PdfEntry }) {
  const editor = useEditor();

  useEffect(() => {
    const handleEvent = (event: any) => {
      // 1. Only trigger on mouse/finger lift
      if (event.name !== 'pointer_up') return;
      
      // 2. Only work in 'select' mode (Requirement: Single Click, no Shift)
      if (editor.getCurrentToolId() !== 'select') return;

      const { x, y } = editor.inputs.currentPagePoint;

      // 3. Don't drop a note if clicking an existing annotation
      const shapeAtPoint = editor.getShapeAtPoint({ x, y });
      if (shapeAtPoint && shapeAtPoint.type !== 'image') return;

      const pageIndex = Math.floor((y - 50) / 1600);
      const page = pdf.images[pageIndex];
      if (!page) return;

      // Calculate perfect scale relative to document body text
      const tldrawBaseM = 18; 
      const scaleFactor = 1600 / (page.width / 3);
      const documentBodyInPixels = (pdf.bodySize || 12) * scaleFactor;
      const idealScale = documentBodyInPixels / tldrawBaseM;

      const id = createShapeId();
      
      // 4. Create the base note
      editor.createShape({
        id,
        type: 'text',
        x,
        y,
        props: {
          text: '', 
          font: 'mono',
          size: 'm',
          w: 300,
        },
      });

      // 5. THE FIX: We use 'as any' here to stop the TypeScript error
      editor.updateShapes([{
        id,
        type: 'text',
        scale: idealScale, 
      } as any]);

      // 6. Enter editing mode immediately
      editor.select(id);
      editor.setEditingShape(id);
    };

    // Attach listener and return cleanup function
    editor.on('event', handleEvent);
    return () => {
      editor.off('event', handleEvent);
    };
  }, [editor, pdf]);

  return null;
}
// --- HOME GRID ---
function HomeGrid({ pdfs, onAddPdf, onOpenPdf, onDeletePdf }: {
  pdfs: PdfEntry[];
  onAddPdf: (pdf: PdfEntry) => void;
  onOpenPdf: (pdfId: string) => void;
  onDeletePdf: (pdfId: string) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== "application/pdf") return;

    setIsLoading(true);
    try {
      // 1. Get both the images AND the detected bodySize from the loader
      const { images, bodySize } = await convertPdfToImages(file);
      const thumbnail = await createSmallThumbnail(file);

      const newPdf: PdfEntry = {
        id: Date.now().toString(),
        name: file.name.replace(".pdf", ""),
        images,
        thumbnail,
        lastOpened: Date.now(),
        bodySize, // 2. Save the winning font size here
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

        {/* PDF cards — sorted by most recently opened */}
        {[...pdfs].sort((a, b) => b.lastOpened - a.lastOpened).map(pdf => (
          <div key={pdf.id} className="pdf-card" onClick={() => onOpenPdf(pdf.id)}>
            <div className="pdf-card-thumbnail">
              <img src={pdf.thumbnail} alt={pdf.name} />
            </div>
            <div className="pdf-card-name">{pdf.name}</div>
            <button
              className="pdf-card-delete"
              onClick={e => { e.stopPropagation(); onDeletePdf(pdf.id); }}
              title="Remove PDF"
            >×</button>
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

  const saveToStorage = (pdfs: PdfEntry[]) => {
    // Add bodySize to the list of things it grabs and saves!
    const toStore: StoredPdfMeta[] = pdfs.map(({ id, name, thumbnail, lastOpened, bodySize }) => ({ id, name, thumbnail, lastOpened, bodySize }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  };

  const handleAddPdf = (pdf: PdfEntry) => {
    setPdfs(prev => {
      const updated = [...prev, pdf];
      saveToStorage(updated);
      return updated;
    });
    const newTab: Tab = { id: `tab-${pdf.id}`, pdfId: pdf.id, name: pdf.name };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleOpenPdf = (pdfId: string) => {
    // Update lastOpened timestamp
    setPdfs(prev => {
      const updated = prev.map(p => p.id === pdfId ? { ...p, lastOpened: Date.now() } : p);
      saveToStorage(updated);
      return updated;
    });
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

  const handleDeletePdf = (pdfId: string) => {
    setPdfs(prev => {
      const updated = prev.filter(p => p.id !== pdfId);
      saveToStorage(updated);
      // Clean up Tldraw's saved canvas for this PDF
      Object.keys(localStorage).forEach(key => {
        if (key.includes(`pdf-${pdfId}`)) localStorage.removeItem(key);
      });
      return updated;
    });
    // Close the tab if it's open
    setTabs(prev => prev.filter(t => t.pdfId !== pdfId));
    setActiveTabId(prev => prev === `tab-${pdfId}` ? 'home' : prev);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs(prev => prev.filter(t => t.id !== tabId));
    if (activeTabId === tabId) setActiveTabId('home');
  };

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
        {/* Home is shown/hidden via display so PDF workspaces can stay mounted */}
        <div style={{ display: activeTabId === 'home' ? 'contents' : 'none' }}>
          <HomeGrid pdfs={pdfs} onAddPdf={handleAddPdf} onOpenPdf={handleOpenPdf} onDeletePdf={handleDeletePdf} />
        </div>

        {/* Each PDF workspace stays mounted once opened — prevents Tldraw store cross-contamination */}
        {tabs.map(tab => {
          const pdf = pdfs.find(p => p.id === tab.pdfId);
          if (!pdf) return null;
          return (
            <div key={tab.id} style={{ display: activeTabId === tab.id ? 'contents' : 'none' }}>
              <PdfWorkspace pdf={pdf} />
            </div>
          );
        })}
      </div>

    </div>
  );
}
