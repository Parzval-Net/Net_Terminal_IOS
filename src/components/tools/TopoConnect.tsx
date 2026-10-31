import { useEffect, useState } from "react";
import { ChevronDown, KeyRound, Radar, SquareTerminal, TriangleAlert, X } from "lucide-react";
import type { HopWaiting, OpenChoice, OpenPlan } from "../../lib/hopTab";
import { hopCredKey } from "../../lib/hopCred";
import { CredStatus, needsUnlock } from "../../lib/credentials";
import type { TopoNode } from "../../lib/topology";
import { VaultUnlock } from "../VaultUnlock";
import { Btn } from "./ui";

/** Lo que Topología muestra de un salto: avance, lo que espera y el motivo si falló. */
export interface HopView {
  tabId: string;
  target: string;
  route: string[];
  step: number;
  total: number;
  waiting: HopWaiting | "opening";
  status: "running" | "done" | "failed";
  text: string;
  /** Hora en que deja de mostrarse (solo los terminados). */
  until?: number;
}

export interface CredAlert {
  tabId: string;
  to: string;
  ip: string;
  user: string;
  source: "saved" | "pivot";
}
export interface SaveOffer {
  to: string;
  ip: string;
  user: string;
  update?: boolean;
}

const WAITING: Record<HopView["waiting"], string> = {
  opening: "conectando con el pivote",
  prompt: "esperando el prompt",
  reply: "esperando la respuesta del equipo",
  password: "pide la contraseña",
  username: "pide el usuario",
  hostkey: "pide confirmar la llave",
  done: "conectado",
  failed: "falló",
};

/** Qué pide el equipo al usuario, para el botón "Ir a la pestaña". */
const GO: Partial<Record<HopView["waiting"], string>> = {
  password: "Ir a la pestaña para escribir la contraseña",
  username: "Ir a la pestaña para escribir el usuario",
  hostkey: "Ir a la pestaña para confirmar la llave",
};

/**
 * Avance de los saltos (la pestaña se abre en segundo plano: Topología sigue a la vista), avisos de
 * contraseñas rechazadas y la oferta de guardar las que tecleó el usuario. Nunca cambia de vista solo:
 * ir a la pestaña es siempre un botón.
 */
