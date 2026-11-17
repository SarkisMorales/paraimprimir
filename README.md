# Precios para góndola

App para hacer los carteles de precios de la góndola rápido: cargás nombre y precio, y todo se acomoda solo en su lugar, con medidas reales en milímetros, listo para imprimir.

## Cómo abrirla

**No hay que instalar nada.** Descargá la carpeta completa (botón verde **Code → Download ZIP** en GitHub), descomprimila y hacé **doble clic en `index.html`**. Se abre en Chrome o Edge y funciona sin internet.

> Usá siempre el **mismo navegador** y la **misma carpeta**: los artículos se guardan dentro del navegador.

## Uso diario

1. **Importar Excel**: exportá la lista de artículos desde tu sistema de caja (o armá un Excel con nombre y precio) y arrastralo. La app adivina qué es cada columna: nombre, precio, código, rubro y código de barras.
2. **Cuando cambian los precios**: importás el archivo nuevo y la app te muestra **qué precios cambiaron**. Con un botón los mandás a la cola.
3. **Imprimir**: *Ver hoja e imprimir*. Acomoda todos los carteles en la hoja (A4, Carta u Oficio), aunque sean de tamaños distintos, con líneas de corte.
   En la ventana de impresión elegí **Escala 100%**, **Márgenes: ninguno** y activá **Gráficos de fondo**.
4. Cuando la hoja salió bien: **"Salió bien: marcar impresos"**. Así la app sabe qué carteles de la góndola ya están al día.

## Carga rápida (pestaña Imprimir)

- Escribí parte del nombre o el código (o escaneá el código de barras), **Enter**, precio, **Enter**. Ya está en la cola.
- Si el artículo no existe, se crea solo en el catálogo.
- Podés **pegar una lista** entera, una línea por artículo: `Galletitas Oreo 118 g 1250`.
- Campo **Oferta**: el cartel sale con la franja "OFERTA" y el precio anterior tachado.

## Catálogo

- Búsqueda instantánea, sin importar tildes ni mayúsculas ("oreo 118" encuentra "Galletitas Oreo 118 g").
- Filtros: pendientes de imprimir, cambiados en la última semana, con oferta, sin categoría.
- **Aumento / descuento %** a una categoría, a la búsqueda o a los seleccionados, con redondeo (a $10, $50, etc.). Se puede deshacer.
- En la columna Precio: escribís y **Enter** pasa al siguiente artículo.
- Exportar a Excel.

## Plantillas

- Cada plantilla tiene medida en mm, margen, colores, borde, letra, franja superior y precio por kg/litro.
- **El texto se ajusta solo**: los nombres largos se achican o pasan a dos renglones, y el precio usa todo el espacio que tiene.
- **Plantilla según categoría**: por ejemplo, todas las GALLETITAS usan la plantilla chica sin tener que elegirla cada vez.

## Copia de seguridad

En **Ajustes y respaldo → Descargar copia de seguridad**. Hacela una vez por semana (la app te lo recuerda) y guardala en un pendrive o mandátela por mail o WhatsApp. Con **Restaurar** recuperás todo, también en otra computadora.

## Archivos

- `index.html`: la app
- `js/core.js`: formato de precios, ajuste automático del texto, acomodo en la hoja
- `js/app.js`: pantallas (carga rápida, catálogo, importador, plantillas, ajustes)
- `js/db.js`: base de datos local (IndexedDB)
- `lib/xlsx.full.min.js`: lector de Excel (SheetJS 0.18.5), incluido para que funcione sin internet
