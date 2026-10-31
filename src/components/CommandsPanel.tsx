import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  Copy,
  CornerDownLeft,
  ExternalLink,
  Package,
  Pencil,
  Play,
  Plus,
  Radar,
  Search,
  Star,
  TextCursorInput,
  X,
} from "lucide-react";
import { CATEGORIES, CatalogEntry, CatalogVendor, OS_VENDORS, Risk, appliesTo, commandFor, riskLabel } from "../lib/packs";
import { modLabel } from "../lib/platform";
import { PanelResize, panelClass } from "./PanelResize";

interface Props {
  width: number;
  onResize: (w: number) => void;
  /** Ventana angosta: el panel se superpone a la terminal. */
  overlay?: boolean;
  catalog: CatalogVendor[];
  vendor: string;
  onVendor: (v: string) => void;
  /** Plataforma de la sesión activa para este fabricante (detectada o elegida). */
  platform: string | null;
  onPlatform: (p: string | null) => void;
  onDetect: (() => void) | null;
  detecting: boolean;
  favorites: string[];
  onFavorites: (f: string[]) => void;
  target: string | null;
  onRun: (c: CatalogEntry, cmd: string) => void;
  onType: (cmd: string) => void;
  onAdd: (vendor: string) => void;
  onEdit: (c: CatalogEntry) => void;
  onPacks: () => void;
  onClose: () => void;
}

// Familia Fortinet agrupada: el pack "fortinet" es FortiGate (FortiOS) y gestiona al resto.
const FORTI_ORDER = ["fortinet", "fortiswitch", "fortiap", "fortiextender"];
const FORTI_LABEL: Record<string, string> = { fortinet: "FortiGate (FortiOS)" };
const isForti = (id: string) => FORTI_ORDER.includes(id);

const riskStyle: Record<Risk, string> = { read: "text-ok", change: "text-warn", disruptive: "text-danger" };
const riskBorder: Record<Risk, string> = { read: "border-transparent", change: "border-[var(--warn)]", disruptive: "border-[var(--danger)]" };
const riskIcon: Record<Risk, string> = { read: "●", change: "▲", disruptive: "✕" };

