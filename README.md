# plugin-board

**Pizarra** para [FlickerTalk](https://flickertalk.com). Una pizarra infinita con trazo a mano,
texto, fórmulas (LaTeX, con teclado de símbolos para quien no lo sabe) e imágenes, para dar una
clase: se guarda en el teléfono, se envía como fichero `.ftboard`, se abre en solo lectura al otro
lado, se reproduce trazo a trazo y, desde una conversación donde los dos tienen el plugin, se
dibuja **en directo** por la conexión directa (fases 1 y 2 del plan de la pizarra, 2026-09-27).

Todo ocurre en el teléfono: el plugin no tiene red, no ve la conversación ni la identidad del
contacto. Lo que produce lo envía la app, nunca el plugin; lo que dice en directo va por el canal
`ft.live` del núcleo, cifrado como todo lo demás y solo por la conexión directa: nunca por el buzón
ni por el servidor.

## Qué hace

- **Lienzo infinito**: desplazar con un dedo (herramienta «mano»), acercar con dos (o rueda +
  Ctrl), botones de zoom y «ver todo».
- **Trazo** (`perfect-freehand`, MIT) con presión si el lápiz la da; cinco colores, tres grosores.
- **Texto** y **fórmulas** (KaTeX, MIT): se tocan para colocarlas; la fórmula se escribe en LaTeX
  o con la paleta (fracción, raíz, potencias, sumatorio, integral, griegas…), con vista previa.
- **Imágenes**: del selector del sistema, colocadas en el centro de la vista.
- **Seleccionar, mover, quitar, deshacer y rehacer** (solo lo que hizo este teléfono).
- **Guardar** o **enviar** la pizarra como `.ftboard` (JSON: instantánea + registro de cambios
  con hora). Un `.ftboard` recibido se abre **en solo lectura**, con «guardar una copia».
- **Reproducir**: la línea de tiempo recorre el registro de cambios; con «play» va al ritmo al
  que se dio la clase (entre 60 ms y 1,5 s por paso).
- **En directo** (permiso `live`): en una conversación donde los dos tienen el plugin **abierto**,
  el profesor activa «en directo»; al otro lado la pizarra aparece sola, y desde entonces cada
  cambio llega en menos de 100 ms. Quien entra con una copia antigua recibe solo lo que le falta
  (sincronización de Yjs). Los dos pueden dibujar en esta versión (sin roles todavía).
- **Presentar en una llamada** (desde la 1.1.0): la app abre el plugin con `presenting`. Quien
  presenta (`lead`) entra en directo él solo con la pizarra que muestra, sin el interruptor de
  directo ni «enviar», y vuelve a saludar cuando el otro lo pide (`ask`); quien mira (`follow`)
  ve la pizarra en solo lectura, sin herramientas ni vuelta a la lista, y puede guardar una copia.
  Sin `presenting` nada cambia. Desde la 1.1.1, quien presenta recuerda qué pizarra muestra: si
  sale de la pantalla de la llamada y vuelve (la app cierra el plugin), se abre en esa pizarra y
  vuelve al directo, no en la lista; si la pizarra ya no está, o había vuelto a la lista, se abre
  la lista.
- **Abrir con**: `application/x-ftboard` y `image/*` (una imagen abre una pizarra nueva con ella).

## Qué usa del núcleo

| Capacidad     | Para qué                                                              |
| ------------- | --------------------------------------------------------------------- |
| `ft.records`  | cada pizarra en dos registros (`board/<id>/meta`, `board/<id>/body`); `storage: large` (256 MB) |
| `ft.store`    | la pizarra que se presenta (`present`), para volver a ella             |
| `ft.live`     | el directo 1 a 1, en mensajes de ≤ 48 KiB (los grandes van en partes) |
| `ft.send` / `ft.save` | el fichero `.ftboard` (`send: propose`: lo envía el usuario)  |
| `ft.pickFile` | las imágenes                                                          |
| `onOpen`      | `file` (abrir con), `live` (si el directo es posible), `presenting` (`lead`/`follow`, en una llamada), `lang` |

Necesita el núcleo **1.6.0** (`minCoreVersion`). El contrato está en
[plugin-sdk](https://github.com/FlickerTalk/plugin-sdk).

Desde la 1.0.3 la ventana va en los envoltorios de Ionic que la app presta al marco (barras en
`ion-header > ion-toolbar`, cuerpo en `ion-content`, botones de Ionic, confirmar y renombrar con
`ion-alert`), así que se ve como el resto de FlickerTalk; el lienzo es el de siempre. El paquete no
lleva Ionic: `@ionic/core` es solo `devDependency`, para que los tests pinten lo mismo que el
teléfono.

## Formato del fichero

```json
{ "format": "ftboard", "version": 1, "id": "…", "name": "…", "createdAt": 0, "updatedAt": 0,
  "snapshot": "<base64 de Y.encodeStateAsUpdate>",
  "updates": [ { "t": 1700000000000, "u": "<base64 de una actualización de Yjs>" } ] }
```

Cada elemento del mapa `items` de Yjs es un objeto `{kind, x, y, z, …}`: `ink` (`points`
`[x, y, presión]` relativos a su esquina, `color`, `size`, `w`, `h`), `text` (`text`, `size`,
`color`), `formula` (`latex`, `size`, `color`) e `image` (`src` como data URL, `w`, `h`).

## Desarrollo

```sh
npm install
npm test          # Vitest + happy-dom, sobre src/
npm run build     # esbuild: src/ → dist/index.js (+ dist/fonts/*.woff2 de KaTeX)
```

Es el primer plugin con paso de build: `dist/` se genera y **se versiona**, porque el paquete que
firma el catálogo es `module.json` + `dist/` tal cual. Tras cambiar `src/`, `npm run build` y
commit de `dist/`. Pesa unos 770 KB (461 KB de JS con Yjs, perfect-freehand y KaTeX; 300 KB de
fuentes): no es una semilla, se descarga del catálogo al activarlo. Las fuentes de KaTeX se
declaran en el documento del marco (un shadow DOM no carga las suyas) y se sirven desde
`./dist/fonts/`; la CSP del marco lo permite (`font-src` del propio origen).

Licencias de lo que va dentro: Yjs (MIT), perfect-freehand (MIT), KaTeX (MIT, fuentes incluidas
bajo la misma licencia).

## Licencia

MIT.
