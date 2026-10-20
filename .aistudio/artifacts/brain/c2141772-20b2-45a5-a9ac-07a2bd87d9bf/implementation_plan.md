# Modo Inteligencia Artificial con Orión y Edición Integral del Juego en HTML5

Incorporación del **Modo Inteligencia Artificial** a pantalla completa protagonizado por **Orión**, el asistente de Asternal, junto con una arquitectura de documento HTML5 editable de extremo a extremo donde cada parte del runtime (lógicas, comportamientos, físicas, sonidos, interfaz, escenas, distribución de recursos y extensiones nuevas no predefinidas) puede editarse tanto mediante conversación con Orión como directamente desde el documento HTML5, manteniendo sincronización bidireccional con el editor visual.

## Revisión del Usuario y Decisiones Confirmadas

> [!IMPORTANT]
> Estas decisiones fueron confirmadas para guiar la arquitectura y experiencia del nuevo modo:

- **Sincronización híbrida entre HTML5 y el editor visual**: Cuando Orión o la persona usuaria editen el archivo HTML5 del juego (escenas, entidades, scripts, sonidos, recursos o nuevas lógicas personalizadas de runtime), los cambios estructurados se sincronizarán de vuelta con el proyecto del editor visual y cualquier código o lógica adicional en el HTML5 (`customRuntimeCode` / extensiones de motor, nuevos comportamientos y sintetizadores de audio) se conservará intacto en el proyecto y en el HTML5 compilado.
- **Diseño de pantalla completa en triple panel**: El Modo Inteligencia Artificial de Orión ocupará toda la pantalla y presentará el chat conversacional con **Orión** junto a la **vista previa jugable en vivo** y el **editor/inspector del archivo HTML5** en tiempo real.
- **Acceso rápido fijo dentro del editor de juegos**: Un botón compacto y siempre visible en la esquina superior izquierda del editor de juegos de Asternal llevará directamente a la pantalla completa del Modo Inteligencia Artificial (sin ventanas flotantes ni pop-ups superpuestos sobre el lienzo).

---

## 1. Descripción General y Concepto Principal

- **Qué hace**:
  1. Convierte el documento HTML5 generado del juego en una fuente viva y editable de extremo a extremo: incluye un manifiesto estructurado editable (`ASTERNAL_PROJECT_DATA` con escenas, capas, entidades, animaciones, scripts, sonidos y distribución de recursos), los ganchos de extensión del motor (`ASTERNAL_CUSTOM_RUNTIME` para nuevas lógicas, físicas, eventos, renderizado y audio que no existían originalmente en los bloques) y el motor completo en claro.
  2. Permite abrir en cualquier momento el **Modo Inteligencia Artificial** desde un botón compacto fijo en la esquina superior izquierda del editor de juegos.
  3. Presenta a **Orión** (siempre escrito con tilde) en una interfaz de estudio a pantalla completa capaz de comprender todas las lógicas actuales del motor de Asternal (todos los eventos, los más de 50 bloques de acción, físicas, jerarquías padre-hijo, capas, emisores de partículas, diálogos, cámara, interfaz táctil y audio WebAudio) e **implementar lógicas completamente nuevas** directamente sobre el proyecto y su runtime HTML5 cuando se le pida cualquier mecánica, sonido, distribución de recursos o comportamiento.
- **Audiencia y contexto**: Creadores de juegos dentro de Asternal que desean pedirle a Orión cambios complejos en lenguaje natural ("haz que el personaje tenga dash con estela y sonido láser", "redistribuye las monedas en espiral y crea un jefe que dispare proyectiles en abanico", "cambia la gravedad cuando el jugador toque el techo") o ajustar el documento HTML5 directamente y ver el resultado al instante.
- **Valor clave**: Elimina cualquier límite entre lo que ofrece el editor por bloques y lo que puede hacer un juego HTML5 completo, permitiendo que Orión programe e inyecte tanto estructuras nativas del motor como nuevas mecánicas, sonidos sintetizados y reglas personalizadas en el archivo HTML5.

---

## 2. Experiencia de Usuario y Diseño Visual

### Flujos de Usuario Clave

1. **Entrada al Modo Inteligencia Artificial**:
   - En la esquina superior izquierda del editor de juegos de Asternal permanece siempre visible un botón compacto de acceso rápido (`Orión IA`).
   - Al pulsarlo, la vista cambia a una **pantalla completa dedicada** (sin modales ni ventanas emergentes pequeñas).
