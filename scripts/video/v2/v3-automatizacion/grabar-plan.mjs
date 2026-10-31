// Pausas de la línea de tiempo del video 3 (segundos), compartidas por grabar.mjs y plan.mjs.
// Dentro de un bloque las pausas de coma y oración las pone tts_kokoro.py.
export const PAUSAS = {
  BLOQUE: 0.5, // entre párrafos de una misma toma
  ENTRADA: 0.2, // antes de la primera frase de una toma
  SALIDA: 0.25, // después de la última
};
