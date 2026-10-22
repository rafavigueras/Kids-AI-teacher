# Herramientas de apoyo

Scripts de Node que **no forman parte de la web**: la prueba de viabilidad (fase 0) del corrector
de dictados y el importador de los dictados del libro de la Comunidad de Madrid.

## `import-dictados-madrid.mjs`: dictados del PDF a `data/spanish/dictados.json`

```
node tools/import-dictados-madrid.mjs /ruta/a/dictados.pdf [--dry-run] [--out fichero.json]
```

Necesita `pdftotext` (poppler: `brew install poppler`). Lee con `-layout` las págs. 39-148
(Segundo ciclo, nº 81-160, y Tercer ciclo, nº 161-300; se omiten el Primer ciclo y los textos
genéricos), une las palabras partidas con guion, quita cabeceras, números de página y la línea
de autor (**no se guardan autores ni colegios**), y deja `id`, `title`, `level`, `text`, `rules`,
`number` y `source`. Antes de escribir comprueba que hay 80 y 140 dictados, que ninguno está
vacío ni lleva restos de cabecera, autor o «Reglas», ni guiones sin unir, y que el corte por ciclo
coincide con el índice del libro (págs. 175-181). Si algo falla, no escribe nada. Se puede repetir:
sustituye los dictados ya importados (los que tienen `number`) y respeta los demás. El PDF y las
extracciones de prueba (`tools/pdf-work/`, en `.gitignore`) no se suben al repositorio.

## `spike-dictado.mjs`: ¿lee bien Claude un dictado de un niño?

Antes de fiarse de la interfaz hay que comprobar tres cosas con fotos reales:

1. **¿Conserva las faltas?** El modelo debe transcribir `votella`, no «arreglarlo» a `botella`.
2. **¿Caen las cajas sobre la palabra?** El script dibuja las cajas sobre la foto.
3. **¿Cuánto cuesta y cuánto tarda** cada dictado?

El script usa el mismo prompt, el mismo esquema y la misma preparación de la imagen
(lado largo máximo 2576 px, JPEG 0,85) que la web: lo comparten desde `js/dictation-prompts.js`.

### Preparación (una vez)

```
cd tools
npm install
```

Pon las fotos en `tools/spike-photos/` (está en `.gitignore`: **el repo es público,
las fotos de los niños no se suben nunca**). Para cada una, si conoces el dictado,
guarda su texto original en un `.txt` con el mismo nombre.

### Uso

```
export ANTHROPIC_API_KEY=...        # la clave se lee del entorno, no se guarda en ningún fichero

# Con texto original: transcribe, compara y lista los fallos
node tools/spike-dictado.mjs tools/spike-photos/dictado1.jpg --ref tools/spike-photos/dictado1.txt

# Dictado libre (sin texto): Claude transcribe y marca los fallos él solo
node tools/spike-dictado.mjs tools/spike-photos/dictado2.jpg --free

# Solo transcripción y cajas
node tools/spike-dictado.mjs tools/spike-photos/dictado3.jpg
```

Foto girada o con mucho fondo (la web tiene los botones Girar y Recortar; aquí son opciones):

```
# Gira 90, 180 o 270 grados en el sentido del reloj (como el botón ↻ de la web)
node tools/spike-dictado.mjs tools/spike-photos/dictado4.jpg --free --rotate 270

# Recorta x,y,w,h en píxeles de la imagen original (con la orientación EXIF ya aplicada,
# antes de girar); si también hay --rotate, el recorte se gira con la foto
node tools/spike-dictado.mjs tools/spike-photos/dictado4.jpg --free --crop 100,200,1800,1200
```

Opciones: `--rotate 90|180|270`, `--crop x,y,w,h`, `--no-explain` (no llama a Claude para redactar las explicaciones),
`--out carpeta` (por defecto `tools/spike-photos/out/`),
`--from-json resultado.json` (vuelve a dibujar y a comparar una respuesta ya guardada,
sin llamar a la API ni gastar nada).

### Qué deja y qué mirar

En `tools/spike-photos/out/` quedan `<foto>.dictado.png` (la foto con todas las cajas en
verde, o en naranja si Claude duda, y los fallos con un subrayado rojo numerado bajo la caja; el de una
palabra que falta es un trazo corto a trazos con una marca ^) y `<foto>.dictado.json` (la respuesta tal cual, con el uso de tokens).

En modo libre, la consola imprime también los consejos de letra (palabras pegadas: no cuentan como fallo). Con `--from-json` sobre un JSON del esquema antiguo, sin `tips`, simplemente salen cero. La consola imprime la transcripción, la lista de fallos, los tokens, los segundos y el coste estimado.

Puerta de decisión antes de seguir con la web:

- **Faltas conservadas.** Compara la transcripción con lo que escribió el niño. Si el
  script avisa «cero fallos» y el niño sí tenía faltas, el modelo las está corrigiendo
  al leer: hay que ajustar el prompt o subir el `effort`.
- **Cajas.** Abre el PNG. Si los rectángulos no caen sobre las palabras, el plan B es
  marcar la línea o mostrar la transcripción con las palabras en rojo, en vez de círculos sobre la foto.
- **Coste y tiempo.** Se espera algo de 0,10 a 0,15 $ y de 20 a 60 s por dictado. Anota lo que salga.

Prueba con 5 o 6 fotos distintas: letra buena y mala, con tachones, con la foto torcida o
con poca luz, y alguna del iPad girada (el script respeta la orientación EXIF, como la web).