function CmdText({ cmd }: { cmd: string }) {
  const parts = cmd.split(/(\{\{[^}]+\}\})/);
  return (
    <code className="block font-mono text-[12px] whitespace-pre-wrap break-all">
      {parts.map((p, i) =>
        p.startsWith("{{") ? (
          <span key={i} className="text-accent font-semibold">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </code>
  );
}

/** Texto de búsqueda en minúsculas, calculado una vez por comando. */
const haystacks = new WeakMap<CatalogEntry, string>();
function haystack(c: CatalogEntry): string {
  let h = haystacks.get(c);
  if (h === undefined) {
    h = `${c.cmd}\n${c.desc}\n${c.note ?? ""}`.toLowerCase();
    haystacks.set(c, h);
  }
  return h;
}

interface RowActions {
  run: (c: CatalogEntry, cmd: string) => void;
  type: (cmd: string) => void;
  copy: (c: CatalogEntry, cmd: string) => void;
  fav: (key: string, fav: boolean) => void;
  edit: (c: CatalogEntry) => void;
}

export const CommandsPanel = memo(function CommandsPanel(p: Props) {
  const [query, setQuery] = useState("");
  // El filtro usa el valor diferido: el campo responde al instante aunque la lista sea larga.
  const deferredQuery = useDeferredValue(query);
  const [onlyRead, setOnlyRead] = useState(false);
  const [onlyFav, setOnlyFav] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ Sistema: true });
  const [copied, setCopied] = useState<string | null>(null);
  const vendor = p.catalog.find((v) => v.id === p.vendor) ?? p.catalog[0];
  const platform = vendor?.platforms.some((x) => x.id === p.platform) ? p.platform : null;
  const favSet = useMemo(() => new Set(p.favorites), [p.favorites]);

  // Acciones estables para que las filas memorizadas no se vuelvan a dibujar en cada render.
  const pRef = useRef(p);
  pRef.current = p;
  const actions = useMemo<RowActions>(
    () => ({
      run: (c, cmd) => pRef.current.onRun(c, cmd),
      type: (cmd) => pRef.current.onType(cmd),
      copy: async (c, cmd) => {
        await writeText(cmd);
        setCopied(c.cmd);
        window.setTimeout(() => setCopied(null), 1500);
      },
      fav: (key, fav) => {
        const f = pRef.current.favorites;
        pRef.current.onFavorites(fav ? f.filter((x) => x !== key) : [...f, key]);
      },
      edit: (c) => pRef.current.onEdit(c),
    }),
    [],
  );

  const groups = useMemo(() => {
    if (!vendor) return [];
    const q = deferredQuery.trim().toLowerCase();
    const list = vendor.commands.filter(
      (c) =>
        appliesTo(c, platform) &&
        (!q || haystack(c).includes(q)) &&
        (!onlyRead || c.risk === "read") &&
        (!onlyFav || favSet.has(`${vendor.id}:${c.cmd}`)),
    );
    const byCat = new Map<string, CatalogEntry[]>();
    for (const c of list) {
      const l = byCat.get(c.cat);
      if (l) l.push(c);
      else byCat.set(c.cat, [c]);
    }
    return CATEGORIES.filter((cat) => byCat.has(cat)).map((cat) => [cat, byCat.get(cat)!] as const);
  }, [vendor, platform, deferredQuery, onlyRead, onlyFav, favSet]);

  const filtering = !!deferredQuery.trim() || onlyFav;
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  const platLabel = useCallback((id: string) => vendor?.platforms.find((x) => x.id === id)?.label ?? id, [vendor]);

  return (
    <aside className={panelClass(!!p.overlay)} style={{ width: p.width }}>
      <PanelResize width={p.width} onResize={p.onResize} />
      <header className="flex items-center gap-1 px-2 h-9 border-b border-line">
        {/* Lista agrupada: con equipos de red y sistemas operativos ya no caben como pestañas. */}
        <select
          aria-label="Catálogo"
          className="field !h-7 flex-1 min-w-0 !text-[12px] font-medium"
          value={vendor?.id ?? ""}
          onChange={(e) => p.onVendor(e.target.value)}
        >
          {[
            ["Equipos de red", p.catalog.filter((v) => !OS_VENDORS.includes(v.id) && !isForti(v.id))],
            ["Fortinet", FORTI_ORDER.map((id) => p.catalog.find((v) => v.id === id)).filter((v): v is CatalogVendor => !!v)],
            ["Sistemas operativos", p.catalog.filter((v) => OS_VENDORS.includes(v.id))],
          ].map(([label, list]) =>
            (list as CatalogVendor[]).length ? (
              <optgroup key={label as string} label={label as string}>
                {(list as CatalogVendor[]).map((v) => (
                  <option key={v.id} value={v.id}>
                    {(label === "Fortinet" && FORTI_LABEL[v.id]) || v.name} · {v.commands.length}
                  </option>
                ))}
              </optgroup>
            ) : null,
          )}
        </select>
        <HeadBtn title="Packs de comandos" onClick={p.onPacks}>
          <Package size={14} />
        </HeadBtn>
        <HeadBtn title={`Cerrar (${modLabel}L)`} onClick={p.onClose}>
          <X size={15} />
        </HeadBtn>
      </header>

      <div className="px-2 pt-2 space-y-1.5">
        {vendor && vendor.platforms.length > 0 && (
          <div className="flex gap-1.5">
            <select
              className="field !h-7 !text-[12px] flex-1 min-w-0"
              value={platform ?? ""}
              onChange={(e) => p.onPlatform(e.target.value || null)}
              title="La sintaxis y los comandos se ajustan a la plataforma"
            >
              <option value="">Todas las plataformas</option>
              {vendor.platforms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            {p.onDetect && (
              <button
                onClick={p.onDetect}
                disabled={p.detecting}
                title={`Detectar ejecutando "${vendor.detectCommand}" en la sesión`}
                className="shrink-0 flex items-center gap-1 px-2 h-7 rounded-md border border-line text-[11.5px] hover:bg-hover disabled:opacity-40"
              >
                <Radar size={12} className={p.detecting ? "animate-pulse" : ""} />
                {/* Panel angosto: solo el ícono, para que el selector de plataforma se lea. */}
                <span className="hidden @[19rem]:inline">Detectar</span>
              </button>
            )}
          </div>
        )}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="field !h-7 !pl-8 !text-[12px] w-full min-w-0"
            placeholder="Buscar comando o tarea"
            title="Por comando o por tarea: vecinos, óptico, CPU, VLAN…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 @[19rem]:gap-3 text-[11.5px] text-muted">
          <label className="flex items-center gap-1.5 shrink-0" title="Solo consultas: oculta lo que cambia configuración o puede cortar servicio">
            <input type="checkbox" className="accent-[var(--accent)]" checked={onlyRead} onChange={(e) => setOnlyRead(e.target.checked)} />
            <span className="@[19rem]:hidden">Consultas</span>
            <span className="hidden @[19rem]:inline">Solo consultas</span>
          </label>
          <label className="flex items-center gap-1.5 shrink-0">
            <input type="checkbox" className="accent-[var(--accent)]" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} />
            Favoritos
          </label>
          <span className="ml-auto shrink-0 font-medium">{total}</span>
          {vendor && (
            <button title="Agregar un comando propio" onClick={() => p.onAdd(vendor.id)} className="h-6 px-1 text-accent hover:underline flex items-center gap-0.5 shrink-0 select-none touch-manipulation active:opacity-80">
              <Plus size={12} /> Propio
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {groups.map(([cat, list]) => {
          const isOpen = filtering || open[cat];
          return (
            <div key={cat}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [cat]: !o[cat] }))}
                className="w-full flex items-center gap-1 px-1 h-7 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-fg"
              >
                <ChevronRight size={12} className={`transition-transform ${isOpen ? "rotate-90" : ""}`} />
                {cat}
                <span className="ml-auto font-normal">{list.length}</span>
              </button>
              {isOpen &&
                list.map((c) => (
                  <CommandRow
                    key={c.cmd}
                    c={c}
                    cmd={commandFor(c, platform)}
                    favKey={`${vendor.id}:${c.cmd}`}
                    fav={favSet.has(`${vendor.id}:${c.cmd}`)}
                    showVariants={!platform}
                    platLabel={platLabel}
                    target={p.target}
                    copied={copied === c.cmd}
                    actions={actions}
                  />
                ))}
            </div>
          );
        })}
        {total === 0 && <p className="p-4 text-center text-[12px] text-muted">Sin resultados</p>}
      </div>

      <footer className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-line text-[11px] text-muted min-h-6">
        <span
          className="flex-1 min-w-0 truncate"
          title={`${p.target ? `Destino: ${p.target}` : "Sin sesión conectada"}${platform ? ` · ${platLabel(platform)}` : ""} · verifica la sintaxis en tu versión`}
        >
          {p.target ? `Destino: ${p.target}` : "Sin sesión conectada"}
          {platform ? ` · ${platLabel(platform)}` : ""} · verifica la sintaxis en tu versión
        </span>
      </footer>
    </aside>
  );
});

