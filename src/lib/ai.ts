/**
 * Asistente IA on-device (iOS 26+, Apple Intelligence) sobre el plugin nativo "ai"
 * (src-tauri/plugins/ai). Equivale en móvil al servidor MCP de escritorio: lee la salida de la
 * pestaña, busca en el catálogo y explica salidas. Nunca envía nada al equipo por su cuenta.
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { isIOS } from "./platform";
import { CatalogVendor, Risk, appliesTo, commandFor, computeRisk } from "./packs";

export interface AiAvailability {
  available: boolean;
  /** deviceNotEligible | appleIntelligenceNotEnabled | modelNotReady | osTooOld */
  reason?: string | null;
  localeSupported: boolean;
  contextSize: number;
}

export interface AiCommand {
  cmd: string;
  desc: string;
  cat: string;
  risk: Risk;
}

export interface AiContext {
  tab?: string;
  vendor?: string;
  platform?: string;
  output: string;
  commands: AiCommand[];
}

export type AiEvent =
  | { type: "delta" | "replace" | "tool" | "notice"; text?: string }
  | { type: "suggestions"; items: AiCommand[] };

export const AI_REASON: Record<string, string> = {
  deviceNotEligible: "Este equipo no es compatible con Apple Intelligence",
  appleIntelligenceNotEnabled: "Activa Apple Intelligence en Ajustes",
  modelNotReady: "El modelo de Apple Intelligence se está descargando",
  osTooOld: "Requiere iOS 26 o superior",
};

/**
 * Solo iOS. null cuando el plugin no existe o falla: el panel no se muestra. Con
 * modelNotReady se reintenta más tarde (el modelo se descarga en segundo plano).
 */
export async function aiAvailable(): Promise<AiAvailability | null> {
  if (!isIOS) return null;
  try {
    return await invoke<AiAvailability>("plugin:ai|ai_available");
  } catch {
    return null;
  }
}

/**
 * Primer recorte, antes de cruzar al lado nativo: el plugin limpia y ajusta de nuevo al
 * contexto real del modelo (4096 tokens en iOS 26), pero no tiene sentido mandarle 2000 líneas.
 */
export const AI_OUTPUT_LINES = 300;
export const AI_OUTPUT_CHARS = 16_000;

export function trimOutput(text: string): string {
  return text.length > AI_OUTPUT_CHARS ? text.slice(-AI_OUTPUT_CHARS) : text;
}

/**
 * Comandos del catálogo que aplican al equipo, con la sintaxis de su plataforma. El riesgo es el
 * mayor entre el del catálogo y el recalculado sobre la variante, como en el resto de la app.
 */
export function catalogFor(vendor: CatalogVendor | undefined, platform: string | null): AiCommand[] {
  if (!vendor) return [];
  const rank: Record<Risk, number> = { read: 0, change: 1, disruptive: 2 };
  return vendor.commands
    .filter((c) => appliesTo(c, platform))
    .map((c) => {
      const cmd = commandFor(c, platform);
      const computed = computeRisk(cmd);
      return { cmd, desc: c.desc.slice(0, 200), cat: c.cat, risk: rank[computed] > rank[c.risk] ? computed : c.risk };
    });
}

export function aiAsk(
  prompt: string,
  context: AiContext,
  mode: "chat" | "explain",
  onEvent: (e: AiEvent) => void,
): Promise<{ text: string; cancelled: boolean }> {
  const ch = new Channel<AiEvent>();
  ch.onmessage = onEvent;
  return invoke("plugin:ai|ai_ask", { prompt, context, mode, onEvent: ch });
}

export const aiCancel = () => invoke("plugin:ai|ai_cancel").catch(() => {});
export const aiReset = () => invoke("plugin:ai|ai_reset").catch(() => {});
