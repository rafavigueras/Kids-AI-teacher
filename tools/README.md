# Herramientas de apoyo

Scripts de Node que **no forman parte de la web**. Hoy solo hay uno: la prueba de
viabilidad (fase 0) del corrector de dictados.

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

Opciones: `--no-explain` (no llama a Claude para redactar las explicaciones),
`--out carpeta` (por defecto `tools/spike-photos/out/`),
`--from-json resultado.json` (vuelve a dibujar y a comparar una respuesta ya guardada,
sin llamar a la API ni gastar nada).

### Qué deja y qué mirar

En `tools/spike-photos/out/` quedan `<foto>.dictado.png` (la foto con todas las cajas en
verde, o en naranja si Claude duda, y los fallos en círculos rojos numerados; los de una
palabra que falta van a trazos) y `<foto>.dictado.json` (la respuesta tal cual, con el uso de tokens).

La consola imprime la transcripción, la lista de fallos, los tokens, los segundos y el coste estimado.

Puerta de decisión antes de seguir con la web:

- **Faltas conservadas.** Compara la transcripción con lo que escribió el niño. Si el
  script avisa «cero fallos» y el niño sí tenía faltas, el modelo las está corrigiendo
  al leer: hay que ajustar el prompt o subir el `effort`.
- **Cajas.** Abre el PNG. Si los rectángulos no caen sobre las palabras, el plan B es
  marcar la línea o mostrar la transcripción con las palabras en rojo, en vez de círculos sobre la foto.
- **Coste y tiempo.** Se espera algo de 0,10 a 0,15 $ y de 20 a 60 s por dictado. Anota lo que salga.

Prueba con 5 o 6 fotos distintas: letra buena y mala, con tachones, con la foto torcida o
con poca luz, y alguna del iPad girada (el script respeta la orientación EXIF, como la web).
