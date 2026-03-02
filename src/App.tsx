import React, { useState } from "react";
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
import { convertPdfToImages } from "./pdf-loader";

// 1. THE ULTIMATE MINIMALIST TOOLBAR
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

// 2. THE UPLOAD BUTTON
function BigBlueButton() {
  const editor = useEditor();
  const [isLoading, setIsLoading] = useState(false);
  
  const shapeCount = useValue('shapeCount', () => editor.getCurrentPageShapeIds().size, [editor]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    
    if (file && file.type === "application/pdf") {
      setIsLoading(true);
      try {
        const images = await convertPdfToImages(file);
        
        let currentY = 50; 
        
        images.forEach((img, index) => {
          const assetId = AssetRecordType.createId();
          
          // THE FIX: Dialed back to 1600 (2x the original size instead of 3x)
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
              assetId: assetId,
              w: targetWidth,
              h: targetHeight,
            }
          }]);

          currentY += targetHeight; 
        });
      } catch (err) {
        alert("Check the console for errors!");
        console.error(err);
      }
      setIsLoading(false);
    }
  };

  if (shapeCount > 0) return null;

  return (
    <div className="master-ui-layer">
      <label className="custom-file-upload">
        <input type="file" accept="application/pdf" onChange={handleFileSelect} />
        {isLoading ? "⏳ Processing..." : "📁 CLICK TO CHOOSE PDF"}
      </label>
    </div>
  );
}

// 3. THE MAIN APP
export default function App() {
  return (
    <div className="desk-container">
      <div className="drawing-layer">
        <Tldraw persistenceKey="local-lab" components={components}>
          <BigBlueButton />
        </Tldraw>
      </div>
    </div>
  );
}
