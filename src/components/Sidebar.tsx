import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  Copy,
  FileDown,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Zap,
  Search,
  Trash2,
} from "lucide-react";
import { ConnStatus, Session, sessionTarget } from "../types";
import { SessionIcon } from "./SessionIcon";
import { isMobile, modLabel } from "../lib/platform";
import {
  FolderNode,
  SidebarOrder,
  TreeItem,
  allFolders,
  findFolder,
  itemKey,
  orderedItems,
  placeKey,
  baseName,
  buildTree,
  freeName,
  isWithin,
  joinPath,
  normPath,
  parentOf,
  rebase,
  sessionsWithin,
  own,
} from "../lib/folders";

import { plural } from "../lib/plural";
import { PanelResize } from "./PanelResize";
export interface ConfirmRequest {
  title: string;
  message: string;
  label: string;
  danger?: boolean;
  action: () => void;
}

interface Props {
  sessions: Session[];
  extraFolders: string[];
  /** Ancho en px de la barra (lo arrastra el usuario por su borde derecho). */
  width: number;
  onResize: (w: number) => void;
  /** Orden manual por carpeta: carpetas y sesiones intercaladas (p. ej. "Shell local" arriba). */
  order: SidebarOrder;
  onSetOrder: (order: SidebarOrder) => void;
  /** Estado de conexión por id de sesión guardada (si tiene pestañas abiertas). */
  live: Record<string, ConnStatus>;
  onOpen: (s: Session) => void;
  onOpenMany: (list: Session[]) => void;
  onNew: (folder?: string) => void;
  onEdit: (s: Session) => void;
  onDuplicate: (s: Session) => void;
  onDelete: (s: Session) => void;
  onUpdateSessions: (changed: Session[]) => void;
  onSetExtraFolders: (folders: string[]) => void;
  onConfirm: (req: ConfirmRequest) => void;
  /** Abre la importación desde PuTTY, SecureCRT, MobaXterm, OpenSSH o CSV. */
  onImportFile?: () => void;
  /** Abre "Exportar sesiones" con la carpeta indicada preseleccionada (sin carpeta: todas). */
  onExportFile?: (folder?: string) => void;
  /** Conexión rápida sin guardar (SSH, Telnet, Serial). */
  onQuickConnect?: () => void;
}

/** [etiqueta, icono, acción, deshabilitado, atajo que se muestra a la derecha]. */
type MenuItem = [string, React.ReactNode, () => void, boolean?, string?, boolean?];
type Menu = { x: number; y: number; items: MenuItem[] };
type Selected = { kind: "session"; id: string } | { kind: "folder"; path: string } | null;

/** Dónde cae lo arrastrado sobre una fila: antes, después o dentro de una carpeta. */
type DropPos = "before" | "after" | "into";
const DND_SESSION = "application/x-nt-session";
const DND_FOLDER = "application/x-nt-folder";

/** Desde cuántas filas visibles se dibuja solo la ventana a la vista. */
const VIRTUAL_FROM = 200;
/** Filas extra arriba y abajo de la ventana (scroll sin parpadeo). */
const OVERSCAN = 12;

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem("collapsedFolders") ?? "{}");
  } catch {
    return {};
  }
}

