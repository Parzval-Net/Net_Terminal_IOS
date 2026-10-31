import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { AlertTriangle, ClipboardCopy, Download, KeyRound, Pause, Play, Square, Trash2 } from "lucide-react";
import type { Settings } from "../../lib/settings";
import {
  AUTH_PROTOS,
  PRESETS,
  PRIV_PROTOS,
  QUICK,
  SWRUN_PARAMS,
  type Column,
  type Preset,
  type Row,
  type Secrets,
  type SnmpProfile,
  type Table,
  type Trap,
  buildTable,
  csvCell,
  fmtBits,
  formatCell,
  newProfile,
  oidName,
  OIDS,
  rate,
  rowsToCsv,
  securityWarnings,
  tableToCsv,
  targetParams,
  trapSummary,
} from "../../lib/snmp";
import { Btn, Label, Section, StatusPill, Toggle } from "./ui";
import { useLocalIp } from "./useLocalIp";
import SnmpConfigGen from "./SnmpConfigGen";

import { plural } from "../../lib/plural";
type Op = "get" | "getnext" | "walk" | "getbulk";
const OPS: { id: Op; label: string }[] = [
  { id: "get", label: "GET" },
  { id: "getnext", label: "GETNEXT" },
  { id: "walk", label: "WALK" },
  { id: "getbulk", label: "GETBULK" },
];
const EMPTY: Secrets = { community: "", authPass: "", privPass: "" };
const MAX_TRAPS = 2000;
/** Segundos entre las dos lecturas para calcular tasas de interfaces. */
const RATE_INTERVAL = 10;