2. **Conversación y Edición con Orión**:
   - En el panel izquierdo, la persona usuaria conversa con **Orión**. Incluye sugerencias rápidas de mecánicas ("Añadir habilidad especial y sonido", "Reorganizar nivel y recursos", "Crear nueva lógica de enemigo", "Ajustar físicas y cámara") y un historial claro de qué cambios aplicó Orión en cada turno.
   - Al enviar una instrucción, Orión analiza el estado completo del juego y el código HTML5 actual, aplica las modificaciones sobre las escenas, entidades, scripts, sonidos, distribución de recursos y extensiones de runtime HTML5, y actualiza al instante tanto la vista previa en vivo como el documento HTML5.
3. **Vista Previa en Vivo y Editor HTML5 Sincronizado**:
   - En el área central/derecha se muestran la **Vista previa interactiva en vivo** (ejecutando el archivo HTML5 real en su contexto aislado a la tasa nativa del dispositivo) y el **Editor del documento HTML5** (con secciones rápidas para ir a la distribución de recursos/escenas, lógica de bloques, sintetizador de sonidos o código del motor HTML5).
   - Si la persona edita directamente el archivo HTML5 en el editor de código y pulsa **Aplicar y sincronizar HTML5**, el sistema extrae los cambios del documento HTML5, actualiza el proyecto visual, preserva cualquier lógica o modificación personalizada del HTML5 y recarga la vista previa en vivo.
4. **Regreso al Editor Visual**:
   - Un botón claro de **Volver al editor** en la barra superior de la pantalla completa regresa al lienzo habitual de Asternal con todas las escenas, objetos, scripts, sonidos y extensiones HTML5 ya sincronizados y listos para guardar o publicar.

### Identidad Visual y Tema

- **Dirección Estética**: Estudio de ingeniería espacial limpio y de alta precisión, coherente con la estética oscura del motor Asternal, sin ornamentos artificiales ni indicadores falsos.
- **Paleta de Color (Regla 60-30-10)**:
  - *60% Lienzo Dominante*: Pizarra profunda (`#090D16` / `--background`) para máxima legibilidad del código HTML5 y contraste con el lienzo del juego.
  - *30% Superficies Estructurales*: Paneles planos de un solo nivel de elevación (`#111726`) delimitados por bordes sutiles de `1px` (`rgba(255,255,255,0.08)`).
  - *10% Acento Focal*: Azul celeste estelar (`#38BDF8`) y ámbar técnico (`#F59E0B`) reservados para acciones primarias de Orión, estado de sincronización y controles activos.
- **Tipografía y Jerarquía**:
  - *Encabezados y Navegación*: `Plus Jakarta Sans` / tipografía de interfaz limpia en una sola línea (`whitespace-nowrap`), sin etiquetas en mayúsculas forzadas ni prefijos mecánicos.
  - *Código HTML5 y Métricas*: Fuente monoespaciada (`JetBrains Mono` / `font-mono tabular-nums`) con numeración de líneas tabular y resaltado claro de bloques editables.
- **Composición Espacial**:
  - En escritorio/tableta: Diseño a pantalla completa (`100dvw × 100dvh`) con barra superior de 3 zonas (Identidad de **Orión** + navegación de vista `Vista dividida | Vista previa | Código HTML5` + acción de retorno/exportación) y cuerpo en paneles redimensionables o conmutables (Chat con Orión + Vista previa HTML5 en vivo + Editor HTML5).
  - En móvil: Conmutación fluida en una sola línea entre los tres espacios (**Chat con Orión**, **Juego en vivo**, **Archivo HTML5**) manteniendo siempre el 100% de la pantalla útil.

---

## 3. Decisiones de Producto y Equilibrios Técnicos

- **Decisión 1: Arquitectura de Documento HTML5 Bidireccional (Datos + Hooks de Extensión + Documento Completo)**
  - *Enfoque elegido*: El archivo HTML5 contiene bloques claramente delimitados (`/* __ASTERNAL_PROJECT_START__ */ ... /* __ASTERNAL_PROJECT_END__ */` y `/* __ASTERNAL_CUSTOM_RUNTIME_START__ */ ... /* __ASTERNAL_CUSTOM_RUNTIME_END__ */`) además de permitir edición directa del documento HTML5 completo. Al editar con Orión o manualmente, el parser sincroniza los datos del proyecto con el estado de Asternal y almacena tanto las extensiones personalizadas (`customRuntimeCode`, sonidos procedurales, nuevas lógicas de actualización/colisión/dibujo) como cualquier ajuste directo del HTML5.
  - *Por qué*: Garantiza que todo cambio hecho en el HTML5 o pedido a Orión se refleje en el editor visual (posiciones, objetos, capas, scripts, sonidos) y, al mismo tiempo, permite crear mecánicas infinitas en JavaScript/HTML5 que van más allá de los bloques predefinidos sin perderse al volver al editor.
