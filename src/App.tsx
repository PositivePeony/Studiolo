import React, { useState, useEffect, useRef, useCallback } from "react";
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
  DefaultColorStyle,
} from "tldraw";
import "tldraw/tldraw.css";
import "./App.css";
import { convertPdfToImages, createSmallThumbnail, saveImagesToIDB, loadImagesFromIDB, deleteImagesFromIDB, type PdfPageImage } from "./pdf-loader";

const STORAGE_KEY = "studiolo-pdfs";

type TldrawSize = 's' | 'm' | 'l' | 'xl';
const PdfSizeContext = React.createContext<TldrawSize>('m');

interface StoredPdfMeta {
  id: string;
  name: string;
  thumbnail: string;
  lastOpened: number;
  bodySize?: number;
}

// --- TYPES ---
interface PdfEntry {
  id: string;
  name: string;
  images: PdfPageImage[];
  thumbnail: string;
  lastOpened: number;
  bodySize?: number;
}

interface Tab {
  id: string;
  pdfId: string;
  name: string;
}

// --- CUSTOM TOOLBAR ---
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
  StylePanel: null,
  InFrontOfTheCanvas: AnnotationSettingsButton,
};

// --- AUTO PDF LOADER ---
// FIX: Removed shapeCount from the bail-out condition.
// Previously, stale tldraw persistence data would set shapeCount > 0
// and block fresh images from loading. Now we only check:
//   - loaded.current (so we don't double-load)
//   - images.length === 0 (nothing to load, e.g. restored from localStorage)
function AutoPdfLoader({ images }: { images: PdfPageImage[] }) {
  const editor = useEditor();
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current || images.length === 0) return;
    loaded.current = true;

    // Clear any stale shapes from tldraw persistence before loading fresh pages
    const existingShapeIds = editor.getCurrentPageShapeIds();
    if (existingShapeIds.size > 0) {
      editor.deleteShapes([...existingShapeIds]);
    }

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
  }, [editor, images]);

  return null;
}

// --- HELPERS ---
function bodyToTldrawSize(bodySize?: number): TldrawSize {
  if (!bodySize || bodySize <= 8) return 'm';
  if (bodySize <= 12) return 'l';
  if (bodySize <= 16) return 'xl';
  return 'xl';
}

// --- ANNOTATION SETTINGS BUTTON ---
const ANNO_COLORS = [
  { id: 'black',        hex: '#1d1d1d' },
  { id: 'red',          hex: '#e03131' },
  { id: 'light-red',    hex: '#ff8787' },
  { id: 'orange',       hex: '#f76707' },
  { id: 'yellow',       hex: '#f59f00' },
  { id: 'green',        hex: '#2f9e44' },
  { id: 'light-green',  hex: '#74c69d' },
  { id: 'blue',         hex: '#1971c2' },
  { id: 'light-blue',   hex: '#74c0fc' },
  { id: 'violet',       hex: '#7048e8' },
  { id: 'light-violet', hex: '#c084fc' },
  { id: 'grey',         hex: '#868e96' },
] as const;

interface TextPreset      { color: string; size: TldrawSize; font: 'draw'|'sans'|'serif'|'mono' }
interface HighlightPreset { color: string; size: TldrawSize }
interface PenPreset       { color: string }

