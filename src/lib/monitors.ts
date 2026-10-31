import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { alarmDown, alarmUp } from "./sound";

export interface MonitorTarget {
  id: string;
  name: string;
  kind: "icmp" | "tcp";
  host: string;
  port?: number;
  intervalMs: number;
  timeoutMs: number;
  /** Fallas consecutivas para declarar caída. */
  threshold: number;
  sound: boolean;
  /** Repetir la alarma mientras siga caído (segundos, 0 = no repetir). */
  repeatSec: number;
  active: boolean;
}

export interface Sample {
  ts: number;
  ok: boolean;
  rtt: number | null;
  error?: string | null;
}

export type MonitorState = "unknown" | "up" | "down";

export interface MonitorStatus {
  state: MonitorState;
  since: number;
  failStreak: number;
  lastError?: string | null;
  downCount: number;
}

const MAX_SAMPLES = 3600;

export function stats(samples: Sample[]) {
  const ok = samples.filter((s) => s.ok && s.rtt != null).map((s) => s.rtt as number);
  const lost = samples.length - samples.filter((s) => s.ok).length;
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
  const jitter =
    ok.length > 1 ? ok.slice(1).reduce((acc, v, i) => acc + Math.abs(v - ok[i]), 0) / (ok.length - 1) : null;
  return {
    sent: samples.length,
    lost,
    loss: samples.length ? (lost / samples.length) * 100 : 0,
    min: ok.length ? Math.min(...ok) : null,
    max: ok.length ? Math.max(...ok) : null,
    avg,
    jitter,
    last: samples.at(-1) ?? null,
  };
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * Estado global de sondas: vive en App para que las alarmas suenen aunque la pestaña
 * de herramientas no esté visible.
 */
export function useMonitors(
  targets: MonitorTarget[],
  notify: (text: string, kind: "info" | "error") => void,
) {
  const [samples, setSamples] = useState<Record<string, Sample[]>>({});
  const [status, setStatus] = useState<Record<string, MonitorStatus>>({});
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const statusRef = useRef(status);
  statusRef.current = status;
  const repeatTimers = useRef<Record<string, number>>({});

  const clearRepeat = (id: string) => {
    window.clearInterval(repeatTimers.current[id]);
    delete repeatTimers.current[id];
  };

  // Arranca/detiene en el backend según el estado "active".
  const signature = targets
    .map((t) => [t.id, t.active, t.kind, t.host, t.port, t.intervalMs, t.timeoutMs].join("|"))
    .join(";");
  useEffect(() => {
    for (const t of targets) {
      if (t.active) {
        invoke("monitor_start", {
          cfg: { id: t.id, kind: t.kind, host: t.host, port: t.port, interval_ms: t.intervalMs, timeout_ms: t.timeoutMs },
        }).catch((e) => notify(`${t.name}: ${e}`, "error"));
      } else {
        invoke("monitor_stop", { id: t.id }).catch(() => {});
        clearRepeat(t.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    const un = listen<Sample & { id: string }>("monitor-sample", ({ payload }) => {
      const { id, ...sample } = payload;
      setSamples((all) => {
        const list = all[id] ?? [];
        const next = list.length >= MAX_SAMPLES ? [...list.slice(-MAX_SAMPLES + 1), sample] : [...list, sample];
        return { ...all, [id]: next };
      });

      const t = targetsRef.current.find((x) => x.id === id);
      const prev = statusRef.current[id] ?? { state: "unknown", since: sample.ts, failStreak: 0, downCount: 0 };
      const failStreak = sample.ok ? 0 : prev.failStreak + 1;
      let state: MonitorState = prev.state;
      if (sample.ok) state = "up";
      else if (failStreak >= (t?.threshold ?? 3)) state = "down";
      const changed = state !== prev.state;
      const next: MonitorStatus = {
        state,
        since: changed ? sample.ts : prev.since,
        failStreak,
        lastError: sample.error,
        downCount: prev.downCount + (changed && state === "down" ? 1 : 0),
      };
      statusRef.current = { ...statusRef.current, [id]: next };
      setStatus(statusRef.current);

      if (changed && t && prev.state !== "unknown") {
        if (state === "down") {
          notify(`${t.name} CAÍDO: ${sample.error ?? "sin respuesta"}`, "error");
          if (t.sound) {
            alarmDown();
            if (t.repeatSec > 0) {
              clearRepeat(id);
              repeatTimers.current[id] = window.setInterval(alarmDown, t.repeatSec * 1000);
            }
          }
        } else if (state === "up") {
          clearRepeat(id);
          notify(`${t.name} recuperado tras ${fmtDuration(sample.ts - prev.since)}`, "info");
          if (t.sound) alarmUp();
        }
      } else if (changed && t && prev.state === "unknown" && state === "down") {
        notify(`${t.name} no responde`, "error");
        if (t.sound) alarmDown();
      }
    });
    return () => {
      un.then((f) => f());
      Object.keys(repeatTimers.current).forEach(clearRepeat);
    };
  }, [notify]);

  const clear = useCallback((id: string) => {
    setSamples((s) => ({ ...s, [id]: [] }));
    setStatus((s) => {
      const { [id]: _drop, ...rest } = s;
      statusRef.current = rest;
      return rest;
    });
    clearRepeat(id);
  }, []);

  const silence = useCallback((id: string) => clearRepeat(id), []);

  const downCount = Object.entries(status).filter(
    ([id, s]) => s.state === "down" && targets.some((t) => t.id === id && t.active),
  ).length;

  // Mismo objeto mientras no lleguen muestras: las vistas memorizadas no se redibujan.
  return useMemo(() => ({ samples, status, clear, silence, downCount }), [samples, status, clear, silence, downCount]);
}
