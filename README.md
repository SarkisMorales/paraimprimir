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
- Podés **pegar una lista** entera, una línea por artículo: `Galletitas Oreo 118 g 1250`.
- Campo **Oferta**: el cartel sale con la franja "OFERTA" y el precio anterior tachado.

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

## Copia de seguridad

En **Ajustes y respaldo → Descargar copia de seguridad**. Hacela una vez por semana (la app te lo recuerda) y guardala en un pendrive o mandátela por mail o WhatsApp. Con **Restaurar** recuperás todo, también en otra computadora.

## Archivos

- `index.html`: la app
- `ACTUALIZAR.bat` / `ACTUALIZAR-mac.command`: bajan la última versión (`tools/actualizar.ps1` hace el trabajo en Windows)
- `js/core.js`: formato de precios, ajuste automático del texto, acomodo en la hoja
- `js/app.js`: pantallas (carga rápida, catálogo, importador, plantillas, ajustes)
- `js/db.js`: base de datos local (IndexedDB)
- `lib/xlsx.full.min.js`: lector de Excel (SheetJS 0.18.5), incluido para que funcione sin internet
