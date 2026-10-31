/**
 * Preferencias de esta ventana en localStorage (paneles, anchos, borradores). Sin
 * almacenamiento (modo privado, cuota llena) se usa el valor por defecto y no se recuerda.
 */
export function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento local: no se recuerda */
  }
}

/** Último módulo usado en Herramientas: ToolsView lo lee al montarse para volver donde se estaba. */
export const TOOLS_MODULE_KEY = "toolsModule";
/** Evento de ventana para cambiar de módulo cuando Herramientas ya está montada (detail: ModuleId). */
export const TOOLS_MODULE_EVENT = "nt-tools-module";
