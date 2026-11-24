# Precios para góndola

App para hacer los carteles de precios de la góndola rápido: cargás nombre y precio, y todo se acomoda solo en su lugar, con medidas reales en milímetros, listo para imprimir.

## Cómo abrirla

**No hay que instalar nada.** Descargá la carpeta completa (botón verde **Code → Download ZIP** en GitHub), descomprimila y hacé **doble clic en `index.html`**. Se abre en Chrome o Edge y funciona sin internet.

> Usá siempre el **mismo navegador** y la **misma carpeta**: los artículos se guardan dentro del navegador.

## Actualizar la app

Cuando haya cambios nuevos, la app te avisa con una franja azul arriba. Para actualizar:

1. En la carpeta de la app, hacé **doble clic en `ACTUALIZAR.bat`** (en Mac: `ACTUALIZAR-mac.command`).
2. Se abre una ventanita que baja la última versión, te dice qué cambió y reemplaza los archivos.
3. Volvé a la app y apretá **F5**.

**Tus artículos, plantillas y ajustes no se tocan**: se guardan en el navegador, no en la carpeta.
La primera vez Windows puede preguntar si querés ejecutarlo: elegí **Más información → Ejecutar de todas formas** (o **Ejecutar**).

## Uso diario

1. **Importar Excel**: exportá la lista de artículos desde tu sistema de caja (o armá un Excel con nombre y precio) y arrastralo. La app adivina qué es cada columna: nombre, precio, código, rubro y código de barras.
2. **Cuando cambian los precios**: importás el archivo nuevo y la app te muestra **qué precios cambiaron**. Con un botón los mandás a la cola.
3. **Imprimir**: *Ver hoja e imprimir*. Acomoda todos los carteles en la hoja (A4, Carta u Oficio), aunque sean de tamaños distintos, con líneas de corte.
   En la ventana de impresión elegí **Escala 100%**, **Márgenes: ninguno** y activá **Gráficos de fondo**.
   **Ajustar tamaños en vivo**: en la hoja, hacé clic en un cartel. A la derecha aparece su plantilla con el ancho y el alto: cambialos (o usá − / +) y la hoja se reacomoda al instante. Los botones verdes, por ejemplo "3 → 64,6", dejan la medida justa para que entren 3 por fila sin que sobre papel. Arriba de cada hoja dice qué porcentaje está aprovechado. Con "Volver a como estaba" deshacés los cambios.
4. Cuando la hoja salió bien: **"Salió bien: marcar impresos"**. Así la app sabe qué carteles de la góndola ya están al día.

## Carga rápida (pestaña Imprimir)

- Escribí parte del nombre o el código (o escaneá el código de barras), **Enter**, precio, **Enter**. Ya está en la cola.
- **Enter elige la primera sugerencia** (la que está marcada). Con las flechas ↑ ↓ elegís otra.
- Si el artículo no existe, se crea solo en el catálogo. Si querés crear uno nuevo aunque haya parecidos, elegí la última opción: **➕ Crear "…" como artículo nuevo**.
- Hay dos campos juntos: **Nombre** y **Código de barras (opcional)**. Podés completar los dos: el artículo se guarda con su nombre y su código, y después lo encontrás escribiendo el nombre o escaneando.
- Si escaneás en *Código de barras* un código que ya está cargado, se completa solo el nombre.
- Si escaneás un código que no está, queda puesto y escribís el nombre del artículo nuevo.
- Si elegís un artículo que ya existe y le ponés un código de barras, se le guarda.
- Podés **pegar una lista** entera, una línea por artículo: `Galletitas Oreo 118 g 1250`.
- Campo **Oferta**: el cartel sale con la franja "OFERTA" y el precio anterior tachado.

## Imprimir rápido con la cámara (celular)

Arriba en la pestaña **Imprimir**, el botón azul **Imprimir rápido con la cámara**:

1. Se abre la cámara: sacale una foto **de cerca** al código de barras del producto (en el iPhone, después tocá **Usar foto**).
2. La app reconoce el artículo y muestra el **cartel**, el **nombre**, el **precio** y el **código de barras**.
3. **✓ Confirmar** lo manda a la cola de impresión; **✕ Rechazar** lo descarta. En los dos casos se vuelve a abrir la cámara para el siguiente.
4. Cuando terminás, **Terminar**. En la compu ya tenés todo en la cola para imprimir.

