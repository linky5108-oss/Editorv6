# Plan de Corrección: Borrador sin Transparencia Residual y Mejoras del Editor de Dibujo

## 1. Borrado total al 100% en una sola pasada (`paint-brush.ts`, `PaintEditor.tsx`, `GalleryCanvasPanel.tsx`)
- **Causa raíz identificada**:
  1. Las opciones del trazo (`opacity` y `softness`) se compartían entre el pincel y el borrador; cualquier opacidad `< 100%` o suavidad `> 0` hacía que `destination-out` dejara alfa residual o bordes difuminados.
  2. El suavizado de curvas completas (`redrawActiveCurve` + `refineStrokePath` con filtro de Taubin y enderezamiento de cuerda) se aplicaba también al borrador: al frotar en zigzag para borrar una zona, la curva suavizada se encogía en los giros y restauraba `strokeBackup` fotograma a fotograma, dejando píxeles semitransparentes en los bordes anti-aliasados de Canvas 2D.
  3. El anti-aliasing nativo de Canvas 2D en `destination-out` deja píxeles con alfa parcial en el perímetro de una pasada simple.
- **Solución**:
  - En `paint-brush.ts` (`drawSingleStamp`, `drawBrush`, `drawSingleBrushPath`), forzar siempre `globalAlpha = 1`, `shadowBlur = 0` (`softness = 0`) y grosor íntegro cuando `erase = true`, además de limpiar completamente el canal alfa en el área barrida por el borrador para eliminar cualquier residuo semitransparente de anti-aliasing en una única pasada.
  - En `PaintEditor.tsx` y `GalleryCanvasPanel.tsx`, hacer que el borrador aplique los segmentos de borrado de manera directa y acumulativa sobre la capa (sin encoger los zigzags con `refineStrokePath` ni des-borrar al invertir la dirección), garantizando que todo píxel tocado por el cursor quede con `alpha = 0` al instante.

## 2. Rasterización y borrado de formas y textos en la capa activa (`PaintEditor.tsx`)
- Cuando el usuario inicia un trazo con la herramienta **Borrador** (`tool === "eraser"`) sobre una capa que contiene objetos vectoriales (`layer.shapes` o `layer.texts`), se volcarán (`paintShape` / `drawTextObject`) al bitmap de la capa (`layer.canvas`) antes de aplicar el borrado y se vaciarán las colecciones vectoriales de esa capa (guardando previamente el estado en el historial de deshacer), permitiendo borrar cualquier parte de formas o textos directamente.

## 3. Alcance completo del estabilizador al soltar el trazo (`paint-stabilizer.ts`)
- En `advanceStabilizer(..., catchUp = true)`, calcular la distancia restante desde la punta real del trazo (`state.tip`) hasta el punto final (`target`) en lugar de usar `state.anchor` (que ya coincidía con `target` al terminar `onMove`), iterando los pasos necesarios para que el trazo alcance exactamente la posición donde se suelta el puntero.

## 4. Corrección de duplicados al aplanar y fusionar capas (`PaintEditor.tsx`)
- **`flattenNow`**: Como `compositeInto` ya renderiza las formas y textos dentro del bitmap combinado (`buf`), la capa resultante `"Aplanada"` inicializará `texts: []` y `shapes: []` para no duplicar los objetos encima de sus propios píxeles ya fundidos, y conservará el historial de deshacer previo.
- **`mergeDown`**: Renderizar ordenadamente el contenido completo de la capa inferior y superior (incluyendo sus formas y textos con la opacidad y modo de fusión correspondientes) para que no se pierda el orden visual ni la opacidad de la capa fusionada.

## 5. Historial Deshacer/Rehacer multicapa (`PaintEditor.tsx`)
- Ampliar `Snapshot` para respaldar la pila completa de capas cuando se realizan operaciones estructurales (`addLayer`, `duplicateLayer`, `removeLayer`, `moveLayer`, `mergeDown`, `flattenNow`, `flipEntireCanvas`), permitiendo deshacer (`Ctrl+Z`) y rehacer (`Ctrl+Y` / `Ctrl+Shift+Z`) cualquiera de estas acciones sin perder capas ni estados.
