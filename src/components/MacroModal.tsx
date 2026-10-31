import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Macro } from "../lib/settings";
import { isMobile } from "../lib/platform";
import { useDragResize } from "../lib/useDragResize";

interface Props {
  initial: Macro | null;
  onSave: (m: Macro) => void;
  onClose: () => void;
}

export function MacroModal({ initial, onSave, onClose }: Props) {
  const [m, setM] = useState<Macro>(
    initial ?? { id: `m${Date.now().toString(36)}`, label: "", kind: "send", text: "" },
  );
  const [scripts, setScripts] = useState<string[]>([]);
  const [pickError, setPickError] = useState("");
  const win = useDragResize<HTMLFormElement>("macroWindow");

  useEffect(() => {
    if (!isMobile) invoke<string[]>("list_scripts").then(setScripts).catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Trae un .py de cualquier carpeta a scripts/ (el diálogo lo abre el backend) y lo selecciona.
  const browse = async () => {
    setPickError("");
    try {
      const name = await invoke<string | null>("import_script");
      if (!name) return;
      setScripts(await invoke<string[]>("list_scripts").catch(() => [...scripts, name]));
      setM((cur) => ({ ...cur, script: name, label: cur.label.trim() ? cur.label : name.replace(/\.py$/, "") }));
    } catch (e) {
      setPickError(String(e));
    }
  };

  const valid = m.label.trim() && (m.kind === "send" ? m.text?.trim() : m.script);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-2 sm:p-4" onMouseDown={onClose}>
      <form
        {...win.box}
        className="w-full sm:w-[460px] bg-panel border border-line rounded-xl shadow-pop sm:resize overflow-hidden flex flex-col min-w-0 sm:min-w-[360px] min-h-0 sm:min-h-[260px] max-w-[calc(100vw-1rem)] sm:max-w-[96vw] max-h-[96vh] sm:max-h-[94vh]"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ ...m, label: m.label.trim() });
        }}
      >
        <header {...win.handle} className="shrink-0 px-3 sm:px-5 h-12 flex items-center border-b border-line select-none">
          <h2 className="text-[14px] font-semibold">{initial ? "Editar botón" : "Nuevo botón"}</h2>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4">
          <label className="block">
            <span className="block mb-1 text-[11.5px] font-medium text-muted">Etiqueta</span>
            <input
              autoFocus
              className="field"
              value={m.label}
              placeholder="Ej: Respaldo config"
              onChange={(e) => setM({ ...m, label: e.target.value })}
            />
          </label>
          {!isMobile && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-hover">
              {(
                [
                  ["send", "Enviar texto"],
                  ["script", "Script Python"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setM({ ...m, kind: k })}
                  className={`h-8 rounded-md text-[12.5px] ${m.kind === k ? "bg-panel shadow-sm" : "text-muted hover:text-fg"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {m.kind === "send" ? (
            <label className="block">
              <span className="block mb-1 text-[11.5px] font-medium text-muted">
                Comandos (uno por línea, admite {"{{variables}}"})
              </span>
              <textarea
                className="field !h-32 py-2 font-mono !text-[12px] resize-y"
                spellCheck={false}
                value={m.text ?? ""}
                placeholder={"show interface {{interfaz}}\nshow log | include {{interfaz}}"}
                onChange={(e) => setM({ ...m, text: e.target.value })}
              />
            </label>
          ) : (
            <div className="block">
              <span className="block mb-1 text-[11.5px] font-medium text-muted">Script</span>
              <div className="flex flex-wrap sm:flex-nowrap gap-2">
                <select
                  aria-label="Script"
                  className="field flex-1 min-w-0"
                  value={m.script ?? ""}
                  onChange={(e) => setM({ ...m, script: e.target.value })}
                >
                  <option value="" disabled>
                    Selecciona un script
                  </option>
                  {scripts.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={browse}
                  title="Elegir un .py de cualquier carpeta: se copia a scripts/"
                  className="w-full sm:w-auto shrink-0 px-3 h-8 rounded-md border border-line hover:bg-hover text-[12.5px]"
                >
                  Buscar en el equipo…
                </button>
              </div>
              {pickError && <span className="block mt-1.5 text-[11.5px] text-danger">{pickError}</span>}
              <span className="block mt-1.5 text-[11.5px] text-muted">
                Los scripts viven en la carpeta de datos, en <code>scripts/</code>. Usan{" "}
                <code>import netterminal as nt</code> y requieren Python 3 instalado. Si eliges uno de otra carpeta, se copia ahí.
              </span>
            </div>
          )}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 px-3 sm:px-5 py-3 border-t border-line">
          <button type="button" onClick={onClose} className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md border border-line hover:bg-hover text-[13px] font-medium sm:font-normal touch-manipulation">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="px-4 sm:px-3.5 h-10 sm:h-8 rounded-xl sm:rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40 text-[13px] touch-manipulation"
          >
            Guardar
          </button>
        </footer>
      </form>
    </div>
  );
}
