import { useEffect, useState } from "react";
import { useDragResize } from "../lib/useDragResize";
import { isSecretVar } from "../lib/templateSecrets";

export const TEMPLATE_VAR = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function templateVars(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VAR)].map((m) => m[1]))];
}

export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(TEMPLATE_VAR, (_, name: string) => values[name] ?? "");
}

const STORE = "templateValues";


function remembered(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return {};
  }
}

interface Props {
  text: string;
  onSubmit: (filled: string) => void;
  onCancel: () => void;
}

/** Pide el valor de cada {{variable}} de una plantilla antes de enviarla. */
export function TemplateDialog({ text, onSubmit, onCancel }: Props) {
  const names = templateVars(text);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const prev = remembered();
    return Object.fromEntries(names.map((n) => [n, isSecretVar(n) ? "" : (prev[n] ?? "")]));
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const win = useDragResize<HTMLFormElement>("templateWindow");
  const missing = names.filter((n) => !values[n]?.trim());
  const masked = Object.fromEntries(names.map((n) => [n, isSecretVar(n) && values[n] ? "••••••" : (values[n] ?? "")]));
  const preview = fillTemplate(text, masked).split("\n").slice(0, 6).join("\n");

  const submit = () => {
    if (missing.length) return;
    try {
      // Se descartan además secretos guardados por versiones anteriores.
      const keep = Object.entries({ ...remembered(), ...values }).filter(([n]) => !isSecretVar(n));
      localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(keep)));
    } catch {
      /* sin almacenamiento: no se recuerdan valores */
    }
    onSubmit(fillTemplate(text, values));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onCancel}>
      <form
        {...win.box}
        className="w-full sm:w-[440px] bg-panel border border-line rounded-xl shadow-pop sm:resize overflow-hidden flex flex-col min-w-0 sm:min-w-[360px] min-h-0 sm:min-h-[260px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[94vh]"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header {...win.handle} className="shrink-0 px-3 sm:px-5 pt-4 pb-2 select-none">
          <h2 className="text-[14px] font-semibold">Completar plantilla</h2>
          <p className="text-muted text-[12px]">Los valores se recuerdan para la próxima vez, salvo contraseñas y claves.</p>
        </header>
        <div className="flex-1 min-h-0 px-3 sm:px-5 py-2 space-y-2.5 overflow-y-auto">
          {names.map((n, i) => (
            <label key={n} className="grid grid-cols-1 sm:grid-cols-[140px_1fr] items-start sm:items-center gap-1 sm:gap-3">
              <span className="font-mono text-[12px] truncate" title={n}>
                {n}
              </span>
              <input
                className="field"
                autoFocus={i === 0}
                type={isSecretVar(n) ? "password" : "text"}
                autoComplete="off"
                value={values[n] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <pre className="mx-3 sm:mx-5 my-3 p-2.5 rounded-lg bg-hover text-[11.5px] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto select-text">
          {preview}
        </pre>
        <footer className="flex flex-wrap justify-end gap-2 px-3 sm:px-5 py-3 border-t border-line">
          <button type="button" onClick={onCancel} className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover text-[13px] font-medium sm:font-normal touch-manipulation">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={missing.length > 0}
            className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40 text-[13px] touch-manipulation"
          >
            Continuar
          </button>
        </footer>
      </form>
    </div>
  );
}
