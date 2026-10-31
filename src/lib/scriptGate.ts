/**
 * Control de riesgo de los scripts Python. El backend (src-tauri/src/scripts.rs) arma cada
 * línea que el script envía, como la vería el equipo, y la pregunta aquí antes de escribir
 * su Enter. Se clasifica con el mismo computeRisk de Notas, catálogo y difusión.
 */
import { type Risk, computeRisk } from "./packs";

export interface GatePrompt {
  run: string;
  id: string;
  script: string;
  kind: "gate";
  /** Línea completa, con los secretos del script enmascarados. */
  line: string;
  /** Tiene teclas que el equipo interpreta (Tab, ?, Esc, Ctrl-D): no se sabe qué ejecuta. */
  opaque: boolean;
  /** Sesión donde se ejecutará. */
  session: string;
  /** Todos los destinos de la ejecución: la aprobación vale para cualquiera de ellos. */
  targets: string[];
  allowChanges: boolean;
}

export interface SecretPrompt {
  run: string;
  id: string;
  script: string;
  kind: "secret";
  label: string;
}

export type ScriptPrompt = GatePrompt | SecretPrompt;

/** Riesgo de una línea que un script quiere ejecutar. */
export function scriptLineRisk(line: string, opaque: boolean): Risk {
  if (opaque) return "disruptive";
  const l = line.trim();
  // Igual que la difusión: comentarios y salir de un modo no cambian nada.
  if (!l || /^(!|#|end$|exit$|quit$|return$)/i.test(l)) return "read";
  const risk = computeRisk(l);
  // Línea a línea se pierde el contexto: dentro de una interfaz, "shutdown" o
  // "no ip address" cortan servicio. Se evalúa como si viniera tras otra línea.
  if (risk !== "disruptive" && computeRisk(`!\n${l}`) === "disruptive") return "disruptive";
  return risk;
}

/**
 * true si la línea necesita confirmación. Por defecto los scripts son de solo lectura: un
 * cambio se confirma salvo que el usuario lanzara el script con "permitir cambios"; lo que
 * puede cortar servicio se confirma siempre, como en el resto de la app.
 */
export function scriptNeedsConfirm(risk: Risk, allowChanges: boolean): boolean {
  return risk === "disruptive" || (risk === "change" && !allowChanges);
}

/** Decisión automática para una línea, o null si hay que preguntar al usuario. */
export function autoDecision(p: GatePrompt): boolean | null {
  return scriptNeedsConfirm(scriptLineRisk(p.line, p.opaque), p.allowChanges) ? null : true;
}