export const Sidebar = memo(function Sidebar(p: Props) {
  const { sessions, extraFolders } = p;
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const [selected, setSelected] = useState<Selected>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Indicador de reordenamiento: fila (clave de árbol con su carpeta) y posición. */
  const [dropHint, setDropHint] = useState<{ row: string; pos: DropPos } | null>(null);
  const expandTimer = useRef<number | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    try {
      localStorage.setItem("collapsedFolders", JSON.stringify(collapsed));
    } catch {
      /* sin almacenamiento: no se recuerda */
    }
  }, [collapsed]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(""), 3000);
  };

  const folders = useMemo(() => allFolders(sessions, extraFolders), [sessions, extraFolders]);

  const q = filter.trim().toLowerCase();
  const tree = useMemo(() => {
    if (!q) return buildTree(sessions, extraFolders);
    const match = (s: Session) =>
      [s.name, s.host, s.serial_port, s.folder, s.username].some((v) => v?.toLowerCase().includes(q));
    return buildTree(sessions.filter(match), []);
  }, [sessions, extraFolders, q]);

  // ---------- Operaciones de carpetas ----------

  const createFolder = (parent: string) => {
    const path = freeName(folders, parent);
    p.onSetExtraFolders([...extraFolders, path]);
    if (parent) setCollapsed((c) => ({ ...c, [parent]: false }));
    setRenaming(path);
  };

  /** Mueve o renombra una carpeta con todo su contenido (si el destino existe, se fusionan). */
  const moveFolderTo = (from: string, to: string) => {
    if (from === to) return;
    const changed = sessionsWithin(sessions, from).map((s) => ({
      ...s,
      folder: rebase(normPath(s.folder), from, to),
    }));
    if (changed.length) p.onUpdateSessions(changed);
    p.onSetExtraFolders([...new Set(extraFolders.map((f) => rebase(normPath(f), from, to)))]);
    setCollapsed((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [rebase(k, from, to), v])));
    // El orden manual sigue a la carpeta: sus subcarpetas cambian de ruta y, si solo se
    // renombró, conserva su lugar entre sus hermanas.
    const next: SidebarOrder = {};
    for (const [k, v] of Object.entries(p.order)) next[rebase(k, from, to)] = v;
    if (parentOf(from) === parentOf(to) && next[parentOf(from)])
      next[parentOf(from)] = next[parentOf(from)].map((k) => (k === `f:${baseName(from)}` ? `f:${baseName(to)}` : k));
    p.onSetOrder(next);
  };

  const commitRename = (path: string, raw: string) => {
    setRenaming(null);
    const name = raw.replace(/\//g, "-").trim();
    if (!name || name === baseName(path)) return;
    const target = joinPath(parentOf(path), name);
    if (folders.includes(target)) return flash(`Ya existe la carpeta "${name}"`);
    moveFolderTo(path, target);
  };

  const deleteFolder = (path: string) => {
    const inside = sessionsWithin(sessions, path);
    const up = parentOf(path);
    const remove = () => {
      if (inside.length)
        p.onUpdateSessions(
          inside.map((s) => ({ ...s, folder: rebase(normPath(s.folder), path, up) || undefined })),
        );
      p.onSetExtraFolders(
        extraFolders
          .map((f) => normPath(f))
          .filter((f) => f !== path)
          .map((f) => rebase(f, path, up))
          .filter(Boolean),
      );
    };
    if (!inside.length) return remove();
    p.onConfirm({
      title: `¿Eliminar la carpeta "${baseName(path)}"?`,
      message: `${inside.length === 1 ? "Su sesión o subcarpeta pasa" : `Sus ${inside.length} sesiones y subcarpetas pasan`} a ${up || "la raíz"}. No se elimina ninguna sesión.`,
      label: "Eliminar carpeta",
      danger: true,
      action: remove,
    });
  };

  const connectAll = (path: string) => {
    const list = sessionsWithin(sessions, path);
    if (!list.length) return;
    if (list.length <= 5) return p.onOpenMany(list);
    p.onConfirm({
      title: `¿Conectar ${plural(list.length, "sesión", "sesiones")}?`,
      message: `Se abrirá una pestaña por cada equipo de "${baseName(path)}".`,
      label: "Conectar todas",
      action: () => p.onOpenMany(list),
    });
  };

  const deleteSession = (s: Session) =>
    p.onConfirm({
      title: `¿Eliminar "${s.name}"?`,
      message: `${sessionTarget(s)}. Esta acción no se puede deshacer.`,
      label: "Eliminar",
      danger: true,
      action: () => p.onDelete(s),
    });

  // ---------- Menús contextuales ----------

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const folderMenu = (e: React.MouseEvent, node: FolderNode) => {
    setSelected({ kind: "folder", path: node.path });
    openMenu(e, [
      [`Conectar todas (${node.total})`, <Play size={13} />, () => connectAll(node.path), node.total === 0],
      ["Nueva sesión aquí", <Plus size={13} />, () => p.onNew(node.path)],
      ["Nueva subcarpeta", <FolderPlus size={13} />, () => createFolder(node.path)],
      ["Renombrar", <Pencil size={13} />, () => setRenaming(node.path)],
      ...(p.onExportFile ? [["Exportar sesiones…", <FileDown size={13} />, () => p.onExportFile?.(node.path), node.total === 0] as MenuItem] : []),
      ...moveItems({ kind: "folder", node }, parentOf(node.path)),
      ["Eliminar carpeta", <Trash2 size={13} />, () => deleteFolder(node.path)],
    ]);
  };

  const sessionMenu = (e: React.MouseEvent, s: Session) => {
    setSelected({ kind: "session", id: s.id });
    openMenu(e, [
      ["Conectar", <Play size={13} />, () => p.onOpen(s)],
      ["Editar", <Pencil size={13} />, () => p.onEdit(s)],
      ["Duplicar", <Copy size={13} />, () => p.onDuplicate(s)],
      ...moveItems({ kind: "session", session: s }, normPath(s.folder)),
      ["Eliminar", <Trash2 size={13} />, () => deleteSession(s)],
    ]);
  };

  // ---------- Orden manual ----------

  /** Deja un elemento (sesión o carpeta) en `parent`, antes o después de `anchor`, o al inicio o al final. */
  const placeItem = (moved: { sid?: string; fpath?: string }, parent: string, anchor: string | null, where: "before" | "after" | "start" | "end") => {
    let key: string;
    if (moved.sid) {
      const s = sessions.find((x) => x.id === moved.sid);
      if (!s) return;
      if (normPath(s.folder) !== parent) p.onUpdateSessions([{ ...s, folder: parent || undefined }]);
      key = `s:${s.id}`;
    } else if (moved.fpath) {
      if (isWithin(parent, moved.fpath)) return flash("No se puede mover una carpeta dentro de sí misma");
      const dest = joinPath(parent, baseName(moved.fpath));
      if (dest !== moved.fpath && folders.includes(dest)) return flash(`Ya existe la carpeta "${baseName(dest)}" ahí`);
      if (parentOf(moved.fpath) !== parent) moveFolderTo(moved.fpath, dest);
      key = `f:${baseName(moved.fpath)}`;
    } else return;
    const node = findFolder(buildTree(sessions, extraFolders), parent);
    const current = node ? orderedItems(node, own(p.order, parent)).map(itemKey) : [];
    p.onSetOrder({ ...p.order, [parent]: placeKey(current, key, anchor, where) });
  };

  /** Sube o baja un elemento un lugar entre sus hermanos (menú y teclado, sin arrastrar). */
  const shiftItem = (it: TreeItem, parent: string, dir: -1 | 1) => {
    const node = findFolder(buildTree(sessions, extraFolders), parent);
    if (!node) return;
    const list = orderedItems(node, own(p.order, parent)).map(itemKey);
    const i = list.indexOf(itemKey(it));
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    p.onSetOrder({ ...p.order, [parent]: list });
  };

  const moveItems = (it: TreeItem, parent: string): MenuItem[] => {
    const moved = it.kind === "session" ? { sid: it.session.id } : { fpath: it.node.path };
    return [
      ["Mover al inicio", <ArrowUpToLine size={13} />, () => placeItem(moved, parent, null, "start"), !!q],
      ["Subir", <ChevronUp size={13} />, () => shiftItem(it, parent, -1), !!q],
      ["Bajar", <ChevronDown size={13} />, () => shiftItem(it, parent, 1), !!q],
      ["Mover al final", <ArrowDownToLine size={13} />, () => placeItem(moved, parent, null, "end"), !!q],
    ];
  };

  // ---------- Arrastrar y soltar ----------

  const onDrop = (e: React.DragEvent, target: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const sid = e.dataTransfer.getData(DND_SESSION);
    const fpath = e.dataTransfer.getData(DND_FOLDER);
    if (sid) {
      const s = sessions.find((x) => x.id === sid);
      if (s && normPath(s.folder) !== target) p.onUpdateSessions([{ ...s, folder: target || undefined }]);
    } else if (fpath) {
      if (isWithin(target, fpath)) return flash("No se puede mover una carpeta dentro de sí misma");
      if (parentOf(fpath) === target) return;
      moveFolderTo(fpath, joinPath(target, baseName(fpath)));
    }
    if (target) setCollapsed((c) => ({ ...c, [target]: false }));
  };

  const dropProps = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const t = e.dataTransfer.types;
      if (!t.includes(DND_SESSION) && !t.includes(DND_FOLDER)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((t) => (t === target ? null : t)),
    onDrop: (e: React.DragEvent) => onDrop(e, target),
  });

  /**
   * Arrastre sobre una fila: en la mitad de arriba cae antes y en la de abajo después (en una
   * carpeta, el centro es "dentro"). Mantener el arrastre sobre una carpeta cerrada la abre.
   * Con un filtro activo solo se mueve dentro de carpetas: el orden visible está incompleto.
   */
  const rowDropProps = (it: TreeItem, parent: string) => {
    const row = `${parent}|${itemKey(it)}`;
    const posAt = (e: React.DragEvent): DropPos | null => {
      const r = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - r.top) / Math.max(1, r.height);
      if (it.kind === "folder") {
        if (q) return "into";
        if (y < 0.3) return "before";
        // Abierta, lo de abajo del encabezado ya es su contenido: el borde inferior es "dentro".
        if (y > 0.7 && own(collapsed, it.node.path)) return "after";
        return "into";
      }
      return q ? null : y < 0.5 ? "before" : "after";
    };
    return {
      onDragOver: (e: React.DragEvent) => {
        const t = e.dataTransfer.types;
        if (!t.includes(DND_SESSION) && !t.includes(DND_FOLDER)) return;
        const pos = posAt(e);
        if (!pos) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setDropTarget(null);
        setDropHint((h) => (h?.row === row && h.pos === pos ? h : { row, pos }));
        if (pos === "into" && it.kind === "folder" && own(collapsed, it.node.path) && expandTimer.current === undefined) {
          const path = it.node.path;
          expandTimer.current = window.setTimeout(() => {
            expandTimer.current = undefined;
            setCollapsed((c) => ({ ...c, [path]: false }));
          }, 600);
        }
      },
      onDragLeave: () => {
        setDropHint((h) => (h?.row === row ? null : h));
        window.clearTimeout(expandTimer.current);
        expandTimer.current = undefined;
      },
      onDrop: (e: React.DragEvent) => {
        const pos = posAt(e);
        window.clearTimeout(expandTimer.current);
        expandTimer.current = undefined;
        setDropHint(null);
        if (!pos) return;
        if (pos === "into" && it.kind === "folder") return onDrop(e, it.node.path);
        e.preventDefault();
        e.stopPropagation();
        const sid = e.dataTransfer.getData(DND_SESSION) || undefined;
        const fpath = e.dataTransfer.getData(DND_FOLDER) || undefined;
        if ((sid && it.kind === "session" && it.session.id === sid) || (fpath && it.kind === "folder" && it.node.path === fpath)) return;
        placeItem({ sid, fpath }, parent, itemKey(it), pos === "before" ? "before" : "after");
      },
    };
  };
  const hintClass = (it: TreeItem, parent: string) => {
    if (dropHint?.row !== `${parent}|${itemKey(it)}`) return "";
    return dropHint.pos === "before"
      ? "shadow-[inset_0_2px_0_0_var(--accent)]"
      : dropHint.pos === "after"
        ? "shadow-[inset_0_-2px_0_0_var(--accent)]"
        : "bg-selected ring-1 ring-[var(--accent)]";
  };
  const endDrag = () => {
    setDropHint(null);
    setDropTarget(null);
    window.clearTimeout(expandTimer.current);
    expandTimer.current = undefined;
  };

  // ---------- Render ----------

  const renderFolder = (node: FolderNode, depth: number): React.ReactNode => {
    const isCollapsed = !q && own(collapsed, node.path);
    const isSel = selected?.kind === "folder" && selected.path === node.path;
    return (
        <div
          key={`f:${node.path}`}
          data-row
          draggable={renaming !== node.path}
          onDragStart={(e) => {
            e.dataTransfer.setData(DND_FOLDER, node.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={endDrag}
          {...rowDropProps({ kind: "folder", node }, parentOf(node.path))}
          tabIndex={0}
          onClick={() => {
            setSelected({ kind: "folder", path: node.path });
            setCollapsed((c) => ({ ...c, [node.path]: !c[node.path] }));
          }}
          onContextMenu={(e) => folderMenu(e, node)}
          onKeyDown={(e) => {
            if (e.key === "F2") setRenaming(node.path);
            if (e.key === "Delete") deleteFolder(node.path);
          }}
          style={{ paddingLeft: 6 + depth * 14 }}
          className={`group flex items-center gap-1.5 pr-1 h-9 sm:h-7 rounded-lg sm:rounded-md outline-none ${
            hintClass({ kind: "folder", node }, parentOf(node.path)) || (isSel ? "bg-hover" : "hover:bg-hover")
          }`}
        >
          <ChevronRight
            size={12}
            className={`shrink-0 text-muted transition-transform ${isCollapsed ? "" : "rotate-90"}`}
          />
          {isCollapsed ? (
            <Folder size={14} className="shrink-0 text-muted" />
          ) : (
            <FolderOpen size={14} className="shrink-0 text-muted" />
          )}
          {renaming === node.path ? (
            <input
              autoFocus
              className="field !h-6 !px-1.5 flex-1 min-w-0"
              defaultValue={node.name}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(node.path, e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span className="truncate flex-1 font-medium text-[12.5px]">{node.name}</span>
          )}
          <span className="text-[11px] text-muted sm:group-hover:hidden">{node.total || ""}</span>
          <RowBtn title="Más acciones" className="grid sm:hidden sm:group-hover:grid" onClick={(e) => folderMenu(e, node)}>
            <MoreHorizontal size={14} />
          </RowBtn>
        </div>
    );
  };

  const renderSession = (s: Session, depth: number) => {
    const isSel = selected?.kind === "session" && selected.id === s.id;
    const status = p.live[s.id];
    return (
      <div
        key={`s:${s.id}`}
        data-row
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_SESSION, s.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={endDrag}
        {...rowDropProps({ kind: "session", session: s }, normPath(s.folder))}
        tabIndex={0}
        onClick={() => {
          setSelected({ kind: "session", id: s.id });
          if (isMobile) p.onOpen(s);
        }}
        onDoubleClick={() => p.onOpen(s)}
        onContextMenu={(e) => sessionMenu(e, s)}
        onKeyDown={(e) => {
          if (e.key === "Enter") p.onOpen(s);
          if (e.key === "Delete") deleteSession(s);
        }}
        title={`${sessionTarget(s)}\nDoble clic para conectar · clic derecho para más opciones`}
        style={{ paddingLeft: 24 + depth * 14 }}
        className={`group flex items-center gap-2 pr-1 h-9 sm:h-7 rounded-lg sm:rounded-md outline-none ${
          hintClass({ kind: "session", session: s }, normPath(s.folder)) || (isSel ? "bg-selected" : "hover:bg-hover")
        }`}
      >
        <SessionIcon type={s.type} size={14} />
        <span className="truncate flex-1 text-[13px]">{s.name}</span>
        {status && (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 sm:group-hover:hidden"
            title="Pestaña abierta"
            style={{
              background:
                status === "connected" ? "var(--ok)" : status === "connecting" ? "var(--warn)" : "var(--muted)",
            }}
          />
        )}
        <div className="flex sm:hidden sm:group-hover:flex items-center">
          <RowBtn title="Editar" onClick={() => p.onEdit(s)}>
            <Pencil size={12} />
          </RowBtn>
          <RowBtn title="Más acciones" onClick={(e) => sessionMenu(e, s)}>
            <MoreHorizontal size={14} />
          </RowBtn>
        </div>
      </div>
    );
  };

  // Árbol visible como lista plana (carpetas abiertas o filtradas): base del render por ventana.
  const rows = useMemo(() => {
    const out: { it: TreeItem; depth: number }[] = [];
    const walk = (node: FolderNode, depth: number) => {
      for (const it of orderedItems(node, own(p.order, node.path))) {
        out.push({ it, depth });
        if (it.kind === "folder" && (q || !own(collapsed, it.node.path))) walk(it.node, depth + 1);
      }
    };
    for (const it of orderedItems(tree, own(p.order, ""))) {
      out.push({ it, depth: it.kind === "folder" ? 0 : -1 });
      if (it.kind === "folder" && (q || !own(collapsed, it.node.path))) walk(it.node, 1);
    }
    return out;
  }, [tree, p.order, collapsed, q]);

  // Con inventarios grandes solo se dibujan las filas a la vista (todas miden lo mismo): con
  // 2.000 sesiones abiertas el arranque dibujaba 6.000 íconos.
  const navRef = useRef<HTMLElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const [rowH, setRowH] = useState(28);
  const virtual = rows.length > VIRTUAL_FROM;
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el || !virtual) return;
    const row = el.querySelector<HTMLElement>("[data-row]");
    if (row?.offsetHeight) setRowH(row.offsetHeight);
    const sync = () => setView({ top: el.scrollTop, height: el.clientHeight });
    sync();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [virtual]);
  // Al filtrar, los resultados se ven desde arriba.
  useLayoutEffect(() => {
    if (navRef.current) navRef.current.scrollTop = 0;
    setView((v) => (v.top ? { ...v, top: 0 } : v));
  }, [q]);
  // Si la lista se achica (carpeta cerrada, filtro), la ventana no puede quedar más allá del final.
  const top = Math.max(0, Math.min(view.top, rows.length * rowH - view.height));
  const first = virtual ? Math.max(0, Math.floor(top / rowH) - OVERSCAN) : 0;
  const last = virtual ? Math.min(rows.length, Math.ceil((top + view.height) / rowH) + OVERSCAN) : rows.length;
  const renderRow = ({ it, depth }: { it: TreeItem; depth: number }) => (it.kind === "folder" ? renderFolder(it.node, depth) : renderSession(it.session, depth));

  const empty = tree.children.length === 0 && tree.sessions.length === 0;
  const target = selectedFolder(selected, sessions);

  return (
    <aside
      style={{ width: p.width }}
      className="relative shrink-0 h-full flex flex-col bg-chrome border-r border-line max-sm:!w-full max-w-full sm:max-w-[calc(100vw-44px)]"
    >
      <div className="flex items-center gap-0.5 px-2.5 pt-3 pb-2">
        <div className="relative flex-1 mr-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="field !h-8 sm:!h-7 !pl-8 !text-[12.5px] sm:!text-[12px]"
            placeholder="Filtrar…"
            title="Filtra por nombre, IP o carpeta"
            aria-label="Filtrar sesiones por nombre, IP o carpeta"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
          />
        </div>
        {p.onQuickConnect && (
          <HeadBtn title={`Conexión rápida sin guardar (${modLabel}O)`} aria-label="Conexión rápida sin guardar" onClick={p.onQuickConnect}>
            <Zap size={15} />
          </HeadBtn>
        )}
        <HeadBtn title={`Nueva sesión (${modLabel}N)`} onClick={() => p.onNew(target)}>
          <Plus size={16} />
        </HeadBtn>
        <HeadBtn title="Nueva carpeta" onClick={() => createFolder(target ?? "")}>
          <FolderPlus size={15} />
        </HeadBtn>
        <HeadBtn title="Contraer todo" onClick={() => setCollapsed(Object.fromEntries(folders.map((f) => [f, true])))}>
          <ChevronsDownUp size={15} />
        </HeadBtn>
        {(p.onImportFile || p.onExportFile) && (
          <HeadBtn
            title="Importar o exportar sesiones"
            aria-label="Importar o exportar sesiones"
            onClick={(e) =>
              openMenu(e, [
                ["Nueva sesión", <Plus size={13} />, () => p.onNew()],
                ["Nueva carpeta", <FolderPlus size={13} />, () => createFolder("")],
                ...(p.onImportFile ? [["Importar sesiones…", <FileUp size={13} />, p.onImportFile] as MenuItem] : []),
                ...(p.onExportFile ? [["Exportar sesiones…", <FileDown size={13} />, () => p.onExportFile?.()] as MenuItem] : []),
              ])
            }
          >
            <MoreHorizontal size={15} />
          </HeadBtn>
        )}
      </div>

      {notice && <p className="px-3 pb-1 text-[11.5px] text-danger">{notice}</p>}

      <nav
        ref={navRef}
        className={`flex-1 overflow-y-auto px-1.5 pb-3 ${dropTarget === "" ? "bg-selected" : ""}`}
        onContextMenu={(e) =>
          openMenu(e, [
            ["Nueva sesión", <Plus size={13} />, () => p.onNew()],
            ["Nueva carpeta", <FolderPlus size={13} />, () => createFolder("")],
            ...(p.onImportFile
              ? [["Importar sesiones…", <FileUp size={13} />, p.onImportFile] as MenuItem]
              : []),
            ...(p.onExportFile ? [["Exportar sesiones…", <FileDown size={13} />, () => p.onExportFile?.()] as MenuItem] : []),
          ])
        }
        {...dropProps("")}
        onClick={(e) => e.target === e.currentTarget && setSelected(null)}
      >
        {virtual && <div style={{ height: first * rowH }} aria-hidden />}
        {rows.slice(first, last).map(renderRow)}
        {virtual && <div style={{ height: (rows.length - last) * rowH }} aria-hidden />}

        {empty && (
          <div className="px-3 py-8 text-center text-[12px] text-muted">
            {q ? "Sin coincidencias" : "Crea una sesión o una carpeta. Clic derecho para más opciones."}
            {!q && p.onImportFile && (
              <button className="block mx-auto mt-2 text-accent hover:underline" onClick={p.onImportFile}>
                Importar desde PuTTY, SecureCRT, MobaXterm…
              </button>
            )}
          </div>
        )}
      </nav>

      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
      <PanelResize side="right" width={p.width} onResize={p.onResize} />
    </aside>
  );
});

