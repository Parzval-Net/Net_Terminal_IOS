import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { type HlRule, regexError, riskyRegex } from "./highlight";
import { alertTone } from "./sound";

/**
 * Alerta por palabra clave: el backend la evalúa por línea sobre la salida limpia (motor
 * lineal de Rust) y avisa como máximo una vez cada 10 s por regla y sesión. Solo notifica:
 * nunca envía nada al equipo.
 */
export interface AlertRule {
  id: string;
  name: string;
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  enabled: boolean;
  /** Carpeta de sesiones (incluye subcarpetas). Vacía: todas. */
  folder: string;
  toast: boolean;
  sound: boolean;
  markTab: boolean;
  /** Además resalta la coincidencia en la terminal. */
  highlight: boolean;
}

export interface AlertHit {
  conn: string;
  rule: string;
  line: string;
}

const base = { regex: false, caseSensitive: true, enabled: false, folder: "", toast: true, sound: false, markTab: true, highlight: false };

/** Ejemplos incluidos, desactivados hasta que el usuario los active. */
export const exampleAlerts: AlertRule[] = [
  { ...base, id: "ex-updown", name: "Interfaz cambió de estado", pattern: "%LINK-3-UPDOWN" },
  { ...base, id: "ex-restart", name: "Equipo reiniciado", pattern: "%SYS-5-RESTART", sound: true },
  { ...base, id: "ex-bgp", name: "Vecino BGP caído", pattern: "BGP.*Down", regex: true, caseSensitive: false, sound: true },
];

export function newAlert(): AlertRule {
  return { ...base, enabled: true, id: `a${Date.now().toString(36)}`, name: "", pattern: "" };
}

/** Valida una regla; devuelve el mensaje de error o null. */
export function alertError(r: AlertRule): string | null {
  const p = r.pattern.trim();
  if (!p) return "Escribe el texto o la expresión a buscar";
  if (p.length > 500) return "Máximo 500 caracteres";
  if (!r.regex) return null;
  // El motor del backend (Rust) es lineal: no admite lookaround ni referencias como \1.
  if (/\(\?<?[=!]|\\[1-9]/.test(p)) return "No se admiten lookahead/lookbehind ni referencias (\\1)";
  return regexError(p) ?? riskyRegex(p);
}

/** Reglas activas en el formato del backend. */
function backendRules(rules: AlertRule[]) {
  return rules
    .filter((r) => r.enabled && !alertError(r))
    .map((r) => ({ id: r.id, pattern: r.pattern.trim(), regex: r.regex, caseSensitive: r.caseSensitive, folder: r.folder || null }));
}

export function inFolder(session: string | undefined, scope: string): boolean {
  const s = (session ?? "").replace(/^\/+|\/+$/g, "");
  const f = scope.replace(/^\/+|\/+$/g, "");
  return !f || s === f || s.startsWith(f + "/");
}

/** Reglas de resaltado derivadas de las alertas con "resaltar" activo para esa sesión. */
export function alertHighlights(rules: AlertRule[] | undefined, folder: string | undefined): HlRule[] {
  return (rules ?? [])
    .filter((r) => r.enabled && r.highlight && inFolder(folder, r.folder) && !alertError(r))
    .map((r) => ({
      id: `alert-${r.id}`,
      name: r.name,
      pattern: r.regex ? r.pattern.trim() : r.pattern.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ignoreCase: !r.caseSensitive,
      style: { color: "white", bg: "red", bold: true },
    }));
}

/**
 * Envía las reglas al backend cuando cambian y atiende los avisos. Sin reglas activas el
 * backend no evalúa nada.
 */
export function useAlerts(
  rules: AlertRule[] | undefined,
  onHit: (hit: AlertHit, rule: AlertRule) => void,
  onError: (msg: string) => void,
) {
  const active = JSON.stringify(backendRules(rules ?? []));
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const hitRef = useRef(onHit);
  hitRef.current = onHit;
  const errRef = useRef(onError);
  errRef.current = onError;

  useEffect(() => {
    invoke("alerts_configure", { rules: JSON.parse(active) }).catch((e) => errRef.current(`Alertas: ${e}`));
  }, [active]);

  const any = active !== "[]";
  useEffect(() => {
    if (!any) return;
    const un = listen<AlertHit>("alert-hit", ({ payload }) => {
      const rule = rulesRef.current?.find((r) => r.id === payload.rule);
      if (!rule) return;
      if (rule.sound) alertTone();
      hitRef.current(payload, rule);
    });
    return () => {
      un.then((f) => f());
    };
  }, [any]);
}