- **Decisión 2: Conocimiento Exhaustivo del Motor por parte de Orión (Servidor + Motor Inteligente de Respaldo)**
  - *Enfoque elegido*: Conectamos a **Orión** mediante un endpoint dedicado en el servidor (`/api/orion/game-assistant`) respaldado por el SDK `@google/genai` (y compatible con el puente LLM del servidor) con un prompt de sistema que documenta exhaustivamente el esquema de `Project`, los 17 tipos de eventos, los 55 tipos de bloques, el sintetizador WebAudio, el sistema de físicas y la API de hooks de runtime HTML5 (`onTick`, `onRender`, `onCollide`, `onKey`, `customBlocks`, `customSounds`), acompañado de un motor determinista de respaldo para garantizar que Orión siempre pueda editar el juego incluso si el entorno local no tiene conexión externa.
  - *Por qué*: Asegura que Orión conozca al 100% todas las lógicas existentes y cómo programar nuevas lógicas directamente en el archivo HTML5 sin exponer claves en el navegador.

---

## 4. Arquitectura Técnica y Estrategia de Datos

### Diagrama de Arquitectura y Flujo de Datos

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Editor de Juegos de Asternal                             │
│  ┌────────────────────────────────────┐                                      │
│  │ Botón fijo superior izquierdo      │──► Abre Modo IA a Pantalla Completa  │
│  │ (Acceso permanente a Orión)        │                                      │
│  └────────────────────────────────────┘                                      │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              Modo Inteligencia Artificial — Orión (Pantalla Completa)        │
│                                                                              │
│  ┌────────────────────────┐  ┌─────────────────────┐  ┌───────────────────┐  │
│  │ Panel Chat con Orión   │  │ Vista Previa Viva   │  │ Editor HTML5      │  │
│  │ • Historial de chat    │  │ • Iframe Blob HTML5 │  │ • Código completo │  │
│  │ • Prompts rápidos      │  │ • 100% hardware     │  │ • Secciones de    │  │
│  │ • Resumen de cambios   │  │ • Reinicio en vivo  │  │   lógica/assets   │  │
│  └───────────┬────────────┘  └──────────▲──────────┘  └─────────┬─────────┘  │
└──────────────┼──────────────────────────┼───────────────────────┼────────────┘
               │                          │                       │
               ▼                          │                       ▼
┌──────────────────────────────┐          │        ┌───────────────────────────┐
│ Endpoint Servidor Orión      │          │        │ Sincronizador HTML5 ◄───► │
│ POST /api/orion/edit-game    │──────────┴───────►│ Proyecto Visual +         │
│ • Conoce los 55 bloques,     │                   │ Runtime Personalizado     │
│   eventos, sonidos y assets  │                   │ (Escenas, Scripts, Audio, │
│ • Genera nuevas lógicas en   │                   │  Hooks y HTML5 libre)     │
│   el runtime HTML5           │                   └───────────────────────────┘
└──────────────────────────────┘
```

### Modelo de Datos y Extensión del Proyecto

- **Extensión de `Project` para Runtime HTML5 Editable**:
  - Se añade soporte opcional en `Project` para `customRuntime?: { jsCode?: string; cssCode?: string; headHtml?: string; customSounds?: Record<string, string>; customHtmlOverride?: string | null; orionHistory?: OrionChatMessage[] }`.
  - El generador HTML5 (`buildStandaloneGameHtml`) inyecta:
    1. Los datos completos del proyecto (`scenes`, `assets`, `settings`, distribución de objetos, capas y scripts) en una sección JSON formateada y legible dentro del HTML5 para que sea fácil de leer y editar.
    2. El sistema de sonidos WebAudio extensible (`window.AsternalAudio.registerSound(name, fnOrUrl)`), permitiendo definir nuevos efectos de sonido sintetizados o por URL desde el HTML5.
    3. La API de extensión en vivo (`window.AsternalRuntime.registerHook({ onInit, onTick, onCollide, onRender, onKey, customBlocks })`) ejecutada en cada fotograma del bucle nativo, permitiendo que Orión o el usuario creen cualquier lógica nueva (doble salto personalizado, proyectiles, gravedad invertida, enemigos con IA avanzada, efectos visuales en canvas, nuevos bloques, etc.).
- **Parser y Sincronizador Inverso (`parseStandaloneGameHtml`)**:
  - Cuando el documento HTML5 es editado (por Orión o manualmente en el editor de código HTML5), el sincronizador extrae el bloque de datos del proyecto, el bloque de código personalizado de runtime (`customRuntime.jsCode`), los estilos/HTML adicionales y actualiza el objeto `Project` del editor visual sin perder ningún cambio.