export function HopCards({
  views,
  alerts,
  offers,
  onView,
  onDiscover,
  onDismiss,
  onUpdate,
  onAlertDone,
  onOffer,
  onOfferDone,
}: {
  views: HopView[];
  alerts: CredAlert[];
  offers: SaveOffer[];
  onView: (tabId: string) => void;
  /** Descubre los vecinos del equipo alcanzado con su pestaña. */
  onDiscover: (tabId: string) => void;
  onDismiss: (tabId: string) => void;
  onUpdate: (a: CredAlert) => void;
  onAlertDone: (a: CredAlert) => void;
  onOffer: (o: SaveOffer) => void;
  onOfferDone: (o: SaveOffer) => void;
}) {
  if (!views.length && !alerts.length && !offers.length) return null;
  return (
    <div className="mt-2 space-y-1.5" aria-live="polite">
      {views.map((v) => {
        const via = v.route.slice(0, -1).join(" › ");
        const go = v.status === "running" ? GO[v.waiting] : undefined;
        return (
          <div
            key={v.tabId}
            className={`rounded-md border px-2.5 py-1.5 text-[12px] flex flex-wrap items-center gap-x-2.5 gap-y-1 ${v.status === "failed" ? "border-danger" : "border-line"}`}
          >
            <span className="font-medium">{v.target}</span>
            {via && <span className="text-muted">vía {via}</span>}
            <span className={v.status === "done" ? "text-ok" : v.status === "failed" ? "text-danger" : "text-muted"}>
              {v.status === "running" ? `Paso ${Math.min(v.step, v.total)} de ${v.total}: ${WAITING[v.waiting]}` : v.status === "done" ? "Conectado" : "No se pudo llegar"}
            </span>
            {v.text && v.status !== "done" && <span className={`min-w-0 basis-full text-[11.5px] ${v.status === "failed" ? "text-danger" : "text-muted"}`}>{v.text}</span>}
            <span className="ml-auto flex items-center gap-1">
              {v.status === "done" && (
                <Btn kind="primary" className="!h-6 !px-2 !text-[11.5px]" onClick={() => onDiscover(v.tabId)} title={`Lee los vecinos de ${v.target} con su pestaña y los agrega al diagrama (comandos de consulta)`}>
                  <Radar size={12} /> Descubrir vecinos
                </Btn>
              )}
              {go ? (
                <Btn kind="primary" className="!h-6 !px-2 !text-[11.5px]" onClick={() => onView(v.tabId)}>
                  <KeyRound size={12} /> {go}
                </Btn>
              ) : (
                <Btn className="!h-6 !px-2 !text-[11.5px]" onClick={() => onView(v.tabId)} title="Ir a la pestaña de este salto">
                  <SquareTerminal size={12} /> Ver terminal
                </Btn>
              )}
              {v.status !== "running" && (
                <Btn kind="ghost" className="!h-6 !px-1" title="Quitar este aviso" aria-label="Quitar este aviso" onClick={() => onDismiss(v.tabId)}>
                  <X size={12} />
                </Btn>
              )}
            </span>
          </div>
        );
      })}
      {alerts.map((a) => (
        <div key={`${a.tabId}|${a.ip}`} className="rounded-md border border-warn px-2.5 py-1.5 text-[12px] flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <TriangleAlert size={13} className="text-warn shrink-0" aria-hidden />
          <span className="min-w-0">
            {a.source === "saved" ? `La contraseña guardada de ${a.to}` : `La contraseña del pivote en ${a.to}`} ({a.user ? `${a.user}@` : ""}
            {a.ip}) fue rechazada. No se reintenta.
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Btn className="!h-6 !px-2 !text-[11.5px]" onClick={() => onView(a.tabId)}>
              Escribirla en la pestaña
            </Btn>
            {a.source === "saved" && a.user && (
              <Btn className="!h-6 !px-2 !text-[11.5px]" onClick={() => onUpdate(a)}>
                Actualizar contraseña guardada
              </Btn>
            )}
            <Btn kind="ghost" className="!h-6 !px-1" title="Descartar" aria-label="Descartar" onClick={() => onAlertDone(a)}>
              <X size={12} />
            </Btn>
          </span>
        </div>
      ))}
      {offers.map((o) => (
        <div key={`${o.ip}|${o.user}`} className="rounded-md border border-line px-2.5 py-1.5 text-[12px] flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <KeyRound size={13} className="text-accent shrink-0" aria-hidden />
          <span className="min-w-0">
            {o.update ? "¿Actualizar" : "¿Guardar"} la contraseña de {o.to} ({o.user}@{o.ip}) en la bóveda?
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Btn className="!h-6 !px-2 !text-[11.5px]" onClick={() => onOffer(o)}>
              {o.update ? "Actualizar…" : "Guardar…"}
            </Btn>
            <Btn kind="ghost" className="!h-6 !px-2 !text-[11.5px]" onClick={() => onOfferDone(o)}>
              No
            </Btn>
          </span>
        </div>
      ))}
    </div>
  );
}

const DOT: Record<"connected" | "down" | "none", { cls: string; label: string }> = {
  connected: { cls: "text-ok", label: "conectado" },
  down: { cls: "text-danger", label: "caído" },
  none: { cls: "text-muted", label: "sin pestaña" },
};

/** Texto de apoyo bajo el botón: qué hará "Abrir terminal" en este equipo. */
function primaryNote(plan: OpenPlan): string {
  const c = plan.primary;
  if (!c) return plan.reason ?? "No hay forma de abrir una terminal en este equipo.";
  if (c.kind === "focus") return "Ya hay una pestaña en este equipo: se abre esa.";
  if (c.kind === "direct") return `Se conecta directo desde este PC${c.detail ? ` (${c.detail})` : ""} y te lleva a su pestaña para autenticarte.`;
  return "Abre una pestaña nueva en segundo plano y salta por la ruta; tú sigues en Topología.";
}

