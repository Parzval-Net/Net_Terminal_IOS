import { memo, useMemo, useRef, useState } from "react";
import { BellOff, Pause, Pencil, Play, Plus, RotateCcw, Trash2, Volume2, VolumeX } from "lucide-react";
import { MonitorStatus, MonitorTarget, Sample, fmtDuration, stats } from "../../lib/monitors";
import { LineChart, StatTile } from "./LineChart";
import { Btn, Label, Section, StatusPill, Toggle, fmtMs } from "./ui";

interface Props {
  targets: MonitorTarget[];
  samples: Record<string, Sample[]>;
  status: Record<string, MonitorStatus>;
  onChange: (targets: MonitorTarget[]) => void;
  onClear: (id: string) => void;
  onSilence: (id: string) => void;
}

const WINDOWS: [string, number][] = [
  ["5 min", 5 * 60_000],
  ["15 min", 15 * 60_000],
  ["1 h", 60 * 60_000],
];

const timeLabel = (x: number) => new Date(x).toLocaleTimeString("es-CL");

const blank = (): MonitorTarget => ({
  id: `mon-${Date.now().toString(36)}`,
  name: "",
  kind: "icmp",
  host: "",
  intervalMs: 1000,
  timeoutMs: 1000,
  threshold: 3,
  sound: true,
  repeatSec: 30,
  active: true,
});

