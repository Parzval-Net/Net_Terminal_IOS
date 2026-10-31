import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { History, ListX, Search } from "lucide-react";
import { Session, sessionTarget } from "../types";
import { QuickBolt, SessionIcon, typeLabel } from "./SessionIcon";
import { isMobile } from "../lib/platform";

/** Acción de la app en la paleta (p. ej. "Cerrar todas las sesiones"). */
export interface PaletteAction {
  label: string;
  detail: string;
  shortcut?: string;
  run: () => void;
}

interface Props {
  sessions: Session[];
  onClose: () => void;
  onOpen: (s: Session) => void;
  actions?: PaletteAction[];
}

type Item = { session: Session; quick: boolean; recent: boolean; action?: undefined } | { action: PaletteAction };

/** Coincidencia sin mayúsculas ni tildes: "cerrar todas" encuentra "Cerrar todas las sesiones". */
const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Interpreta conexiones rápidas:
 *   ssh admin@10.0.0.1:2222 · telnet 10.0.0.1 2323 · admin@router · 10.0.0.1
 *   2001:db8::1 · [2001:db8::1]:2222 · telnet fe80::1%en0 2323
 */
export function parseQuick(input: string): Session[] {
  const q = input.trim();
  if (!q || /\s{2,}/.test(q)) return [];
  const m = q.match(/^(?:(ssh|telnet)\s+)?(?:([^@\s]+)@)?(\S+?)(?:\s+(\d+))?$/i);
  if (!m) return [];
  const [, proto, user, target, spacePort] = m;
  let host: string;
  let colonPort: string | undefined;
  const bracket = target.match(/^\[([0-9a-f:.%\w-]+)\](?::(\d+))?$/i);
  if (bracket) [, host, colonPort] = bracket;
  else if ((target.match(/:/g) ?? []).length > 1) {
    // IPv6 sin corchetes: los ":" son parte de la dirección (el puerto va separado por espacio).
    if (!/^[0-9a-f:.]+(%[\w.-]+)?$/i.test(target)) return [];
    host = target;
  } else {
    const hp = target.match(/^([\w.-]+)(?::(\d+))?$/);
    if (!hp) return [];
    [, host, colonPort] = hp;
    if (!/[.-]|^[a-z][\w-]*$/i.test(host)) return [];
  }
  const p = colonPort || spacePort;
  const port = p ? Number(p) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) return [];
  const base = { id: "", folder: undefined, created_at: new Date().toISOString() };
  const ssh: Session = { ...base, type: "ssh", name: host, host, port: port ?? 22, username: user };
  const telnet: Session = { ...base, type: "telnet", name: host, host, port: port ?? 23 };
  if (proto?.toLowerCase() === "telnet") return [telnet];
  if (proto || user) return [ssh];
  return [ssh, telnet];
}

/** Forma canónica de un destino rápido, que parseQuick vuelve a interpretar. */
export function quickTarget(s: Session): string {
  return `${s.type} ${s.username ? `${s.username}@` : ""}${s.host ?? ""} ${s.port ?? ""}`.trim();
}

