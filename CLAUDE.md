# plugin-board

Plugin **Pizarra** de FlickerTalk (`Plan.md §53–§58`, plan de la pizarra 2026-09-27, fases 1 y 2).
Repo propio; el paquete lo firma y publica el catálogo (`FlickerTalk/web`).

- `module.json`: `com.flickertalk.board`, componente `ft-board`, permisos `send: propose`, `live`
  y `storage: large`, abre `application/x-ftboard` e `image/*`, `minCoreVersion` 1.1.0.
- `src/`: `model.js` (la pizarra: Y.Doc con el mapa `items`, registro de actualizaciones con
  hora, fichero `.ftboard`, `Replay`), `geometry.js` (cámara, mundo ↔ pantalla, encajar),
  `ink.js` (perfect-freehand → path SVG), `live.js` (protocolo `hello`/`sync`/`update`/`part`/`bye`
  sobre `ft.live`), `formula.js` (KaTeX + paleta), `i18n.js` (21 idiomas), `index.js` (el web
  component).
- `build.js` (esbuild) genera `dist/index.js` y copia las fuentes woff2 de KaTeX a `dist/fonts/`.
  **`dist/` se versiona**: es lo que firma el catálogo. Tras tocar `src/`: `npm run build`.
- `npm test`: Vitest + happy-dom sobre `src/`, con un núcleo falso en `index.test.js`.

## Reglas

- Nada sale del marco: sin red, sin `invoke`, sin ver la conversación. Solo la Plugin API.
- Un mensaje de `ft.live` no pasa de 48 KiB **decodificado** (`LIVE_LIMIT` del núcleo): lo que
  no cabe va en partes (`PART_SIZE`) y se recompone al otro lado.
- Lo que llega del otro lado se aplica con origen `remote-live`: no se deshace ni se reenvía.
- El registro de actualizaciones (`log`) es la copia de solo lectura, la reproducción y lo que
  sincroniza a quien llega tarde: no se poda.
- Iconos: solo los que presta el núcleo (`./icon/<nombre>.svg`). Textos: solo del catálogo, cada
  clave nueva en los 21 idiomas en el mismo cambio (el test lo exige).
- Código y comentarios en inglés; `.md` en español. Todo lo que entre en el bundle, compatible
  con MIT.
