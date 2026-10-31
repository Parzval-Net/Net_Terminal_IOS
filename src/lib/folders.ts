/**
 * Carpetas jerárquicas. Cada sesión guarda su ruta en `folder` ("Clientes/Acme/Core").
 * Las carpetas vacías se guardan aparte (ajustes) para que no desaparezcan.
 */
import type { Session } from "../types";

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  sessions: Session[];
  /** Sesiones en esta carpeta y todas sus subcarpetas. */
  total: number;
}

export function normPath(p?: string | null): string {
  return (p ?? "")
    .split("/")
    .map((x) => x.trim())
    .filter(Boolean)
    .join("/");
}

export const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
export const baseName = (path: string) => path.split("/").pop() ?? path;
export const joinPath = (parent: string, name: string) => normPath(parent ? `${parent}/${name}` : name);

/** true si `path` es `ancestor` o está dentro de ella. */
export function isWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** Reemplaza el prefijo `from` por `to` si `path` está dentro de `from`. */
export function rebase(path: string, from: string, to: string): string {
  if (!isWithin(path, from)) return path;
  return normPath(to + path.slice(from.length));
}

/** Todas las rutas existentes (incluye ancestros implícitos), ordenadas. */
export function allFolders(sessions: Session[], extra: string[]): string[] {
  const set = new Set<string>();
  for (const raw of [...sessions.map((s) => s.folder), ...extra]) {
    const parts = normPath(raw).split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function buildTree(sessions: Session[], extra: string[]): FolderNode {
  const root: FolderNode = { name: "", path: "", children: [], sessions: [], total: 0 };
  const index = new Map<string, FolderNode>([["", root]]);

  const ensure = (path: string): FolderNode => {
    const found = index.get(path);
    if (found) return found;
    const parent = ensure(parentOf(path));
    const node: FolderNode = { name: baseName(path), path, children: [], sessions: [], total: 0 };
    parent.children.push(node);
    index.set(path, node);
    return node;
  };

  for (const f of extra) ensure(normPath(f));
  for (const s of sessions) ensure(normPath(s.folder)).sessions.push(s);

  const finish = (n: FolderNode): number => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    n.sessions.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    n.total = n.sessions.length + n.children.reduce((acc, c) => acc + finish(c), 0);
    return n.total;
  };
  finish(root);
  return root;
}

/** Sesiones de una carpeta y sus subcarpetas. */
export function sessionsWithin(sessions: Session[], path: string): Session[] {
  return sessions.filter((s) => isWithin(normPath(s.folder), path));
}

/** Nombre libre dentro de `parent` ("Nueva carpeta", "Nueva carpeta 2", …). */
export function freeName(existing: string[], parent: string, base = "Nueva carpeta"): string {
  let name = base;
  for (let i = 2; existing.includes(joinPath(parent, name)); i++) name = `${base} ${i}`;
  return joinPath(parent, name);
}

// ---------- Orden manual de la lista de sesiones ----------

/** Carpeta o sesión dentro de una carpeta, en el orden en que se muestran. */
export type TreeItem = { kind: "folder"; node: FolderNode } | { kind: "session"; session: Session };

/**
 * Orden manual por carpeta (ruta → claves). Clave "f:<nombre>" para una subcarpeta y
 * "s:<id>" para una sesión: así carpetas y sesiones se pueden intercalar (por ejemplo,
 * "Shell local" arriba de todo).
 */
export type SidebarOrder = Record<string, string[]>;

export const itemKey = (it: TreeItem) => (it.kind === "folder" ? `f:${it.node.name}` : `s:${it.session.id}`);

/**
 * Elementos de una carpeta: primero los que tienen orden manual, en ese orden; después el
 * resto como siempre (carpetas y luego sesiones, alfabético). Claves de elementos que ya no
 * existen se ignoran.
 */
/** Valor propio de un mapa por ruta de carpeta: una carpeta "constructor" no lee Object.prototype. */
export const own = <T,>(map: Record<string, T> | undefined, key: string): T | undefined => (map && Object.hasOwn(map, key) ? map[key] : undefined);

export function orderedItems(node: FolderNode, order?: string[]): TreeItem[] {
  const items: TreeItem[] = [
    ...node.children.map((n): TreeItem => ({ kind: "folder", node: n })),
    ...node.sessions.map((s): TreeItem => ({ kind: "session", session: s })),
  ];
  // El orden viene de ajustes que se pueden editar o compartir: solo se usa si es una lista de textos.
  if (!Array.isArray(order) || !order.length) return items;
  const pos = new Map(order.filter((k): k is string => typeof k === "string").map((k, i) => [k, i]));
  return items
    .map((it, i) => ({ it, i, p: pos.get(itemKey(it)) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.it);
}

/**
 * Nuevo orden de una carpeta al dejar `key` antes o después de `anchor`, o al inicio o al final.
 * `keys` es el orden visible actual; `key` puede no estar (viene de otra carpeta).
 */
export function placeKey(keys: string[], key: string, anchor: string | null, where: "before" | "after" | "start" | "end"): string[] {
  const rest = keys.filter((k) => k !== key);
  if (where === "start") return [key, ...rest];
  if (where === "end" || anchor === null) return [...rest, key];
  const i = rest.indexOf(anchor);
  if (i < 0) return [...rest, key];
  rest.splice(where === "before" ? i : i + 1, 0, key);
  return rest;
}

/** Carpeta del árbol por ruta. */
export function findFolder(root: FolderNode, path: string): FolderNode | undefined {
  if (root.path === path) return root;
  for (const c of root.children) {
    const f = path === c.path || path.startsWith(`${c.path}/`) ? findFolder(c, path) : undefined;
    if (f) return f;
  }
  return undefined;
}