export function CommandPalette({ sessions, onClose, onOpen, actions = [] }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  // Últimos destinos de conexión rápida (archivo en la carpeta de datos, máx. 20).
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    invoke<string[]>("recent_targets").then(setRecent).catch(() => {});
  }, []);

  const items = useMemo((): Item[] => {
    const q = query.trim().toLowerCase();
    // Con texto, las acciones que coinciden van primero; sin texto, al final de la lista.
    const words = fold(q).split(/\s+/).filter(Boolean);
    const acts = actions
      .filter((a) => words.every((w) => fold(a.label).includes(w)))
      .map((action) => ({ action }));
    const recents = q
      ? []
      : recent
          .map((t) => parseQuick(t)[0])
          .filter((s): s is Session => !!s)
          .map((s) => ({ session: s, quick: true, recent: true }));
    const saved = sessions
      .filter((s) =>
        !q || [s.name, s.host, s.folder, s.serial_port].some((v) => v?.toLowerCase().includes(q)),
      )
      .slice(0, 50)
      .map((s) => ({ session: s, quick: false, recent: false }));
    const quick = parseQuick(query).map((s) => ({ session: s, quick: true, recent: false }));
    return q ? [...acts, ...recents, ...saved, ...quick] : [...recents, ...saved, ...quick, ...acts];
  }, [query, sessions, recent, actions]);

  useEffect(() => setIndex(0), [query]);

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.action) {
      onClose();
      item.action.run();
      return;
    }
    if (item.quick) invoke("recent_target_add", { target: quickTarget(item.session) }).catch(() => {});
    onOpen(item.session);
    onClose();
  };

  const clearRecent = () => {
    invoke("recent_targets_clear").catch(() => {});
    setRecent([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center pt-[6vh] sm:pt-[12vh] px-2 sm:px-0 bg-black/25" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar sesión o conexión rápida"
        className="w-full sm:w-[520px] max-w-[calc(100vw-1rem)] sm:max-w-[92vw] h-fit bg-panel border border-line rounded-xl shadow-pop overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Foco atrapado: Tab no debe salir a la barra lateral ni a la terminal de detrás.
          if (e.key !== "Tab") return;
          const f = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("input, button"));
          const i = f.indexOf(document.activeElement as HTMLElement);
          const next = f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length];
          e.preventDefault();
          next?.focus();
        }}
      >
        <div className="flex items-center gap-2.5 px-3 sm:px-4 h-12 border-b border-line">
          <Search size={16} className="text-muted shrink-0" />
          <input
            autoFocus
            className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] sm:text-[14px] placeholder:text-muted"
            placeholder={isMobile ? "Buscar o escribir user@host…" : "Buscar sesión o escribir user@host para conexión rápida"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, items.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter") choose(index);
            }}
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {!query.trim() && recent.length > 0 && (
            <li className="flex items-center justify-between px-3 h-6 text-[11px] text-muted">
              Conexiones rápidas recientes
              <button className="hover:text-fg hover:underline" onClick={clearRecent}>
                Borrar recientes
              </button>
            </li>
          )}
          {items.map((item, i) => {
            if (item.action) {
              const a = item.action;
              return (
                <li
                  key={`action-${a.label}`}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => choose(i)}
                  className={`flex items-center gap-3 px-3 h-11 rounded-lg ${i === index ? "bg-selected" : ""}`}
                >
                  <ListX size={15} className="text-danger shrink-0" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate">{a.label}</div>
                    <div className="truncate text-[11.5px] text-muted">{a.detail}</div>
                  </div>
                  {a.shortcut && <kbd className="text-[11px] text-muted font-sans">{a.shortcut}</kbd>}
                </li>
              );
            }
            const { session: s, quick, recent: isRecent } = item;
            return (
            <li
              key={isRecent ? `recent-${i}` : quick ? `quick-${s.type}` : s.id}
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(i)}
              className={`flex items-center gap-3 px-3 h-11 rounded-lg ${i === index ? "bg-selected" : ""}`}
            >
              {isRecent ? (
                <History size={15} className="text-muted shrink-0" />
              ) : quick ? (
                <QuickBolt size={15} />
              ) : (
                <SessionIcon type={s.type} size={15} />
              )}
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate">
                  {isRecent ? sessionTarget(s) : quick ? `Conexión rápida ${typeLabel[s.type]}` : s.name}
                </div>
                <div className="truncate text-[11.5px] text-muted">
                  {isRecent ? "Reciente" : sessionTarget(s)}
                  {!quick && s.folder ? ` · ${s.folder}` : ""}
                </div>
              </div>
              <span className="text-[11px] font-medium text-muted uppercase">{typeLabel[s.type]}</span>
            </li>
            );
          })}
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-muted text-[12px]">
              Sin resultados. Prueba con <code>ssh user@host</code> o <code>telnet host 23</code>.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
