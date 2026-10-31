import { memo, useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArchiveRestore, FileCode2, FileSearch, FolderOpen, MousePointerClick, Pencil, Plus, Square, Trash2, X } from "lucide-react";
import { Macro } from "../lib/settings";
import { isMobile } from "../lib/platform";
import { ContextMenu } from "./Sidebar";
import type { MenuItem } from "./tabMenu";

interface Props {
  macros: Macro[];
  connected: boolean;
  running: { run: string; script: string; targets: number } | null;
  onRun: (m: Macro) => void;
  onRunScript: (script: string) => void;
  onStopScript: () => void;
  onEdit: (m: Macro | null) => void;
  onDelete: (m: Macro) => void;
  /** Avisos breves (script importado o eliminado, errores). */
  onNotice?: (msg: string, kind?: "error") => void;
  /** Elimina los botones que usaban un script eliminado. */
  onDeleteMacros?: (ids: string[]) => void;
}

type MenuState = { x: number; y: number; items: MenuItem[] };

/** Barra de comandos rápidos (equivalente a la button bar de SecureCRT). */
export const ButtonBar = memo(function ButtonBar(p: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [scripts, setScripts] = useState<string[]>([]);

  useEffect(() => {
    if (isMobile) return;
    invoke<string[]>("list_scripts").then(setScripts).catch(() => {});
  }, []);

  // Busca un .py en el equipo, lo copia a la carpeta de scripts y lo ejecuta.
  const browse = async () => {
    try {
      // El diálogo lo abre el backend: la ruta elegida nunca pasa por el frontend.
      const name = await invoke<string | null>("import_script");
      if (!name) return;
      setScripts(await invoke<string[]>("list_scripts").catch(() => scripts));
      p.onNotice?.(`${name} quedó en la carpeta de scripts`);
    } catch (err) {
      p.onNotice?.(`No se pudo usar el script: ${err}`, "error");
    }
  };

  const remove = async (name: string, macroIds: string[] = []) => {
    try {
      await invoke("delete_script", { name });
      setScripts((l) => l.filter((x) => x !== name));
      if (macroIds.length) p.onDeleteMacros?.(macroIds);
      p.onNotice?.(`${name} se movió a eliminados (se puede restaurar desde el menú Scripts)`);
    } catch (err) {
      p.onNotice?.(`No se pudo eliminar: ${err}`, "error");
    }
  };

  const openScripts = async (e: React.MouseEvent) => {
    // Antes del await: React deja currentTarget en null al terminar el despacho del evento.
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const list = await invoke<string[]>("list_scripts").catch(() => scripts);
    setScripts(list);
    const at = { x: Math.max(8, r.left), y: r.bottom + 4 };
    // Confirmación en el mismo menú, con "Cancelar" primero para que un doble clic no elimine.
    const confirmDelete = (s: string) => {
      const used = p.macros.filter((m) => m.kind === "script" && m.script === s).map((m) => m.id);
      const n = used.length;
      setMenu({
        ...at,
        items: [
          ["Cancelar", <X size={13} />, () => {}],
          [`Eliminar ${s}`, <Trash2 size={13} />, () => remove(s)],
          ...(n
            ? [[`Eliminar ${s} y ${n > 1 ? `los ${n} botones que lo usan` : "el botón que lo usa"}`, <Trash2 size={13} />, () => remove(s, used)] as MenuState["items"][number]]
            : []),
        ],
      });
    };
    const restore = async () => {
      const deleted = await invoke<string[]>("list_deleted_scripts").catch(() => []);
      setMenu({
        ...at,
        items: deleted.length
          ? deleted.map((s) => [s, <ArchiveRestore size={13} />, async () => {
              try {
                const name = await invoke<string>("restore_script", { name: s });
                setScripts(await invoke<string[]>("list_scripts").catch(() => scripts));
                p.onNotice?.(`${name} volvió a la lista de scripts`);
              } catch (err) {
                p.onNotice?.(`No se pudo restaurar: ${err}`, "error");
              }
            }] as MenuState["items"][number])
          : [["No hay scripts eliminados", <ArchiveRestore size={13} />, () => {}, true]],
      });
    };
    const pickDelete = () =>
      setMenu({ ...at, items: list.map((s) => [s, <Trash2 size={13} />, () => setTimeout(() => confirmDelete(s))] as MenuState["items"][number]) });
    setMenu({
      ...at,
      items: [
        ...list.map(
          (s) => [s, <FileCode2 size={13} />, () => p.onRunScript(s), !p.connected] as MenuState["items"][number],
        ),
        // Separador: arriba los scripts ejecutables; abajo, la administración de la carpeta.
        ["Agregar script desde el equipo…", <FileSearch size={13} />, browse, false, undefined, list.length > 0],
        ["Abrir carpeta de scripts", <FolderOpen size={13} />, () => invoke("open_dir", { which: "scripts" })],
        ...(list.length ? [["Eliminar un script…", <Trash2 size={13} />, () => setTimeout(pickDelete)] as MenuState["items"][number]] : []),
        ["Restaurar eliminado…", <ArchiveRestore size={13} />, () => setTimeout(restore)],
      ],
    });
  };

  return (
    <div
      role="toolbar"
      aria-label="Barra de botones: comandos y scripts de un clic"
      className="@container h-8 shrink-0 flex items-center gap-1 px-2 bg-chrome border-t border-line overflow-x-auto [scrollbar-width:none]"
    >
      {/* Rótulo discreto: distingue esta barra (comandos y scripts de un clic) de la de estado de abajo. */}
      <span
        className="shrink-0 flex items-center gap-1 pr-1.5 mr-0.5 border-r border-line text-[11px] text-muted select-none"
        title="Barra de botones: comandos y scripts de un clic. El botón + crea uno nuevo; clic derecho sobre un botón: editar o eliminar"
      >
        <MousePointerClick size={13} aria-hidden />
        <span className="hidden @[40rem]:inline">Botones</span>
      </span>
      {p.macros.map((m) => (
        <button
          key={m.id}
          disabled={!p.connected}
          onClick={() => p.onRun(m)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                ["Editar", <Pencil size={13} />, () => p.onEdit(m)],
                ["Eliminar", <Trash2 size={13} />, () => p.onDelete(m)],
              ],
            });
          }}
          title={`${m.kind === "script" ? `Script: ${m.script}\nAl ejecutarlo eliges los destinos y el modo` : m.text}\nClic derecho o mantener pulsado para editar`}
          className="shrink-0 flex items-center gap-1.5 px-2.5 h-6.5 sm:h-6 rounded-full sm:rounded-md border border-line text-[12px] hover:bg-hover active:bg-hover select-none touch-manipulation disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {m.kind === "script" && <FileCode2 size={12} className="text-muted" />}
          {m.label}
        </button>
      ))}
      <button
        onClick={() => p.onEdit(null)}
        title="Nuevo botón"
        aria-label="Nuevo botón"
        className="shrink-0 w-6.5 h-6.5 sm:w-6 sm:h-6 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover active:bg-hover select-none touch-manipulation"
      >
        <Plus size={14} />
      </button>
      {/* Scripts junto al "+": ambos crean o lanzan acciones de la misma barra. Mientras corre un
          script, "Detener" queda fijo a la derecha para no perderlo al desplazar la barra. */}
      {!isMobile && !p.running && (
        <button
          onClick={openScripts}
          title="Scripts: ejecutar, importar, abrir la carpeta o restaurar eliminados"
          aria-haspopup="menu"
          className="shrink-0 flex items-center gap-1.5 px-2 h-6.5 sm:h-6 rounded-md text-[12px] text-muted hover:text-fg hover:bg-hover active:bg-hover select-none touch-manipulation"
        >
          <FileCode2 size={13} />
          Scripts
        </button>
      )}
      {p.running && (
        <div className="sticky right-0 ml-auto shrink-0 pl-2 bg-chrome">
          <button
            onClick={p.onStopScript}
            title={`Detener script${p.running.targets > 1 ? ` (${p.running.targets} sesiones)` : ""}`}
            aria-label={`Detener script ${p.running.script}`}
            className="whitespace-nowrap flex items-center gap-1.5 px-2 h-6.5 sm:h-6 rounded-md text-[12px] text-warn hover:bg-hover active:bg-hover select-none touch-manipulation"
          >
            <Square size={11} fill="currentColor" />
            <span className="truncate max-w-[130px] sm:max-w-[200px]">Detener {p.running.script}</span>
            {p.running.targets > 1 && <span className="text-muted">· {p.running.targets}</span>}
          </button>
        </div>
      )}
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </div>
  );
});