- Si el código no está en el catálogo, te ofrece **cargarlo como nuevo**.
- Si no se puede leer la foto, sacá otra con más luz y más cerca, o escribí los números a mano abajo.
- En el celular conectado por Wi-Fi se usa una foto por producto (el navegador no deja usar la cámara en vivo en direcciones `http://192.168…`). En la compu (`localhost`) usa la cámara en vivo.

## Catálogo

- Búsqueda instantánea, sin importar tildes ni mayúsculas ("oreo 118" encuentra "Galletitas Oreo 118 g").
- Filtros: pendientes de imprimir, cambiados en la última semana, con oferta, sin categoría.
- **Aumento / descuento %** a una categoría, a la búsqueda o a los seleccionados, con redondeo (a $10, $50, etc.). Se puede deshacer.
- En las columnas Precio y Oferta: escribís y **Enter** (o las flechas ↑ ↓) pasa al siguiente artículo, como en Excel.
- **Ordenar** tocando el título de cualquier columna. "Estado" pone primero los pendientes de imprimir y lo último que cambió.
- Exportar a Excel.

## Plantillas

- Cada plantilla tiene medida en mm, margen, colores, borde, letra, franja superior y precio por kg/litro.
- **El texto se ajusta solo**: los nombres largos se achican o pasan a dos renglones, y el precio usa todo el espacio que tiene.
- **Plantilla según categoría**: por ejemplo, todas las GALLETITAS usan la plantilla chica sin tener que elegirla cada vez.

## Usar desde el celular (compu + iPhone en el mismo Wi-Fi)

Para cargar artículos o armar la cola desde el celular y terminar de ajustar e imprimir en la compu (o al revés), con los datos compartidos entre los dos:

1. **La primera vez**, si ya tenés artículos cargados: abrí la app como siempre y en **Ajustes y respaldo** descargá una copia de seguridad.
2. En la carpeta de la app hacé **doble clic en `COMPARTIR-CON-CELULAR.bat`**. Se abre una ventanita y la app sola en el navegador (`http://localhost:8787`).
   - La primera vez Windows pide permiso para que el celular pueda conectarse: elegí **Sí**.
   - Si la red Wi-Fi está como "Pública", la ventanita ofrece cambiarla a "Privada" (solo hacelo en la red de tu casa o negocio).
3. La primera vez, en esa app tocá **Restaurar una copia…** y elegí la copia del paso 1.
4. En el iPhone, conectado al **mismo Wi-Fi**, abrí Safari y escribí la dirección que muestra la ventanita (por ejemplo `http://192.168.1.25:8787`). Tip: **Compartir → Agregar a pantalla de inicio** y queda como una app.

Arriba a la derecha dice **● Conectado** cuando todo anda. Lo que cargás en un aparato aparece en el otro en unos segundos.
La ventanita tiene que quedar abierta en la compu mientras uses el celular (se puede minimizar). Los datos se guardan en la carpeta `datos-compartidos`, con un respaldo automático por día (se guardan los últimos 30).

> En la compu, en modo compartido usá siempre `http://localhost:8787` (no el doble clic en `index.html`): son dos lugares de guardado distintos.

## Copia de seguridad

En **Ajustes y respaldo → Descargar copia de seguridad**. Hacela una vez por semana (la app te lo recuerda) y guardala en un pendrive o mandátela por mail o WhatsApp. Con **Restaurar** recuperás todo, también en otra computadora.

## Archivos

- `index.html`: la app
- `ACTUALIZAR.bat` / `ACTUALIZAR-mac.command`: bajan la última versión (`tools/actualizar.ps1` hace el trabajo en Windows)
- `js/core.js`: formato de precios, ajuste automático del texto, acomodo en la hoja
- `js/app.js`: pantallas (carga rápida, catálogo, importador, plantillas, ajustes)
- `js/db.js`: base de datos local (IndexedDB)
- `COMPARTIR-CON-CELULAR.bat` + `tools/servidor.ps1`: servidor para usar la app desde el celular en la misma red
- `js/sync.js`: reparte los cambios entre los aparatos en modo compartido
- `lib/xlsx.full.min.js`: lector de Excel (SheetJS 0.18.5), incluido para que funcione sin internet
- `js/scanner.js` + `lib/zxing.min.js`: escanear códigos de barras con la cámara (ZXing 0.21.3, sin internet)