export function MonitorTool({ targets, samples, status, onChange, onClear, onSilence }: Props) {
  const [editing, setEditing] = useState<MonitorTarget | null>(null);
  const [win, setWin] = useState(WINDOWS[0][1]);

  const save = (t: MonitorTarget) => {
    const name = t.name.trim() || `${t.host}${t.kind === "tcp" ? `:${t.port}` : ""}`;
    const next = { ...t, name };
    onChange(targets.some((x) => x.id === t.id) ? targets.map((x) => (x.id === t.id ? next : x)) : [...targets, next]);
    setEditing(null);
  };
  const patch = (id: string, p: Partial<MonitorTarget>) => onChange(targets.map((t) => (t.id === id ? { ...t, ...p } : t)));

  // Acciones estables: cada muestra solo redibuja la tarjeta de su sonda.
  const latest = useRef({ targets, onChange, onClear, onSilence, patch });
  latest.current = { targets, onChange, onClear, onSilence, patch };
  const actions = useMemo<CardActions>(
    () => ({
      toggle: (t) => latest.current.patch(t.id, { active: !t.active }),
      sound: (t) => latest.current.patch(t.id, { sound: !t.sound }),
      edit: (t) => setEditing(t),
      clear: (id) => latest.current.onClear(id),
      silence: (id) => latest.current.onSilence(id),
      remove: (id) => latest.current.onChange(latest.current.targets.filter((x) => x.id !== id)),
    }),
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex-1 min-w-[200px] text-[12px] text-muted">
          Vigila que un equipo responda (ICMP) o que un acceso esté disponible (TCP: 22, 23, 443…). Suena una alarma al
          caer y otra al recuperarse, aunque estés en otra pestaña.
        </p>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex p-0.5 rounded-lg bg-hover">
            {WINDOWS.map(([label, ms]) => (
              <button
                key={label}
                onClick={() => setWin(ms)}
                className={`px-2.5 h-6 rounded-md text-[11.5px] ${win === ms ? "bg-panel shadow-sm" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Btn kind="primary" onClick={() => setEditing(blank())}>
            <Plus size={14} /> Nueva sonda
          </Btn>
        </div>
      </div>

      {editing && <MonitorForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}

      {targets.length === 0 && !editing && (
        <div className="rounded-xl border border-dashed border-line p-8 text-center text-[12.5px] text-muted">
          Agrega una sonda para monitorear un router, un enlace o un acceso SSH.
        </div>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr))]">
        {targets.map((t) => (
          <MonitorCard
            key={t.id}
            target={t}
            samples={samples[t.id] ?? []}
            status={status[t.id]}
            windowMs={win}
            actions={actions}
          />
        ))}
      </div>
    </div>
  );
}

interface CardActions {
  toggle: (t: MonitorTarget) => void;
  sound: (t: MonitorTarget) => void;
  edit: (t: MonitorTarget) => void;
  clear: (id: string) => void;
  silence: (id: string) => void;
  remove: (id: string) => void;
}

const MonitorCard = memo(function MonitorCard(p: {
  target: MonitorTarget;
  samples: Sample[];
  status?: MonitorStatus;
  windowMs: number;
  actions: CardActions;
}) {
  const { target: t, status, actions: a } = p;
  const visible = useMemo(() => {
    const cut = Date.now() - p.windowMs;
    return p.samples.filter((s) => s.ts >= cut);
  }, [p.samples, p.windowMs]);
  const st = useMemo(() => stats(visible), [visible]);
  const points = useMemo(() => visible.map((s) => ({ x: s.ts, y: s.ok ? s.rtt : null, note: s.error ?? undefined })), [visible]);
  const state = !t.active ? "stopped" : (status?.state ?? "unknown");
  const label =
    state === "stopped" ? "Pausada" : state === "up" ? "Arriba" : state === "down" ? "Caído" : "Esperando datos";
  const since = status && t.active && status.state !== "unknown" ? fmtDuration(Date.now() - status.since) : null;

  return (
    <Section
      title={t.name}
      hint={`${t.kind === "tcp" ? `TCP ${t.host}:${t.port}` : `ICMP ${t.host}`} · cada ${t.intervalMs / 1000} s`}
      right={
        <div className="flex items-center gap-1 shrink-0">
          <StatusPill state={state} label={since ? `${label} · ${since}` : label} />
          <Btn kind="ghost" className="!px-1.5" title={t.active ? "Pausar" : "Reanudar"} onClick={() => a.toggle(t)}>
            {t.active ? <Pause size={14} /> : <Play size={14} />}
          </Btn>
          <Btn kind="ghost" className="!px-1.5" title={t.sound ? "Silenciar sonda" : "Activar sonido"} onClick={() => a.sound(t)}>
            {t.sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </Btn>
          {state === "down" && t.sound && (
            <Btn kind="ghost" className="!px-1.5" title="Detener la alarma repetida" onClick={() => a.silence(t.id)}>
              <BellOff size={14} />
            </Btn>
          )}
          <Btn kind="ghost" className="!px-1.5" title="Editar" onClick={() => a.edit(t)}>
            <Pencil size={13} />
          </Btn>
          <Btn kind="ghost" className="!px-1.5" title="Reiniciar estadísticas" onClick={() => a.clear(t.id)}>
            <RotateCcw size={13} />
          </Btn>
          <Btn kind="ghost" className="!px-1.5 hover:!text-danger" title="Eliminar" onClick={() => a.remove(t.id)}>
            <Trash2 size={13} />
          </Btn>
        </div>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-3">
        <StatTile label="Actual" value={st.last?.ok ? fmtMs(st.last.rtt) : st.last ? "Sin resp." : "—"} tone={st.last && !st.last.ok ? "danger" : undefined} />
        <StatTile label="Promedio" value={fmtMs(st.avg)} />
        <StatTile label="Mín / máx" value={st.min == null ? "—" : `${st.min.toFixed(0)} / ${st.max!.toFixed(0)}`} />
        <StatTile label="Jitter" value={fmtMs(st.jitter)} />
        <StatTile
          label={`Pérdida (${st.lost}/${st.sent})`}
          value={`${st.loss.toFixed(1)} %`}
          tone={st.loss >= 5 ? "danger" : st.loss > 0 ? "warn" : st.sent ? "ok" : undefined}
        />
      </div>
      <LineChart
        title={`Latencia de ${t.name}`}
        unit="ms"
        height={140}
        points={points}
        xLabel={timeLabel}
      />
      {status?.state === "down" && status.lastError && (
        <p className="mt-2 text-[11.5px] text-danger">✕ {status.lastError}</p>
      )}
      {status && status.downCount > 0 && (
        <p className="mt-1 text-[11.5px] text-muted">Caídas desde que inició: {status.downCount}</p>
      )}
    </Section>
  );
});

function MonitorForm({ initial, onSave, onCancel }: { initial: MonitorTarget; onSave: (t: MonitorTarget) => void; onCancel: () => void }) {
  const [t, setT] = useState(initial);
  const set = <K extends keyof MonitorTarget>(k: K, v: MonitorTarget[K]) => setT((p) => ({ ...p, [k]: v }));
  const valid = t.host.trim() && (t.kind === "icmp" || (t.port && t.port > 0));
  return (
    <Section title={initial.name ? "Editar sonda" : "Nueva sonda"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(t);
        }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[1fr_1fr_110px_90px] gap-3">
          <Label text="Nombre">
            <input className="field" value={t.name} placeholder="Core SCL" onChange={(e) => set("name", e.target.value)} />
          </Label>
          <Label text="Host o IP">
            <input autoFocus className="field" value={t.host} placeholder="192.0.2.10" onChange={(e) => set("host", e.target.value.trim())} />
          </Label>
          <Label text="Tipo">
            <select className="field" value={t.kind} onChange={(e) => set("kind", e.target.value as MonitorTarget["kind"])}>
              <option value="icmp">ICMP (ping)</option>
              <option value="tcp">TCP (puerto)</option>
            </select>
          </Label>
          <Label text="Puerto">
            <input
              className="field"
              type="number"
              disabled={t.kind !== "tcp"}
              value={t.port ?? ""}
              placeholder="22"
              onChange={(e) => set("port", Number(e.target.value) || undefined)}
            />
          </Label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Label text="Intervalo">
            <select className="field" value={t.intervalMs} onChange={(e) => set("intervalMs", Number(e.target.value))}>
              {[500, 1000, 2000, 5000, 10000, 30000, 60000].map((v) => (
                <option key={v} value={v}>
                  {v < 1000 ? `${v} ms` : `${v / 1000} s`}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Timeout">
            <select className="field" value={t.timeoutMs} onChange={(e) => set("timeoutMs", Number(e.target.value))}>
              {[500, 1000, 2000, 3000, 5000].map((v) => (
                <option key={v} value={v}>
                  {v} ms
                </option>
              ))}
            </select>
          </Label>
          <Label text="Caído tras">
            <select className="field" value={t.threshold} onChange={(e) => set("threshold", Number(e.target.value))}>
              {[1, 2, 3, 5, 10].map((v) => (
                <option key={v} value={v}>
                  {v} {v === 1 ? "falla" : "fallas seguidas"}
                </option>
              ))}
            </select>
          </Label>
          <Label text="Repetir alarma">
            <select className="field" value={t.repeatSec} onChange={(e) => set("repeatSec", Number(e.target.value))}>
              <option value={0}>No repetir</option>
              {[10, 30, 60, 300].map((v) => (
                <option key={v} value={v}>
                  Cada {v < 60 ? `${v} s` : `${v / 60} min`}
                </option>
              ))}
            </select>
          </Label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Toggle checked={t.sound} onChange={(v) => set("sound", v)} label="Alarma sonora" />
          <div className="flex items-center gap-2">
            <Btn type="button" onClick={onCancel}>
              Cancelar
            </Btn>
            <Btn type="submit" kind="primary" disabled={!valid}>
              Guardar e iniciar
            </Btn>
          </div>
        </div>
      </form>
    </Section>
  );
}
