/** Alertas sonoras generadas con WebAudio (sin archivos de audio). */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freqs: number[], step = 0.18, type: OscillatorType = "sine", volume = 0.25) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.02;
  freqs.forEach((f, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = f;
    const start = t0 + i * step;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + step * 0.95);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + step);
  });
}

/** Caída: tres tonos descendentes, insistentes. */
export const alarmDown = () => tone([880, 660, 440, 880, 660, 440], 0.16, "square", 0.18);
/** Recuperación: dos tonos ascendentes, suaves. */
export const alarmUp = () => tone([523, 784], 0.2, "sine", 0.25);
/** Alerta por palabra clave: dos tonos breves, distintos de los del monitoreo. */
export const alertTone = () => tone([988, 740], 0.14, "triangle", 0.22);
