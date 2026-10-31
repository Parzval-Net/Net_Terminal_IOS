import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Settings } from "../lib/settings";
import { type AlertRule, alertError, newAlert } from "../lib/alerts";

interface Props {
  settings: Settings;
  folders: string[];
  onChange: (patch: Partial<Settings>) => void;
}

/** Alertas por palabra clave sobre la salida de las sesiones. */
export function AlertSettings({ settings: s, folders, onChange }: Props) {
  const rules = s.alertRules ?? [];
  const [draft, setDraft] = useState<AlertRule | null>(null);
  const [sample, setSample] = useState("");

  const save = (list: AlertRule[]) => onChange({ alertRules: list });
  const commit = () => {
    if (!draft || alertError(draft)) return;
    const d = { ...draft, pattern: draft.pattern.trim(), name: draft.name.trim() };
    save(rules.some((r) => r.id === d.id) ? rules.map((r) => (r.id === d.id ? d : r)) : [...rules, d]);
    setDraft(null);
  };
  const error = draft ? alertError(draft) : null;
  let matches: boolean | null = null;
  if (draft && !error && sample) {
    try {
      const body = draft.regex ? draft.pattern.trim() : draft.pattern.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      matches = new RegExp(body, draft.caseSensitive ? "" : "i").test(sample);
    } catch {
      matches = null;
    }
  }

  return (
    <>
      <p className="text-[12px] text-muted">
        Avisan cuando una línea de salida contiene un texto o expresión: aviso en pantalla, sonido, marca en la pestaña y
        resaltado opcional. Como máximo un aviso cada 10 s por regla y sesión. Solo notifican, nunca envían comandos.
      </p>

      <div className="space-y-1.5">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 h-10">
            <label className="p-1 -m-1 grid place-items-center cursor-pointer">
              <input
                type="checkbox"
                checked={r.enabled}
                title={r.enabled ? "Activa" : "Inactiva"}
                onChange={(e) => save(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))}
              />
            </label>
            <div className="min-w-0 flex-1">
              <div className={`truncate ${r.enabled ? "" : "text-muted"}`}>{r.name || r.pattern}</div>
              <div className="text-[11px] text-muted truncate font-mono">
                {r.regex ? `/${r.pattern}/` : r.pattern}
                {r.folder ? ` · ${r.folder}` : ""}
              </div>
            </div>
            <button
              onClick={() => setDraft({ ...r })}
              title="Editar"
              className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover shrink-0"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => save(rules.filter((x) => x.id !== r.id))}
              title="Eliminar"
              className="w-7 h-7 grid place-items-center rounded-md text-muted hover:text-danger hover:bg-hover shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {!rules.length && <p className="text-[12px] text-muted">Sin alertas.</p>}
      </div>

      {!draft && (
        <button
          onClick={() => setDraft(newAlert())}
          className="flex items-center gap-1.5 px-3 h-7 rounded-md border border-line hover:bg-hover"
        >
          <Plus size={14} /> Nueva alerta
        </button>
      )}

      {draft && (
        <div className="rounded-lg border border-line p-3 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[12px] text-muted">Nombre</span>
              <input
                className="field"
                value={draft.name}
                placeholder="Ej: Interfaz caída"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[12px] text-muted">Sesiones</span>
              <select className="field" value={draft.folder} onChange={(e) => setDraft({ ...draft, folder: e.target.value })}>
                <option value="">Todas</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[12px] text-muted">{draft.regex ? "Expresión regular" : "Texto"}</span>
            <input
              className="field font-mono"
              autoFocus
              value={draft.pattern}
              placeholder={draft.regex ? "BGP.*Down" : "%LINK-3-UPDOWN"}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
            {(
              [
                ["regex", "Expresión regular"],
                ["caseSensitive", "Distinguir mayúsculas"],
                ["toast", "Aviso"],
                ["sound", "Sonido"],
                ["markTab", "Marcar pestaña"],
                ["highlight", "Resaltar"],
                ["enabled", "Activa"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-[var(--accent)]" checked={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <input
            className="field font-mono !text-[12px]"
            value={sample}
            placeholder="Probar con una línea de salida"
            onChange={(e) => setSample(e.target.value)}
          />
          {error ? (
            <p className="text-[11.5px] text-danger">{error}</p>
          ) : (
            matches !== null && (
              <p className={`text-[11.5px] ${matches ? "text-accent" : "text-muted"}`}>
                {matches ? "Coincide: esta línea genera una alerta" : "No coincide"}
              </p>
            )
          )}
          <div className="flex flex-wrap justify-end gap-1.5">
            <button onClick={() => setDraft(null)} className="px-3 h-7 rounded-md hover:bg-hover">
              Cancelar
            </button>
            <button
              onClick={commit}
              disabled={!!error}
              className="px-3 h-7 rounded-md bg-accent text-accent-fg font-medium hover:opacity-90 disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