/**
 * Conectar con el equipo seleccionado: un solo botón "Abrir terminal" que hace lo correcto (enfocar la
 * pestaña, conectar directo o abrir por la ruta), un menú con las alternativas explícitas y la ruta
 * como migas de pan: cada equipo con pestaña abierta se enfoca con un clic, con su estado al lado.
 */
export function ConnectPanel({
  n,
  getPlan,
  crumb,
  onRun,
  onFocus,
  onDiscover,
  canDiscover,
  onMenu,
  hopping,
  proto,
  onProto,
  hopUser,
  onHopUser,
  userHint,
  askUser,
  savedHops,
  vault,
  onUnlocked,
  usePivotCred,
  onUsePivotCred,
  skipSaved,
  onSkipSaved,
}: {
  n: TopoNode;
  getPlan: (n: TopoNode) => OpenPlan;
  crumb: (name: string) => { state: "connected" | "down" | "none"; tabId?: string };
  onRun: (c: OpenChoice, n: TopoNode) => void;
  onFocus: (tabId: string) => void;
  /** Descubrir los vecinos del equipo con la pestaña que está en él. */
  onDiscover: (tabId: string) => void;
  canDiscover: boolean;
  onMenu: (e: React.MouseEvent<HTMLButtonElement>, n: TopoNode) => void;
  hopping: boolean;
  proto: "ssh" | "telnet";
  onProto: (p: "ssh" | "telnet") => void;
  hopUser: string;
  onHopUser: (u: string) => void;
  userHint: string;
  /** El comando de salto lleva usuario (SSH y no Huawei). */
  askUser: boolean;
  savedHops: Set<string>;
  vault: CredStatus | null;
  onUnlocked: () => void;
  usePivotCred: boolean;
  onUsePivotCred: (v: boolean) => void;
  skipSaved: boolean;
  onSkipSaved: (v: boolean) => void;
}) {
  // Las pestañas cambian sin que cambie el equipo seleccionado: se relee cada 2 s (solo este bloque).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 2000);
    return () => window.clearInterval(t);
  }, []);
  const plan = getPlan(n);
  const hopChoice = [plan.primary, ...plan.alternatives].find((c) => c?.kind === "route" || c?.kind === "inplace");
  const route = hopChoice?.route;
  const savedOf = route ? route.steps.filter((s) => s.user && savedHops.has(hopCredKey(s.ip, s.user))) : [];
  const pivotOk = route?.session.save_password === true && !!route.session.id;
  const locked = needsUnlock(vault);

  return (
    <div className="space-y-1.5 pt-1.5 border-t border-line">
      {plan.names.length > 0 && (
        <nav aria-label="Ruta hasta el equipo" className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11.5px]">
          {plan.names.map((name, i) => {
            const c = crumb(name);
            const d = DOT[c.state];
            const body = (
              <>
                <span className={d.cls} aria-hidden>
                  {c.state === "none" ? "○" : "●"}
                </span>
                <span className="sr-only">({d.label}) </span>
                {name}
              </>
            );
            return (
              <span key={`${name}${i}`} className="inline-flex items-center gap-1">
                {i > 0 && (
                  <span className="text-muted" aria-hidden>
                    ›
                  </span>
                )}
                {c.state === "connected" && c.tabId ? (
                  <button type="button" className="inline-flex items-center gap-1 rounded px-1 hover:bg-hover font-medium" title={`Ver la terminal de ${name}`} onClick={() => onFocus(c.tabId!)}>
                    {body}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1 text-muted" title={c.state === "down" ? "La pestaña de este equipo se cerró o cayó" : "Sin pestaña abierta en este equipo"}>
                    {body}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      )}
      <div className="flex">
        <Btn
          kind="primary"
          className="flex-1 !rounded-r-none"
          disabled={!plan.primary || hopping}
          title={plan.primary?.detail ?? plan.reason}
          onClick={() => plan.primary && onRun(plan.primary, n)}
        >
          <SquareTerminal size={13} aria-hidden /> {hopping ? "Saltando…" : "Abrir terminal"}
        </Btn>
        <Btn
          kind="primary"
          className="!px-1.5 !rounded-l-none border-l border-accent-fg/30"
          aria-haspopup="menu"
          aria-label="Más formas de abrir este equipo"
          title="Más formas: conectar directo, abrir vía otro equipo, saltar en una pestaña, reconectar"
          onClick={(e) => onMenu(e, n)}
        >
          <ChevronDown size={13} aria-hidden />
        </Btn>
      </div>
      <p className="text-[11.5px] text-muted leading-snug">{primaryNote(plan)}</p>
      {plan.notice && plan.primary && <p className="text-[11.5px] text-warn leading-snug">{plan.notice}</p>}
      {canDiscover && plan.primary?.kind === "focus" && plan.primary.tabId && (
        <Btn className="w-full" onClick={() => onDiscover(plan.primary!.tabId!)} title="Lee los vecinos (CDP/LLDP, ruteo y las fuentes activas) con la pestaña de este equipo y los agrega al diagrama. Solo comandos de consulta.">
          <Radar size={13} aria-hidden /> Descubrir vecinos de {n.name}
        </Btn>
      )}
      {route && (
        <div className="space-y-1 text-[11.5px]">
          {savedOf.length > 0 && (
            <p className={skipSaved ? "text-muted line-through" : "text-accent"}>
              Se usará la contraseña guardada de {savedOf.map((s) => `${s.name} (${s.user})`).join(", ")}.
            </p>
          )}
          {savedOf.length > 0 && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" className="accent-[var(--accent)]" checked={skipSaved} onChange={(e) => onSkipSaved(e.target.checked)} />
              No usar las guardadas en este salto
            </label>
          )}
          {pivotOk && (
            <label className="flex items-start gap-1.5" title="Se escribe sola una vez en cada equipo de la ruta, solo si pide Password: y no hay una guardada para ese equipo. Si lo rechaza no se reintenta.">
              <input type="checkbox" className="accent-[var(--accent)] mt-0.5" checked={usePivotCred} onChange={(e) => onUsePivotCred(e.target.checked)} />
              <span>
                Usar la credencial del pivote ({route.origin}) en esta ruta
                <span className="block text-muted">Un intento por equipo; solo en este salto.</span>
              </span>
            </label>
          )}
          {locked && (
            <div className="space-y-1">
              <p className="text-warn">La bóveda está bloqueada: sin desbloquearla no se escribe ninguna contraseña guardada.</p>
              <VaultUnlock onUnlocked={onUnlocked} />
            </div>
          )}
        </div>
      )}
      <details className="text-[11.5px]">
        <summary className="cursor-pointer text-muted">Opciones de conexión</summary>
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-muted">Protocolo</span>
            <select className="field !h-7 !text-[12px] !w-auto" aria-label="Protocolo de conexión" value={proto} onChange={(e) => onProto(e.target.value as "ssh" | "telnet")}>
              <option value="ssh">SSH</option>
              <option value="telnet">Telnet (sin cifrar)</option>
            </select>
            {proto === "ssh" && askUser && (
              <input className="field !h-7 !text-[12px]" placeholder={`Usuario${userHint ? ` (${userHint})` : ""}`} aria-label="Usuario para el salto" value={hopUser} onChange={(e) => onHopUser(e.target.value)} />
            )}
          </div>
          {proto === "telnet" && <p className="text-warn">Telnet no cifra: usuario y contraseña viajan en claro. Úsalo solo si el equipo no tiene SSH.</p>}
        </div>
      </details>
    </div>
  );
}