const CommandRow = memo(function CommandRow({
  c,
  cmd,
  favKey,
  fav,
  showVariants,
  platLabel,
  target,
  copied,
  actions,
}: {
  c: CatalogEntry;
  cmd: string;
  favKey: string;
  fav: boolean;
  showVariants: boolean;
  platLabel: (id: string) => string;
  target: string | null;
  copied: boolean;
  actions: RowActions;
}) {
  return (
    <div
      className={`group rounded-lg px-2 py-1.5 hover:bg-hover border-l-2 [content-visibility:auto] [contain-intrinsic-size:auto_64px] ${riskBorder[c.risk]}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <CmdText cmd={cmd} />
          <p className="text-[11.5px] text-muted mt-0.5 leading-snug">{c.desc}</p>
          {showVariants && c.variants?.length ? (
            <div className="mt-1 space-y-0.5">
              {c.variants.map((v) => (
                <div key={v.cmd} className="text-[11px] text-muted">
                  <span className="font-medium">{v.platforms.map(platLabel).join(", ")}:</span>{" "}
                  <code className="font-mono">{v.cmd}</code>
                </div>
              ))}
            </div>
          ) : null}
          {c.note && <p className="text-[11px] text-muted mt-0.5 italic leading-snug">{c.note}</p>}
          <div className="flex flex-wrap items-center gap-x-2 mt-0.5 text-[11px]">
            <span className={riskStyle[c.risk]} title={c.escalated ? `El pack lo declaró "${riskLabel[c.declaredRisk]}"; la app lo subió por seguridad` : undefined}>
              {riskIcon[c.risk]} {riskLabel[c.risk]}
              {c.escalated ? " (ajustado)" : ""}
            </span>
            {showVariants && c.platforms?.length ? <span className="text-muted">{c.platforms.map(platLabel).join(", ")}</span> : null}
            {!c.builtin && <span className="text-accent">{c.packName}</span>}
          </div>
        </div>
        <button
          title={fav ? "Quitar de favoritos" : "Agregar a favoritos"}
          onClick={() => actions.fav(favKey, fav)}
          className={`shrink-0 mt-0.5 p-1 -m-1 ${fav ? "text-warn" : "text-muted opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
        >
          <Star size={14} fill={fav ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="flex sm:hidden sm:group-hover:flex flex-wrap gap-1.5 sm:gap-1 mt-2 sm:mt-1.5">
        <PanelBtn disabled={!target} onClick={() => actions.run(c, cmd)} title={target ? `Ejecutar en ${target}` : "Conecta una sesión"}>
          <Play size={11} /> Ejecutar
        </PanelBtn>
        {!cmd.includes("\n") && (
          <PanelBtn disabled={!target} onClick={() => actions.type(cmd)} title="Escribir en la terminal sin Enter">
            <TextCursorInput size={11} /> Escribir
          </PanelBtn>
        )}
        <PanelBtn onClick={() => actions.copy(c, cmd)}>
          {copied ? <CornerDownLeft size={11} /> : <Copy size={11} />} {copied ? "Copiado" : "Copiar"}
        </PanelBtn>
        {c.source && (
          <PanelBtn onClick={() => openUrl(c.source!)} title={c.source}>
            <ExternalLink size={11} /> Fuente
          </PanelBtn>
        )}
        {c.packId.startsWith("user-") && (
          <PanelBtn onClick={() => actions.edit(c)}>
            <Pencil size={11} /> Editar
          </PanelBtn>
        )}
      </div>
    </div>
  );
});

function HeadBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="w-8 h-8 sm:w-7 sm:h-7 shrink-0 grid place-items-center rounded-full sm:rounded-md text-muted hover:text-fg hover:bg-hover" />;
}

function PanelBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex items-center gap-1 px-2.5 sm:px-2 h-7 sm:h-6 rounded-full sm:rounded-md border border-line bg-panel text-[11.5px] font-medium sm:font-normal hover:bg-hover active:bg-selected disabled:opacity-40"
    />
  );
}