/** Carpeta destino según la selección: la carpeta seleccionada o la de la sesión seleccionada. */
function selectedFolder(sel: Selected, sessions: Session[]): string | undefined {
  if (sel?.kind === "folder") return sel.path;
  if (sel?.kind === "session") return normPath(sessions.find((s) => s.id === sel.id)?.folder) || undefined;
  return undefined;
}

export function ContextMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  // Ajusta la posición para que el menú no se salga de la ventana ni se oculte bajo MobileBottomNav.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const isMobileNav = window.innerWidth < 640;
    const bottomNavH = isMobileNav ? 56 : 0;
    const bottomMargin = bottomNavH + 8;
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - bottomMargin)),
    });
  }, [menu]);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onTouch = (e: TouchEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onMouse);
    window.addEventListener("touchstart", onTouch);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onMouse);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Teclado: el foco entra al primer ítem, las flechas lo mueven y, si la acción no deja el foco
  // en otro lado (un campo, un diálogo), vuelve a donde estaba (p. ej. la terminal).
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
    return () => {
      const cur = document.activeElement;
      if ((!cur || cur === document.body) && prev?.isConnected) prev.focus({ preventScroll: true });
    };
  }, []);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else return;
    e.preventDefault();
    items[next].focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={onMenuKey}
      className="fixed z-50 min-w-48 max-w-[calc(100vw-16px)] max-h-[calc(100vh-72px)] overflow-y-auto py-1 bg-panel border border-line rounded-lg shadow-pop"
      style={{ left: pos.x, top: pos.y }}
    >
      {menu.items.map(([label, icon, action, disabled, shortcut, separated]) => (
        <button
          key={label}
          data-sep={separated ? "" : undefined}
          role="menuitem"
          disabled={disabled}
          onClick={() => {
            onClose();
            action();
          }}
          className={`w-full flex items-center gap-2.5 px-3 h-8 sm:h-7 text-left text-[12.5px] hover:bg-hover active:bg-hover focus-visible:bg-hover disabled:opacity-40 select-none touch-manipulation ${
            label.startsWith("Eliminar") ? "text-danger" : ""
          } ${separated ? "mt-1 border-t border-line pt-1 h-9 sm:h-8 rounded-none" : ""}`}
        >
          <span className="text-muted shrink-0">{icon}</span>
          <span className="flex-1 min-w-0 truncate">{label}</span>
          {shortcut && <kbd className="ml-3 shrink-0 text-[11px] text-muted font-sans">{shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}

function HeadBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="w-7 h-7 shrink-0 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-hover"
    />
  );
}

function RowBtn({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick?.(e);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={`w-6 h-6 place-items-center rounded text-muted hover:text-fg ${className || "grid"}`}
    />
  );
}