function loadPreset<T>(key: string, def: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function savePreset<T>(key: string, val: T) {
  localStorage.setItem(key, JSON.stringify(val));
}

type AnnoMode = 'text' | 'highlight' | 'pen';

function AnnotationSettingsButton() {
  const editor = useEditor();
  const pdfSize = React.useContext(PdfSizeContext);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AnnoMode>('text');

  const [textPreset, setTextPreset] = useState<TextPreset>(() => {
    const p = loadPreset('studiolo-preset-text', { color: 'black', size: pdfSize, font: 'sans' });
    if (p.font === 'mono') { p.font = 'sans' as const; savePreset('studiolo-preset-text', p); }
    return p;
  });
  const [hlPreset, setHlPreset] = useState<HighlightPreset>(
    () => loadPreset('studiolo-preset-highlight', { color: 'yellow', size: pdfSize })
  );
  const [penPreset, setPenPreset] = useState<PenPreset>(
    () => loadPreset('studiolo-preset-pen', { color: 'black' })
  );

  const toolId = useValue('toolId', () => editor.getCurrentToolId(), [editor]);

  useEffect(() => {
    if (toolId === 'text') setMode('text');
    else if (toolId === 'highlight') setMode('highlight');
    else if (toolId === 'draw') setMode('pen');
  }, [toolId]);

  useEffect(() => {
    if (toolId === 'text' || toolId === 'select') {
      editor.setStyleForNextShapes(DefaultColorStyle, textPreset.color as any);
      editor.setStyleForNextShapes(DefaultSizeStyle, textPreset.size);
      editor.setStyleForNextShapes(DefaultFontStyle, textPreset.font);
    } else if (toolId === 'highlight') {
      editor.setStyleForNextShapes(DefaultColorStyle, hlPreset.color as any);
      editor.setStyleForNextShapes(DefaultSizeStyle, hlPreset.size);
    } else if (toolId === 'draw' || toolId === 'arrow') {
      editor.setStyleForNextShapes(DefaultColorStyle, penPreset.color as any);
    }
  }, [editor, toolId, textPreset, hlPreset, penPreset]);

  const updateText = (patch: Partial<TextPreset>) => {
    const u = { ...textPreset, ...patch };
    setTextPreset(u); savePreset('studiolo-preset-text', u);
    editor.setStyleForNextShapes(DefaultColorStyle, u.color as any);
    editor.setStyleForNextShapes(DefaultSizeStyle, u.size);
    editor.setStyleForNextShapes(DefaultFontStyle, u.font);
  };
  const updateHl = (patch: Partial<HighlightPreset>) => {
    const u = { ...hlPreset, ...patch };
    setHlPreset(u); savePreset('studiolo-preset-highlight', u);
    editor.setStyleForNextShapes(DefaultColorStyle, u.color as any);
    editor.setStyleForNextShapes(DefaultSizeStyle, u.size);
  };
  const updatePen = (patch: Partial<PenPreset>) => {
    const u = { ...penPreset, ...patch };
    setPenPreset(u); savePreset('studiolo-preset-pen', u);
    editor.setStyleForNextShapes(DefaultColorStyle, u.color as any);
  };

  return (
    <div className="anno-btn-wrap">
      <button className="anno-rainbow-btn" onClick={() => setOpen(o => !o)}>
        Annotation Settings
      </button>
      {open && (
        <div className="anno-panel">
          <div className="anno-panel-header">
            <span className="anno-panel-title">Annotation Settings</span>
            <button className="anno-close-btn" onClick={() => setOpen(false)}>×</button>
          </div>

          <div className="anno-mode-tabs">
            {(['text', 'highlight', 'pen'] as AnnoMode[]).map(m => (
              <button key={m} className={`anno-mode-tab ${mode === m ? 'anno-mode-active' : ''}`}
                onClick={() => setMode(m)}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>

          {mode === 'text' && (<>
            <div className="anno-section-label">Color</div>
            <div className="anno-colors">
              {ANNO_COLORS.map(c => (
                <button key={c.id} className={`anno-color-swatch ${textPreset.color === c.id ? 'anno-color-active' : ''}`}
                  style={{ background: c.hex }} title={c.id} onClick={() => updateText({ color: c.id })} />
              ))}
            </div>
            <div className="anno-section-label">Size</div>
            <div className="anno-sizes">
              {(['s', 'm', 'l', 'xl'] as const).map(s => (
                <button key={s} className={`anno-size-btn ${textPreset.size === s ? 'anno-btn-active' : ''}`}
                  onClick={() => updateText({ size: s })}>{s.toUpperCase()}</button>
              ))}
            </div>
            <div className="anno-section-label">Font</div>
            <div className="anno-fonts">
              {(['draw', 'sans', 'serif', 'mono'] as const).map(f => (
                <button key={f} className={`anno-font-btn ${textPreset.font === f ? 'anno-btn-active' : ''}`}
                  onClick={() => updateText({ font: f })}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
              ))}
            </div>
          </>)}

          {mode === 'highlight' && (<>
            <div className="anno-section-label">Color</div>
            <div className="anno-colors">
              {ANNO_COLORS.map(c => (
                <button key={c.id} className={`anno-color-swatch ${hlPreset.color === c.id ? 'anno-color-active' : ''}`}
                  style={{ background: c.hex }} title={c.id} onClick={() => updateHl({ color: c.id })} />
              ))}
            </div>
            <div className="anno-section-label">Size</div>
            <div className="anno-sizes">
              {(['s', 'm', 'l', 'xl'] as const).map(s => (
                <button key={s} className={`anno-size-btn ${hlPreset.size === s ? 'anno-btn-active' : ''}`}
                  onClick={() => updateHl({ size: s })}>{s.toUpperCase()}</button>
              ))}
            </div>
          </>)}

          {mode === 'pen' && (<>
            <div className="anno-section-label">Color</div>
            <div className="anno-colors">
              {ANNO_COLORS.map(c => (
                <button key={c.id} className={`anno-color-swatch ${penPreset.color === c.id ? 'anno-color-active' : ''}`}
                  style={{ background: c.hex }} title={c.id} onClick={() => updatePen({ color: c.id })} />
              ))}
            </div>
          </>)}
        </div>
      )}
    </div>
  );
}

// --- TEXT WRAP ENFORCER ---
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

// --- THE KINOPIO CLICK TOOL ---
// FIX: Guarded against undefined/empty pdf.images at the top of the handler.
function KinopioClickTool({ pdf }: { pdf: PdfEntry }) {
  const editor = useEditor();

  useEffect(() => {
    const handleEvent = (event: any) => {
      if (event.name !== 'pointer_up') return;
      if (editor.getCurrentToolId() !== 'select') return;

      const { x, y } = editor.inputs.currentPagePoint;

      const shapeAtPoint = editor.getShapeAtPoint({ x, y });
      if (shapeAtPoint && shapeAtPoint.type !== 'image') return;

      // Guard: bail if images aren't available (e.g. restored from localStorage)
      if (!pdf.images || pdf.images.length === 0) return;

      const pageIndex = Math.floor((y - 50) / 1600);
      if (pageIndex < 0 || pageIndex >= pdf.images.length) return;

      const id = createShapeId();

      editor.createShape({
        id,
        type: 'text',
        x,
        y,
        props: {
          text: '',
          w: 300,
        },
      });

      editor.select(id);
      editor.setEditingShape(id);
    };

    editor.on('event', handleEvent);
    return () => {
      editor.off('event', handleEvent);
    };
  }, [editor, pdf]);

  return null;
}

// --- PDF WORKSPACE ---
// FIX: Always passes a safe array to AutoPdfLoader.
// Only mounts KinopioClickTool when images are actually available.
function PdfWorkspace({ pdf }: { pdf: PdfEntry }) {
  const safeImages = pdf.images || [];
  const hasImages = safeImages.length > 0;
  const tldrawSize = bodyToTldrawSize(pdf.bodySize);

  return (
    <div className="pdf-workspace">
      <PdfSizeContext.Provider value={tldrawSize}>
        <Tldraw persistenceKey={`pdf-${pdf.id}`} components={components}>
          <AutoPdfLoader images={safeImages} />
          <TextWrapEnforcer />
          {hasImages && <KinopioClickTool pdf={pdf} />}
        </Tldraw>
      </PdfSizeContext.Provider>
    </div>
  );
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
      const { images, bodySize } = await convertPdfToImages(file);
      const thumbnail = await createSmallThumbnail(file);

      const newPdf: PdfEntry = {
        id: Date.now().toString(),
        name: file.name.replace(".pdf", ""),
        images,
        thumbnail,
        lastOpened: Date.now(),
        bodySize,
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
      return metas.map(m => ({ ...m, images: [] as PdfPageImage[] }));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    let metas: StoredPdfMeta[];
    try { metas = JSON.parse(stored); } catch { return; }
    Promise.all(
      metas.map(m => loadImagesFromIDB(m.id).then(images => ({ id: m.id, images })))
    ).then(results => {
      setPdfs(prev => prev.map(p => {
        const found = results.find(r => r.id === p.id);
        return found ? { ...p, images: found.images } : p;
      }));
    });
  }, []);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('home');

  const saveToStorage = useCallback((pdfList: PdfEntry[]) => {
    const toStore: StoredPdfMeta[] = pdfList.map(({ id, name, thumbnail, lastOpened, bodySize }) => ({
      id, name, thumbnail, lastOpened, bodySize,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  }, []);

  const handleAddPdf = useCallback((pdf: PdfEntry) => {
    saveImagesToIDB(pdf.id, pdf.images);
    setPdfs(prev => {
      const updated = [...prev, pdf];
      saveToStorage(updated);
      return updated;
    });
    const newTab: Tab = { id: `tab-${pdf.id}`, pdfId: pdf.id, name: pdf.name };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [saveToStorage]);

  const handleOpenPdf = useCallback((pdfId: string) => {
    setPdfs(prev => {
      const updated = prev.map(p => p.id === pdfId ? { ...p, lastOpened: Date.now() } : p);
      saveToStorage(updated);
      return updated;
    });
    setTabs(prev => {
      const existing = prev.find(t => t.pdfId === pdfId);
      if (existing) {
        setActiveTabId(existing.id);
        return prev;
      }
      // Need to read from current pdfs state inside the callback
      const pdf = pdfs.find(p => p.id === pdfId);
      if (!pdf) return prev;
      const newTab: Tab = { id: `tab-${pdfId}`, pdfId, name: pdf.name };
      setActiveTabId(newTab.id);
      return [...prev, newTab];
    });
  }, [pdfs, saveToStorage]);

  const handleDeletePdf = useCallback((pdfId: string) => {
    deleteImagesFromIDB(pdfId);
    setPdfs(prev => {
      const updated = prev.filter(p => p.id !== pdfId);
      saveToStorage(updated);
      // Clean up Tldraw's saved canvas for this PDF
      Object.keys(localStorage).forEach(key => {
        if (key.includes(`pdf-${pdfId}`)) localStorage.removeItem(key);
      });
      return updated;
    });
    setTabs(prev => prev.filter(t => t.pdfId !== pdfId));
    setActiveTabId(prev => prev === `tab-${pdfId}` ? 'home' : prev);
  }, [saveToStorage]);

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
        <div style={{ display: activeTabId === 'home' ? 'contents' : 'none' }}>
          <HomeGrid pdfs={pdfs} onAddPdf={handleAddPdf} onOpenPdf={handleOpenPdf} onDeletePdf={handleDeletePdf} />
        </div>

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
