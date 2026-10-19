# Editor Asternal

Editor nativo de juegos de Asternal extraído del portal original y preparado para abrirse directamente en una página web.

## Incluye

- Constructor de escenas y capas.
- Inspector de objetos y biblioteca de recursos.
- Editor de interfaz (UI).
- Editor de texturas y pintura.
- Animaciones por sprites.
- Editor de scripts.
- Vista previa integrada con `PLAY`.
- Proyectos y biblioteca guardados localmente en el navegador.

La aplicación no necesita base de datos ni credenciales para funcionar en modo local. Las funciones de sincronización y publicación que dependían del portal original quedan disponibles en el código, pero el editor abre y guarda proyectos localmente por defecto.

## Desarrollo

```bash
pnpm install --no-frozen-lockfile --ignore-scripts
pnpm dev
```

Abre `http://localhost:3000/` o `http://localhost:3000/editor`.

## Compilación

```bash
pnpm install --no-frozen-lockfile --ignore-scripts
pnpm exec vite build
```

La salida queda en `dist/public`.
