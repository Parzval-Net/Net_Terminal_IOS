import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Radio } from "lucide-react";
import {
  TargetMode,
  openFolders,
  resolveTargets,
  setBroadcastTarget,
  targetLabel,
  useBroadcastTarget,
  useWorkspace,
} from "../lib/broadcast";

/**
 * Selector de destino para Notas, catálogo y botones: pestaña actual (por defecto),
 * pestañas elegidas, una carpeta de sesiones o los paneles visibles.
 */
export const BroadcastTargetPicker = memo(function BroadcastTargetPicker() {
  const target = useBroadcastTarget();
  const ws = useWorkspace();
  // Posición fija (sobre el botón): la barra de botones recorta lo que se sale de ella.
  const [open, setOpen] = useState<{ right: number; bottom: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const count = useMemo(() => {
    if (target.mode === "current") return null;
    const r = resolveTargets(
      target,
      ws.tabs.map((t) => ({ id: t.id, session: t.session, title: t.title })),
      (id) => ws.tabs.find((t) => t.id === id)?.status,
      ws.activeId,
      ws.panes,
    );
    return r.targets.length;
  }, [target, ws]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("touchstart", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("touchstart", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const multi = target.mode !== "current";
  const shortLabel =
    target.mode === "folder" ? target.folder.split("/").pop() || "Carpeta" : target.mode === "panes" ? "Paneles" : "Pestañas";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const isMobileNav = window.innerWidth < 640;
          const bottomMargin = isMobileNav ? 56 + 8 : 6;
          const popoverW = Math.min(288, window.innerWidth - 16);
          const idealRight = window.innerWidth - r.right;
          const right = Math.max(8, Math.min(idealRight, window.innerWidth - popoverW - 8));
          setOpen((o) => (o ? null : { right, bottom: window.innerHeight - r.top + bottomMargin }));
        }}
        title="Elegir a qué sesiones se envía"
        aria-label={multi ? `Destino: ${targetLabel(target, ws)}, ${count} conectadas` : "Destino: pestaña actual"}
        className={`flex items-center gap-1 px-2 h-6 rounded-md text-[11.5px] border select-none touch-manipulation active:bg-hover ${
          multi ? "border-warn text-warn font-medium" : "border-transparent text-muted hover:text-fg hover:bg-hover"
        }`}
      >
        {multi && <Radio size={12} />}
        <span className="max-w-[90px] @[52rem]:max-w-[140px] truncate">
          {multi ? (
            `${shortLabel} (${count})`
          ) : (
            <>
              {/* Barra angosta: "Actual" deja lugar a las etiquetas de las herramientas. */}
              <span className="@[52rem]:hidden">Actual</span>
              <span className="hidden @[52rem]:inline">Pestaña actual</span>
            </>
          )}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="fixed z-40 w-72 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-80px)] overflow-y-auto bg-panel border border-line rounded-lg shadow-pop p-1.5 text-fg"
          style={open}
          role="dialog"
          aria-label="Destino del envío"
        >
          <TargetOptions />
          <p className="px-2 pt-1.5 pb-0.5 text-[11px] text-muted leading-snug border-t border-line mt-1">
            Antes de enviar se confirma la lista de equipos. Se omiten terminales locales y pestañas desconectadas. Los scripts
            usan este destino al lanzarse; "Escribir" va solo a la pestaña actual.
          </p>
        </div>
      )}
    </div>
  );
});

/**
 * Opciones de destino (pestaña actual, pestañas elegidas, carpeta, paneles). Las usan el
 * selector de la barra y el diálogo para lanzar scripts: el destino es uno solo para toda
 * la app.
 */
export function TargetOptions() {
  const target = useBroadcastTarget();
  const ws = useWorkspace();
  const folders = useMemo(() => openFolders(ws), [ws]);
  const remote = ws.tabs.filter((t) => t.session.type !== "local");
  const option = (mode: TargetMode, label: string, disabled = false, hint?: string) => (
    <label className={`flex items-center gap-2 px-2 h-7 rounded-md text-[12px] ${disabled ? "opacity-40" : "hover:bg-hover"}`} title={hint}>
      <input
        type="radio"
        name="bc-mode"
        className="accent-[var(--accent)]"
        checked={target.mode === mode}
        disabled={disabled}
        onChange={() => setBroadcastTarget({ mode })}
      />
      {label}
    </label>
  );
  return (
    <>
      {option("current", "Pestaña actual")}
      {option("tabs", "Pestañas elegidas", remote.length === 0)}
      {target.mode === "tabs" && (
        <div className="ml-6 mb-1 max-h-40 overflow-y-auto">
          {remote.map((t) => (
            <label key={t.id} className="flex items-center gap-2 px-1 h-6 text-[12px] hover:bg-hover rounded">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={target.tabIds.includes(t.id)}
                onChange={(e) =>
                  setBroadcastTarget({
                    tabIds: e.target.checked ? [...target.tabIds, t.id] : target.tabIds.filter((x) => x !== t.id),
                  })
                }
              />
              <span className="truncate flex-1">{t.title}</span>
              {t.status !== "connected" && <span className="text-[11px] text-muted">desconectada</span>}
            </label>
          ))}
        </div>
      )}
      {option("folder", "Todas las de una carpeta", folders.length === 0)}
      {target.mode === "folder" && (
        <select
          className="field !h-7 !text-[12px] ml-6 mb-1 !w-[calc(100%-1.5rem)]"
          value={target.folder}
          onChange={(e) => setBroadcastTarget({ folder: e.target.value })}
          aria-label="Carpeta de sesiones"
        >
          <option value="">Elige una carpeta…</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      )}
      {option("panes", "Paneles visibles (vista dividida)", !ws.panes, "Activa la vista dividida desde la barra de pestañas")}
    </>
  );
}