interface Props {
  settings: Settings;
  running: string[];
  onChange: (p: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;
  refreshRunning: () => void;
  onConfirm: (req: { title: string; message: string; label: string; danger?: boolean; action: () => void }) => void;
}

async function exportCsv(name: string, content: string, setMsg: (m: string) => void) {
  const dest = await save({ defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (!dest) return;
  await invoke("save_text", { dest, content })
    .then(() => setMsg(`Guardado: ${dest}`))
    .catch((e) => setMsg(String(e)));
}

const TABS = [
  { id: "client", label: "Cliente" },
  { id: "config", label: "Generador de configuración" },
] as const;

export default function SnmpTool(props: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("client");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-line p-0.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-2.5 h-7 rounded text-[12px] ${tab === t.id ? "bg-selected text-fg font-medium" : "text-muted hover:text-fg"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* El cliente queda montado al cambiar de pestaña para no cortar consultas ni el receptor de traps. */}
      <div hidden={tab !== "client"}>
        <SnmpClient {...props} />
      </div>
      {tab === "config" && <SnmpConfigGen />}
    </div>
  );
}

function SnmpClient({ settings: s, running, onChange, refreshRunning, onConfirm }: Props) {
  const [cur, setCur] = useState<SnmpProfile>(() => s.snmpProfiles[0] ?? newProfile());
  const [secrets, setSecrets] = useState<Secrets>(EMPTY);
  const [legacy, setLegacy] = useState(false);
  const [saveVault, setSaveVault] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (p: Partial<SnmpProfile>) => setCur((c) => ({ ...c, ...p }));
  const target = () => targetParams(cur, secrets);
  const warnings = securityWarnings(cur, secrets.community, cur.saved);

  // Al cambiar de perfil los secretos tecleados se descartan: nunca pasan de un equipo a otro.
  const pick = (id: string) => {
    setSecrets(EMPTY);
    setCur(s.snmpProfiles.find((p) => p.id === id) ?? newProfile());
  };

  const saveProfile = async () => {
    const p = { ...cur, name: cur.name.trim() || cur.host.trim() || "Perfil SNMP" };
    setMsg("");
    try {
      if (saveVault) {
        await invoke("snmp_secret_set", { profile: p.id, host: p.host.trim(), port: p.port, community: secrets.community || null, authPass: secrets.authPass || null, privPass: secrets.privPass || null });
        p.saved = true;
        setSecrets(EMPTY);
        setSaveVault(false);
      }
      setCur(p);
      onChange((st) => ({ snmpProfiles: [...st.snmpProfiles.filter((x) => x.id !== p.id), p] }));
      setMsg(p.saved ? "Perfil guardado. Los secretos quedan en la bóveda cifrada." : "Perfil guardado sin secretos.");
    } catch (e) {
      setMsg(String(e));
    }
  };

  const forgetSecrets = () =>
    invoke("snmp_secret_delete", { profile: cur.id })
      .then(() => {
        const p = { ...cur, saved: false };
        setCur(p);
        onChange((st) => ({ snmpProfiles: st.snmpProfiles.map((x) => (x.id === p.id ? p : x)) }));
      })
      .catch((e) => setMsg(String(e)));

  const deleteProfile = () =>
    onConfirm({
      title: `¿Eliminar el perfil ${cur.name || cur.host}?`,
      message: cur.saved ? "También se borran sus secretos de la bóveda." : "Solo se borra el perfil.",
      label: "Eliminar",
      danger: true,
      action: () => {
        if (cur.saved) invoke("snmp_secret_delete", { profile: cur.id }).catch(() => {});
        onChange((st) => ({ snmpProfiles: st.snmpProfiles.filter((x) => x.id !== cur.id) }));
        setSecrets(EMPTY);
        setCur(newProfile());
      },
    });

  const authOptions = AUTH_PROTOS.filter((a) => !a.legacy || legacy || a.id === cur.authProto);
  const privOptions = PRIV_PROTOS.filter((a) => !a.legacy || legacy || a.id === cur.privProto);
  const known = s.snmpProfiles.some((p) => p.id === cur.id);

  return (
    <div className="space-y-4">
      <Section
        title="Destino SNMP"
        hint="Cliente de prueba de solo lectura (GET, GETNEXT, WALK, GETBULK). Los secretos no se guardan salvo que lo pidas, y entonces van a la bóveda cifrada."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select className="field !h-7 w-full sm:!w-52" value={known ? cur.id : ""} onChange={(e) => pick(e.target.value)}>
              <option value="">Nuevo destino</option>
              {s.snmpProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.host}
                </option>
              ))}
            </select>
            {known && (
              <Btn kind="ghost" title="Eliminar perfil" onClick={deleteProfile}>
                <Trash2 size={13} />
              </Btn>
            )}
          </div>
        }
      >
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 @[40rem]:grid-cols-3 @[56rem]:[grid-template-columns:2fr_0.7fr_0.9fr_0.8fr_0.7fr_1.4fr]">
          <Label text="Host o IP">
            <input className="field font-mono" value={cur.host} placeholder="192.0.2.1" onChange={(e) => set({ host: e.target.value })} />
          </Label>
          <Label text="Puerto">
            <input className="field" type="number" value={cur.port} onChange={(e) => set({ port: Number(e.target.value) || 161 })} />
          </Label>
          <Label text="Versión">
            <select className="field" value={cur.version} onChange={(e) => set({ version: e.target.value as SnmpProfile["version"] })}>
              <option value="3">SNMPv3</option>
              <option value="2c">v2c</option>
              <option value="1">v1</option>
            </select>
          </Label>
          <Label text="Timeout (ms)">
            <input className="field" type="number" value={cur.timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) || 2000 })} />
          </Label>
          <Label text="Reintentos">
            <input className="field" type="number" min={0} max={5} value={cur.retries} onChange={(e) => set({ retries: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} />
          </Label>
          <Label text="Nombre del perfil">
            <input className="field" value={cur.name} placeholder="Core Santiago" onChange={(e) => set({ name: e.target.value })} />
          </Label>
        </div>

        {cur.version !== "3" ? (
          <div className="mt-3 grid gap-3 grid-cols-1 @[40rem]:[grid-template-columns:2fr_4fr]">
            <Label text={cur.saved ? "Community (guardada en la bóveda)" : "Community"}>
              <input
                className="field font-mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secrets.community}
                placeholder={cur.saved ? "••••••••" : ""}
                onChange={(e) => setSecrets({ ...secrets, community: e.target.value })}
              />
            </Label>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2 @[40rem]:grid-cols-3 @[64rem]:[grid-template-columns:1.2fr_1.1fr_1.3fr_1.3fr_1.4fr_1.3fr_1fr]">
            <Label text="Usuario">
              <input className="field font-mono" value={cur.user} autoComplete="off" onChange={(e) => set({ user: e.target.value })} />
            </Label>
            <Label text="Nivel">
              <select className="field" value={cur.level} onChange={(e) => set({ level: e.target.value as SnmpProfile["level"] })}>
                <option value="authPriv">authPriv</option>
                <option value="authNoPriv">authNoPriv</option>
                <option value="noAuthNoPriv">noAuthNoPriv</option>
              </select>
            </Label>
            <Label text="Autenticación">
              <select className="field" disabled={cur.level === "noAuthNoPriv"} value={cur.authProto} onChange={(e) => set({ authProto: e.target.value as SnmpProfile["authProto"] })}>
                {authOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Contraseña auth">
              <input
                className="field"
                type="password"
                autoComplete="off"
                disabled={cur.level === "noAuthNoPriv"}
                placeholder={cur.saved ? "••••••••" : "mín. 8"}
                value={secrets.authPass}
                onChange={(e) => setSecrets({ ...secrets, authPass: e.target.value })}
              />
            </Label>
            <Label text="Privacidad">
              <select className="field" disabled={cur.level !== "authPriv"} value={cur.privProto} onChange={(e) => set({ privProto: e.target.value as SnmpProfile["privProto"] })}>
                {privOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Label>
            <Label text="Contraseña priv">
              <input
                className="field"
                type="password"
                autoComplete="off"
                disabled={cur.level !== "authPriv"}
                placeholder={cur.saved ? "••••••••" : "mín. 8"}
                value={secrets.privPass}
                onChange={(e) => setSecrets({ ...secrets, privPass: e.target.value })}
              />
            </Label>
            <Label text="Contexto">
              <input className="field font-mono" value={cur.context} placeholder="(vacío)" onChange={(e) => set({ context: e.target.value })} />
            </Label>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-4">
          {cur.version === "3" && <Toggle checked={legacy} onChange={setLegacy} label="Mostrar algoritmos heredados (MD5, DES)" />}
          <Toggle checked={saveVault} onChange={setSaveVault} label="Guardar secretos en la bóveda cifrada" />
          {cur.saved && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <KeyRound size={13} /> Secretos en la bóveda ·
              <button className="underline hover:text-fg" onClick={forgetSecrets}>
                olvidar
              </button>
            </span>
          )}
          <Btn className="ml-auto" onClick={saveProfile} disabled={!cur.host.trim()}>
            Guardar perfil
          </Btn>
        </div>
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1">
            {warnings.map((w) => (
              <li key={w} className="flex items-start gap-1.5 text-[12px] text-warn">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="mt-2 text-[12px] text-muted">{msg}</p>}
      </Section>

      <QuerySection target={target} profile={cur} />
      <PresetsSection target={target} profile={cur} onConfirm={onConfirm} />
      <TrapSection settings={s} running={running} onChange={onChange} refreshRunning={refreshRunning} target={target} profile={cur} />
    </div>
  );
}

// ---------- Consultas ----------

type TargetFn = () => ReturnType<typeof targetParams>;

function QuerySection({ target, profile }: { target: TargetFn; profile: SnmpProfile }) {
  const [op, setOp] = useState<Op>("get");
  const [oid, setOid] = useState("1.3.6.1.2.1.1.1.0");
  const [maxRep, setMaxRep] = useState(10);
  const [maxRows, setMaxRows] = useState(10000);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const job = useRef<string | null>(null);

  useEffect(() => {
    const un = listen<{ job: string; kind: string; text: string; data?: { rows?: Row[]; count?: number; truncated?: boolean; cancelled?: boolean; ms?: number } }>("tool-job", ({ payload: e }) => {
      if (e.job !== job.current) return;
      if (e.kind === "line" && e.data?.rows) {
        const add = e.data.rows;
        setRows((r) => [...r, ...add]);
      } else if (e.kind === "result" && e.data) {
        const d = e.data;
        setStatus(`${plural(d.count ?? 0, "fila", "filas")} en ${d.ms} ms${d.cancelled ? " · detenido" : d.truncated ? " · se alcanzó el máximo de filas" : ""}`);
      } else if (e.kind === "error") setError(e.text);
      else if (e.kind === "done") {
        job.current = null;
        setBusy(false);
      }
    });
    return () => {
      un.then((f) => f());
      if (job.current) invoke("tool_stop", { job: job.current }).catch(() => {});
    };
  }, []);

  const run = async (o = op, id = oid) => {
    setError("");
    setStatus("");
    setRows([]);
    setBusy(true);
    const oids = id.split(/[\s,]+/).filter(Boolean);
    const start = performance.now();
    try {
      if (o === "walk") {
        job.current = await invoke<string>("snmp_walk", { target: target(), oid: oids[0] ?? "", maxRows, bulk: profile.version === "1" ? null : maxRep });
        return;
      }
      const r = await invoke<Row[]>("snmp_request", { target: target(), op: o, oids, maxRep });
      setRows(r);
      setStatus(`${plural(r.length, "fila", "filas")} en ${Math.round(performance.now() - start)} ms`);
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  const stop = () => {
    if (job.current) invoke("tool_stop", { job: job.current }).catch(() => {});
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((r) => r.oid.includes(q) || r.value.toLowerCase().includes(q) || oidName(r.oid).toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  return (
    <Section
      title="Consulta"
      hint={profile.version === "1" ? "SNMPv1 no tiene GETBULK: WALK usa GETNEXT." : "WALK usa GETBULK con las repeticiones indicadas."}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="inline-flex rounded-md border border-line p-0.5">
          {OPS.map((o) => (
            <button
              key={o.id}
              disabled={o.id === "getbulk" && profile.version === "1"}
              onClick={() => setOp(o.id)}
              className={`px-2.5 h-7 rounded text-[12px] disabled:opacity-40 ${op === o.id ? "bg-selected text-fg font-medium" : "text-muted hover:text-fg"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <Label text={op === "walk" ? "OID raíz" : "OID (varios separados por espacio)"} className="flex-1 min-w-[200px] w-full sm:w-auto">
          <input
            className="field font-mono"
            list="snmp-oids"
            value={oid}
            onChange={(e) => setOid(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && run()}
          />
          <datalist id="snmp-oids">
            {OIDS.map((o) => (
              <option key={o.oid} value={o.oid}>
                {o.name} ({o.mib})
              </option>
            ))}
          </datalist>
        </Label>
        {(op === "getbulk" || (op === "walk" && profile.version !== "1")) && (
          <Label text="Max-repetitions" className="w-24 sm:w-28">
            <input className="field" type="number" min={1} max={100} value={maxRep} onChange={(e) => setMaxRep(Math.min(100, Math.max(1, Number(e.target.value) || 10)))} />
          </Label>
        )}
        {op === "walk" && (
          <Label text="Máx. filas" className="w-24 sm:w-28">
            <input className="field" type="number" min={1} max={100000} value={maxRows} onChange={(e) => setMaxRows(Math.min(100000, Math.max(1, Number(e.target.value) || 10000)))} />
          </Label>
        )}
        {busy && op === "walk" ? (
          <Btn onClick={stop}>
            <Square size={13} /> Detener
          </Btn>
        ) : (
          <Btn kind="primary" disabled={busy || !profile.host.trim()} onClick={() => run()}>
            <Play size={13} /> Consultar
          </Btn>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {QUICK.map((q) => (
          <button
            key={q.label}
            className="px-2 h-6 rounded-md bg-hover text-[11.5px] text-muted hover:text-fg"
            title={`${q.op.toUpperCase()} ${q.oid}`}
            onClick={() => {
              setOid(q.oid);
              setOp(q.op);
            }}
          >
            {q.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

      {(rows.length > 0 || busy || status) && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[12px] text-muted">{busy ? `${plural(rows.length, "fila", "filas")}…` : status}</span>
            <input className="field !h-7 w-full sm:!w-56 ml-auto" placeholder="Filtrar OID, nombre o valor" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Btn kind="ghost" title="Copiar como CSV" disabled={!rows.length} onClick={() => writeText(rowsToCsv(shown))}>
              <ClipboardCopy size={13} />
            </Btn>
            <Btn kind="ghost" disabled={!rows.length} onClick={() => exportCsv("snmp.csv", rowsToCsv(shown), setStatus)}>
              <Download size={13} /> CSV
            </Btn>
          </div>
          <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
            <table className="w-full text-[12px] min-w-[480px]">
              <thead className="sticky top-0 bg-panel text-left text-muted">
                <tr>
                  <th className="px-2 py-1.5 font-medium">OID</th>
                  <th className="px-2 font-medium">Nombre</th>
                  <th className="px-2 font-medium">Tipo</th>
                  <th className="px-2 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 5000).map((r, i) => (
                  <tr key={`${r.oid}-${i}`} className="border-t border-line align-top">
                    <td className="px-2 py-1 font-mono whitespace-nowrap select-text">{r.oid}</td>
                    <td className="px-2 whitespace-nowrap text-muted">{oidName(r.oid)}</td>
                    <td className="px-2 whitespace-nowrap text-muted">{r.type}</td>
                    <td className={`px-2 break-all select-text ${r.type.startsWith("no") || r.type === "endOfMibView" ? "text-muted italic" : ""}`}>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 5000 && <p className="p-2 text-[11.5px] text-muted">Se muestran 5.000 de {shown.length}; exporta a CSV para verlas todas.</p>}
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------- Conjuntos de OIDs ----------

interface PresetResult {
  preset: Preset;
  table?: Table;
  scalars?: { col: Column; row?: Row }[];
  bits32?: boolean;
  /** Tasas por índice (bits/s entrada y salida). */
  rates?: Record<string, [number | null, number | null]>;
  errors: string[];
}

function PresetsSection({ target, profile, onConfirm }: { target: TargetFn; profile: SnmpProfile; onConfirm: Props["onConfirm"] }) {
  const [res, setRes] = useState<PresetResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [params, setParams] = useState(false);
  const [msg, setMsg] = useState("");

  const walkColumns = async (cols: Column[]) => {
    const r = await invoke<{ oid: string; rows: Row[]; error: string | null }[]>("snmp_walk_many", { target: target(), oids: cols.map((c) => c.oid), maxRows: 5000 });
    return { table: buildTable(cols, r.map((x) => x.rows)), errors: r.filter((x) => x.error).map((x) => `${oidName(x.oid) || x.oid}: ${x.error}`) };
  };

  const load = async (p: Preset) => {
    setBusy(p.id);
    setError("");
    setMsg("");
    try {
      if (p.scalars) {
        const rows = await invoke<Row[]>("snmp_request", { target: target(), op: "get", oids: p.scalars.map((c) => c.oid) });
        setRes({ preset: p, scalars: p.scalars.map((col) => ({ col, row: rows.find((r) => r.oid === col.oid) })), errors: [] });
      } else if (p.columns) {
        const cols = p.id === "processes" && params ? [...p.columns, SWRUN_PARAMS] : p.columns;
        let { table, errors } = await walkColumns(cols);
        let bits32 = false;
        // Sin ifXTable (agentes antiguos): contadores de 32 bits de ifTable.
        if (p.fallback && table.rows.every((r) => r.cells.slice(4).every((c) => !c))) {
          ({ table, errors } = await walkColumns(p.fallback));
          bits32 = true;
        }
        setRes({ preset: p, table, errors, bits32 });
      }
    } catch (e) {
      setError(String(e));
    }
    setBusy(null);
  };

  /** Segunda lectura de los contadores para calcular bits/s por interfaz. */
  const measure = async () => {
    if (!res?.table) return;
    const t0 = res.table;
    const counters = t0.columns.map((c, i) => (c.fmt === "counter" ? i : -1)).filter((i) => i >= 0);
    setBusy("rates");
    setMsg(`Midiendo durante ${RATE_INTERVAL} s…`);
    const start = performance.now();
    await new Promise((r) => setTimeout(r, RATE_INTERVAL * 1000));
    try {
      const { table: t1 } = await walkColumns(counters.map((i) => t0.columns[i]));
      const secs = (performance.now() - start) / 1000;
      const now = new Map(t1.rows.map((r) => [r.index, r.cells]));
      const rates: PresetResult["rates"] = {};
      for (const r of t0.rows) {
        const c1 = now.get(r.index);
        rates[r.index] = [
          rate(r.cells[counters[0]]?.value, c1?.[0]?.value, secs, !res.bits32),
          rate(r.cells[counters[1]]?.value, c1?.[1]?.value, secs, !res.bits32),
        ];
      }
      setRes({ ...res, rates });
      setMsg(`Tasas promedio de ${secs.toFixed(1)} s`);
    } catch (e) {
      setMsg(String(e));
    }
    setBusy(null);
  };

  const toggleParams = (v: boolean) => {
    if (!v) return setParams(false);
    onConfirm({
      title: "¿Leer los parámetros de los procesos?",
      message:
        "hrSWRunParameters devuelve los argumentos de línea de comando de cada proceso. En servidores puede incluir contraseñas, tokens o rutas sensibles. Úsalo solo si lo necesitas y no compartas el resultado.",
      label: "Leer parámetros",
      danger: true,
      action: () => setParams(true),
    });
  };

  const t = res?.table;
  const csv = () => (t ? tableToCsv(t) : (res?.scalars ?? []).map((x) => [x.col.label, formatCell(x.col, x.row)].map(csvCell).join(",")).join("\n"));

  return (
    <Section title="Conjuntos de OIDs" hint="Telemetría por MIB estándar, en tablas. Solo lectura.">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Btn key={p.id} kind={res?.preset.id === p.id ? "primary" : "default"} disabled={!!busy || !profile.host.trim()} title={p.hint} onClick={() => load(p)}>
            {busy === p.id ? "Leyendo…" : p.label}
          </Btn>
        ))}
        <span className="ml-auto">
          <Toggle checked={params} onChange={toggleParams} label="Parámetros de procesos (sensible)" />
        </span>
      </div>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      {res && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] text-muted truncate" title={res.preset.hint}>
              {res.preset.hint}
            </span>
            {res.bits32 && (
              <span className="inline-flex items-center gap-1 text-[12px] text-warn whitespace-nowrap">
                <AlertTriangle size={13} /> 32 bits: puede reiniciarse en enlaces de 1 Gbps o más
              </span>
            )}
            <span className="ml-auto" />
            {res.preset.rates && t && (
              <Btn disabled={!!busy} onClick={measure} title={`Lee los contadores dos veces con ${RATE_INTERVAL} s de diferencia`}>
                {busy === "rates" ? <Pause size={13} /> : <Play size={13} />} Medir tasas
              </Btn>
            )}
            <Btn kind="ghost" onClick={() => exportCsv(`snmp-${res.preset.id}.csv`, csv(), setMsg)}>
              <Download size={13} /> CSV
            </Btn>
          </div>
          {msg && <p className="mb-2 text-[12px] text-muted">{msg}</p>}
          {res.scalars && (
            <table className="w-full text-[12.5px]">
              <tbody>
                {res.scalars.map(({ col, row }) => (
                  <tr key={col.oid} className="border-t border-line first:border-0 align-top">
                    <td className="py-1.5 pr-4 text-muted whitespace-nowrap w-28 @[36rem]:w-48">{col.label}</td>
                    <td className="py-1.5 break-words select-text">{formatCell(col, row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {t && (
            <div className="max-h-[460px] overflow-auto rounded-lg border border-line">
              <table className="w-full text-[12px] min-w-[480px]">
                <thead className="sticky top-0 bg-panel text-left text-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Índice</th>
                    {t.columns.map((c) => (
                      <th key={c.oid} className="px-2 font-medium whitespace-nowrap" title={`${oidName(c.oid)} ${c.oid}`}>
                        {c.label}
                      </th>
                    ))}
                    {res.rates && (
                      <>
                        <th className="px-2 font-medium whitespace-nowrap">Entrada</th>
                        <th className="px-2 font-medium whitespace-nowrap">Salida</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.slice(0, 2000).map((r) => (
                    <tr key={r.index} className="border-t border-line align-top">
                      <td className="px-2 py-1 font-mono text-muted">{r.index}</td>
                      {r.cells.map((c, i) => {
                        const v = formatCell(t.columns[i], c);
                        const tone = t.columns[i].fmt === "status" ? (v === "up" ? "text-ok" : v === "down" ? "text-danger" : "") : "";
                        return (
                          <td key={i} className={`px-2 break-words select-text ${tone}`}>
                            {v}
                          </td>
                        );
                      })}
                      {res.rates && (
                        <>
                          <td className="px-2 whitespace-nowrap tabular-nums">{res.rates[r.index]?.[0] != null ? fmtBits(res.rates[r.index][0]!) : "—"}</td>
                          <td className="px-2 whitespace-nowrap tabular-nums">{res.rates[r.index]?.[1] != null ? fmtBits(res.rates[r.index][1]!) : "—"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {t.rows.length === 0 && <p className="p-3 text-[12px] text-muted">El agente no devolvió filas para esta MIB.</p>}
            </div>
          )}
          {res.errors.length > 0 && (
            <ul className="mt-2 text-[11.5px] text-muted">
              {res.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------- Receptor de traps ----------

function TrapSection({
  settings: s,
  running,
  onChange,
  refreshRunning,
  target,
  profile,
}: {
  settings: Settings;
  running: string[];
  onChange: Props["onChange"];
  refreshRunning: () => void;
  target: TargetFn;
  profile: SnmpProfile;
}) {
  const [traps, setTraps] = useState<Trap[]>([]);
  const { ips, ip: mgmtIp } = useLocalIp();
  const [useV3, setUseV3] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const on = running.includes("snmptrap");
  const bind = s.snmpTrapBind || "127.0.0.1";

  useEffect(() => {
    const un = listen<Trap[]>("snmp-trap", ({ payload }) => setTraps((t) => [...payload.reverse(), ...t].slice(0, MAX_TRAPS)));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const toggle = async () => {
    setError("");
    try {
      if (on) await invoke("server_stop", { kind: "snmptrap" });
      else await invoke("snmp_trap_start", { port: s.snmpTrapPort, bind, v3: useV3 && profile.version === "3" ? target() : null });
    } catch (e) {
      setError(String(e));
    }
    refreshRunning();
  };

  const tone = { danger: "text-danger", ok: "text-ok", warn: "text-warn", muted: "text-fg" } as const;

  return (
    <Section
      title="Receptor de traps"
      hint="Apagado por defecto. Recibe traps v1/v2c, informs (los confirma) y traps v3 del usuario del perfil."
      right={<StatusPill state={on ? "running" : "stopped"} label={on ? `Activo · ${bind}:${s.snmpTrapPort}` : "Detenido"} />}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Label text="Escuchar en" className="w-full sm:w-64">
          <select className="field" disabled={on} value={bind} onChange={(e) => onChange({ snmpTrapBind: e.target.value })}>
            <option value="127.0.0.1">127.0.0.1 (solo este PC)</option>
            {ips.map((i) => (
              <option key={i.ip} value={i.ip}>
                {i.ip} · {i.name}
              </option>
            ))}
            <option value="0.0.0.0">0.0.0.0 (todas las interfaces)</option>
          </select>
        </Label>
        <Label text="Puerto" className="w-20 sm:w-24">
          <input className="field" type="number" disabled={on} value={s.snmpTrapPort} onChange={(e) => onChange({ snmpTrapPort: Number(e.target.value) || 162 })} />
        </Label>
        <div className="pb-1.5">
          <Toggle checked={useV3 && profile.version === "3"} onChange={setUseV3} label={`Verificar traps v3 de "${profile.user || "usuario del perfil"}"`} />
        </div>
        <Btn kind={on ? "default" : "primary"} className="ml-auto" onClick={toggle}>
          {on ? "Detener" : "Iniciar"}
        </Btn>
      </div>
      {bind === "127.0.0.1" && !on && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span>Con 127.0.0.1 solo llegan traps de este PC: los equipos de la red no pueden alcanzarlo.</span>
          {mgmtIp && (
            <Btn kind="ghost" className="!h-6 !px-2 !text-[11.5px] !text-accent" onClick={() => onChange({ snmpTrapBind: mgmtIp })}>
              Escuchar en {mgmtIp}
            </Btn>
          )}
        </div>
      )}
      {bind === "0.0.0.0" && !on && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-warn">
          <AlertTriangle size={13} /> Escuchará en todas las interfaces, incluidas Wi-Fi o VPN. Prefiere la IP de la red de gestión.
        </p>
      )}
      {s.snmpTrapPort < 1024 && (
        <p className="mt-2 text-[11.5px] text-muted">En Linux y macOS el puerto 162 puede requerir privilegios; si no inicia, usa 1162 y configúralo en el equipo.</p>
      )}
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[12px] text-muted">{traps.length} recibidos</span>
        <div className="flex gap-1">
          <Btn
            kind="ghost"
            disabled={!traps.length}
            onClick={() =>
              exportCsv(
                "traps.csv",
                ["hora,origen,version,trap,detalle", ...traps.map((t) => [new Date(t.ts).toISOString(), t.src, t.version, oidName(t.trap_oid) || t.trap_oid, t.vbs.map((v) => `${oidName(v.oid) || v.oid}=${v.value}`).join("; ")].map(csvCell).join(","))].join("\n"),
                setError,
              )
            }
          >
            <Download size={13} /> CSV
          </Btn>
          <Btn kind="ghost" onClick={() => setTraps([])}>
            Limpiar
          </Btn>
        </div>
      </div>
      <div className="mt-2 max-h-[420px] overflow-y-auto">
        {traps.length === 0 && <p className="text-[12px] text-muted">{on ? "Esperando traps…" : "Inicia el receptor para ver los traps de los equipos."}</p>}
        {traps.map((t, i) => {
          const sum = trapSummary(t);
          return (
            <div key={`${t.ts}-${i}`} className="border-t border-line first:border-0 py-1.5 text-[12px]">
              <button className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => setOpen(open === i ? null : i)}>
                <span className="text-muted whitespace-nowrap tabular-nums">{new Date(t.ts).toLocaleTimeString("es-CL")}</span>
                <span className="font-mono whitespace-nowrap">{t.src}</span>
                <span className="text-muted whitespace-nowrap">
                  {t.version}
                  {t.kind === "inform" ? " inform" : ""}
                </span>
                <span className={`font-medium whitespace-nowrap ${tone[sum.tone]}`}>{sum.title}</span>
                <span className="text-muted truncate w-full sm:w-auto">{sum.detail || t.note || ""}</span>
              </button>
              {open === i && (
                <div className="mt-1 ml-4 space-y-0.5 font-mono text-[11.5px] select-text">
                  {t.uptime && <div className="text-muted">sysUpTime {t.uptime}</div>}
                  {t.user && <div className="text-muted">usuario {t.user}</div>}
                  {t.note && <div className="text-muted">{t.note}</div>}
                  {t.vbs.map((v, k) => (
                    <div key={k} className="break-all">
                      <span className="text-muted">{oidName(v.oid) || v.oid}</span> = {v.value}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
