/**
 * Saltos entre vecinos en pestañas propias. "Abrir terminal" en un equipo que solo se alcanza por
 * otro abre una pestaña nueva que reproduce la ruta completa: conecta la sesión del pivote, espera
 * su prompt, salta al primer vecino, espera su prompt, y así hasta el destino. Las pestañas que ya
 * estaban en cada equipo de la ruta no se tocan: Topología lee el tráfico de cada equipo por su
 * propia pestaña. Lógica pura (sin DOM ni backend) para poder probarla: el estado se avanza con
 * `stepHop` a partir de lo que muestra la pantalla de la pestaña.
 *
 * Nunca se envía a ciegas: con el prompt sin aparecer (login, contraseña, banner, "--More--") el
 * comando llegaría a medias al equipo ("how interfaces" por un carácter perdido). Las preguntas del
 * salto (llave del equipo, usuario, contraseña) las contesta el usuario, salvo la contraseña cuando
 * él lo pidió: la guardada del vecino (bóveda) o la del pivote, que escribe el backend sin que
 * pase por JS, una sola vez por paso, y nunca se reintenta si el equipo la rechaza.
 */
import { promptName } from "./cliText";
import { isIpv4, isIpv6, nodeId } from "./topology";
import type { TopoNode, TopoVendor } from "./topology";
import type { Session } from "../types";

/** Cuánto se espera el prompt del equipo de partida de un paso (el usuario puede estar escribiendo su contraseña). */
export const PROMPT_WAIT_MS = 120_000;
/** Con el salto enviado: sin cambios en pantalla y sin pregunta pendiente, el equipo no responde. */
export const HOP_IDLE_MS = 45_000;
/** Tope de espera de una pregunta que contesta el usuario (contraseña, llave). */
export const USER_WAIT_MS = 600_000;
/** Tope absoluto de todo el salto encadenado, sume lo que sume cada paso. */
export const HOP_TOTAL_MS = 1_800_000;
/** El prompt debe llevar este tiempo sin cambios antes de enviar: el banner o un redibujo no cuentan. */
export const PROMPT_STABLE_MS = 600;
/** Tras un error reconocido, la pantalla debe quedar quieta este tiempo para darlo por definitivo. */
export const ERROR_SETTLE_MS = 1_500;
/** El pedido de contraseña debe llevar este tiempo quieto antes de escribir la credencial guardada. */
export const FILL_SETTLE_MS = 400;
/** Tope de saltos de una ruta (el pivote no cuenta: pivote + hasta 8 saltos). Pasado el tope se avisa, no se calla. */
export const MAX_ROUTE_STEPS = 8;

/** Sesión de la pestaña de salto: la misma del pivote, sin reconectar sola ni repetir comandos de inicio. */
export function hopTabSession(base: Session, title: string): Session {
  return {
    ...base,
    name: title,
    // Una reconexión volvería al pivote y perdería el salto; los comandos de inicio compiten con el envío.
    auto_reconnect: false,
    on_connect: undefined,
    scp: undefined,
    tunnels: undefined,
  };
}

/** Título de la pestaña de salto: "vecino vía equipo anterior". */
export const hopTabTitle = (neighbor: string, pivot: string) => `${neighbor} vía ${pivot}`.slice(0, 80);

/** Solo SSH y Telnet se pueden repetir en otra pestaña (un puerto serial o un shell local no). */
export const isReplayable = (s: Pick<Session, "type">) => s.type === "ssh" || s.type === "telnet";

export type HopScreen =
  | { kind: "prompt"; name: string }
  | { kind: "hostkey"; line: string; answer: "yes" | "y" }
  | { kind: "password"; line: string }
  | { kind: "username"; line: string }
  | { kind: "none" };

const HOSTKEY =
  /are you sure you want to continue connecting|\(yes\/no(?:\/\[fingerprint\])?\)\s*\??\s*$|continue to access it\?\s*\[y\/n\]|save the server's public key\?\s*\[y\/n\]|accept (?:the )?(?:host )?key/i;
const PASSWORD = /(?:password|passphrase|contraseña)(?: for [^:\n]*)?\s*:\s*$/i;
const USERNAME = /(?:username|user name|login(?: as)?|usuario)\s*:\s*$/i;
/** La contraseña que se escribió fue rechazada (no cuenta "Password:" a secas: eso lo ve el conteo de pedidos). */
const AUTH_REJECTED = /permission denied|authentication (?:failed|failure)|access denied|login (?:invalid|incorrect)|bad (?:passwords|secrets)|too many authentication/i;

/** Última línea con texto, sin espacios al final. */
export function lastLine(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trimEnd();
    if (l.trim()) return l.slice(-200);
  }
  return "";
}

/** Qué hay al final de la pantalla: un prompt de equipo, una pregunta que contesta el usuario o nada reconocible. */
export function classifyHopScreen(text: string): HopScreen {
  const line = lastLine(text);
  if (!line) return { kind: "none" };
  if (HOSTKEY.test(line)) return { kind: "hostkey", line: line.trim(), answer: /\[y\/n\]/i.test(line) ? "y" : "yes" };
  if (PASSWORD.test(line)) return { kind: "password", line: line.trim() };
  if (USERNAME.test(line)) return { kind: "username", line: line.trim() };
  const name = promptName(line);
  return name ? { kind: "prompt", name } : { kind: "none" };
}

/** Cuántos pedidos de contraseña hay en el texto (uno por línea): un pedido nuevo tras escribirla es un rechazo. */
export function passwordPrompts(text: string): number {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => PASSWORD.test(l.trimEnd())).length;
}

/** El equipo dijo que rechazó la credencial ("Permission denied", "% Authentication failed", "% Login invalid"). */
export const authRejected = (text: string) => AUTH_REJECTED.test(text);

/** El texto que sigue al eco del último `cmd` (lo que respondió el equipo); sin eco, todo el texto. */
export function afterEcho(text: string, cmd: string): string {
  const at = cmd ? text.lastIndexOf(cmd) : -1;
  if (at < 0) return text;
  const nl = text.indexOf("\n", at);
  return nl < 0 ? "" : text.slice(nl + 1);
}

const ERRORS: [RegExp, string][] = [
  [/connection refused/i, "conexión rechazada (¿SSH o Telnet apagado, puerto distinto o ACL?)"],
  [/connection timed out|timed out|no response from|not responding/i, "tiempo de espera agotado (sin respuesta del equipo)"],
  [/no route to host|network is unreachable|host is unreachable|destination (?:host )?unreachable/i, "sin ruta hacia el equipo"],
  [/unknown host|could not resolve|name or service not known|unrecognized host/i, "equipo desconocido"],
  [/host key verification failed|remote host identification has changed/i, "la llave del equipo no coincide"],
  [/authentication (?:failed|failure)|permission denied|access denied|login invalid|bad (?:passwords|secrets)|too many authentication/i, "autenticación rechazada"],
  [/unable to negotiate|no matching (?:key|host key|cipher|mac|kex)|ssh version mismatch|protocol (?:major )?version|failed to connect|unable to connect/i, "no se pudo negociar SSH con el equipo"],
  [/connection (?:closed by|reset by)|closed by foreign host/i, "el equipo cerró la conexión"],
  [/% ?invalid (?:input|command)|% ?unrecognized command|error: ?unrecognized command|% ?incomplete command/i, "el equipo no reconoce el comando de salto"],
];

/** Motivo de fallo reconocido en la respuesta del equipo (con la línea que lo dijo), o null. */
export function hopError(text: string): string | null {
  for (const [re, why] of ERRORS) {
    const m = text.match(re);
    if (m) {
      const line = text.split("\n").find((l) => re.test(l))?.replace(/\r/g, "").trim().slice(0, 120);
      return line ? `${why}: ${line}` : why;
    }
  }
  return null;
}

// ---------- Ruta de una pestaña ----------

/** Un salto de la ruta: el equipo al que se llega, su IP y el comando (hopCommand) con que se llegó. */
export interface RouteStep {
  name: string;
  ip: string;
  cmd: string;
  /** Usuario del comando (vacío en Telnet y Huawei, que lo piden en el equipo). */
  user?: string;
  /**
   * Nombre que mostró el prompt del equipo cuando difiere del del diagrama (dominio, guion bajo en lugar
   * de guion, otro hostname que el CDP): `name` sigue siendo el del diagrama para que la ruta, la pestaña
   * y los vecinos descubiertos apunten al mismo equipo.
   */
  prompt?: string;
}

/**
 * Ruta de una pestaña: la sesión del pivote (la que se reconecta) y los saltos desde él. La pestaña
 * está en el último equipo; sin saltos, en el pivote.
 */
export interface TabRoute {
  origin: string;
  session: Session;
  steps: RouteStep[];
}

export const routeNames = (r: TabRoute): string[] => [r.origin, ...r.steps.map((s) => s.name)];
/** Lo que mostraría el prompt de cada equipo de la ruta (su alias si el prompt no coincide con el diagrama). */
export const routePrompts = (r: TabRoute): string[] => [r.origin, ...r.steps.map((s) => s.prompt ?? s.name)];
export const routeHere = (r: TabRoute): string => (r.steps.length ? r.steps[r.steps.length - 1].name : r.origin);
/** "pivote › h1 › … › N". */
export const routeTooltip = (r: TabRoute): string => routeNames(r).join(" › ");
/** Título de la pestaña: "N vía M" (solo el pivote, su propio nombre). */
export const routeTitle = (r: TabRoute): string => {
  const names = routeNames(r);
  return names.length > 1 ? hopTabTitle(names[names.length - 1], names[names.length - 2]) : names[0];
};
export const extendRoute = (r: TabRoute, step: RouteStep): TabRoute => ({ ...r, steps: [...r.steps, step] });
/** La ruta hasta el equipo `idx` (0 = el pivote). */
export const truncateRoute = (r: TabRoute, idx: number): TabRoute => (idx >= r.steps.length ? r : { ...r, steps: r.steps.slice(0, Math.max(0, idx)) });

/** Mismo equipo por nombre: sin dominio ni mayúsculas, y con guion bajo y guion como lo mismo (un hostname "acc_sw01" y su CDP "acc-sw01"). */
const looseId = (n: string) => nodeId(n).replace(/[_\s]+/g, "-");
export const samePrompt = (a: string, b: string) => looseId(a) === looseId(b);

/**
 * En qué equipo de la ruta está la pestaña según su pantalla: el índice (0 = pivote), `-1` si el
 * prompt es de un equipo que no está en la ruta (la pestaña cambió de equipo) o `null` si la pantalla
 * no muestra un prompt (login, paginador, comando en curso): no se puede verificar.
 */
export function routePosition(r: TabRoute, screen: string): number | null {
  const s = classifyHopScreen(screen);
  if (s.kind !== "prompt") return null;
  const shown = routePrompts(r);
  const names = routeNames(r);
  for (let i = shown.length - 1; i >= 0; i--) if (samePrompt(s.name, shown[i]) || samePrompt(s.name, names[i])) return i;
  return -1;
}

/** La ruta ajustada a lo que dice el prompt: un "exit" tecleado a mano la acorta. Misma referencia si no cambia. */
export function reconcileRoute(r: TabRoute, screen: string): TabRoute {
  const at = routePosition(r, screen);
  return at !== null && at >= 0 && at < r.steps.length ? truncateRoute(r, at) : r;
}

/**
 * Equipo donde está una pestaña: el de su ruta que muestra el prompt (verificado), o el último de la
 * ruta si no hay prompt a la vista (no verificado). `null`: el prompt es de otro equipo que la ruta no
 * conoce, así que no se sabe dónde está. Sin ruta, el prompt o, a falta de él, el nombre de la pestaña.
 */
export function tabDevice(t: { name: string; screen?: (n: number) => string }, route?: TabRoute): { name: string; verified: boolean; index: number } | null {
  const screen = t.screen?.(8);
  const s = screen === undefined ? undefined : classifyHopScreen(screen);
  const prompt = s?.kind === "prompt" ? s.name : undefined;
  if (route) {
    const names = routeNames(route);
    const at = screen === undefined ? null : routePosition(route, screen);
    if (at === -1) return null;
    const i = at ?? names.length - 1;
    return { name: names[i], verified: at !== null, index: i };
  }
  return prompt ? { name: prompt, verified: true, index: 0 } : { name: t.name, verified: false, index: 0 };
}

// ---------- Salto encadenado ----------

export type HopPhase = "await-prompt" | "sent" | "done" | "failed";
/** Credencial que escribe el backend en el "Password:" de un paso: la guardada del vecino o la del pivote. */
export type HopCredSource = "saved" | "pivot";
export type CredState = "idle" | "asking" | "typed" | "failed" | "rejected";

/** Un paso del salto: el comando, el equipo al que se llega y, si corresponde, la credencial a escribir. */
export interface HopStep {
  cmd: string;
  /** Nombre esperado del prompt del equipo al que se llega. */
  to: string;
  ip?: string;
  user?: string;
  cred?: HopCredSource;
}

/** Contraseña que escribió el usuario en un paso (candidata a guardarse en la bóveda). */
export interface ManualPassword {
  to: string;
  ip: string;
  user: string;
}

export interface HopJob {
  /** Fase del paso actual. */
  phase: HopPhase;
  steps: HopStep[];
  /** Paso actual (índice en `steps`). */
  index: number;
  /** Comando del paso actual (reflejo de steps[index]). */
  cmd: string;
  /** Equipo al que lleva el paso actual. */
  neighbor: string;
  /** Prompt esperado del equipo desde el que se salta en el paso actual; sin él se acepta el primero que aparezca. */
  pivot?: string;
  startedAt: number;
  /** Inicio del paso actual (el plazo del prompt se cuenta desde aquí). */
  stepStartedAt: number;
  sentAt?: number;
  /** Pie de la pantalla en la última lectura y desde cuándo no cambia. */
  tail: string;
  changedAt: number;
  /** Avisos ya dados en el paso (una vez cada uno): password, username, hostkey:<línea>, mismatch. */
  told: string[];
  /** Estado de la credencial del paso actual. */
  cred: CredState;
  /** Cuántos pedidos de contraseña había al escribirla: uno más es un rechazo. */
  credBase: number;
  /** Pasos (índices) en que la contraseña la escribió el usuario. */
  manual: number[];
}

export type HopAction =
  | { kind: "send"; data: string; step: number; from: string }
  | { kind: "ask"; line: string; answer: "yes" | "y" }
  | { kind: "notify"; text: string }
  /** Un paso intermedio llegó a su equipo: la pestaña ya está ahí y sigue el siguiente. */
  | { kind: "step"; step: number; at: string }
  /** Pedir al backend que escriba la credencial en el pedido de contraseña (un solo intento). */
  | { kind: "fill"; source: HopCredSource; step: number; token: string }
  | { kind: "cred-rejected"; source: HopCredSource; step: number; text: string }
  | { kind: "done"; at: string; mismatch?: string; manual: ManualPassword[] }
  | { kind: "fail"; reason: string; step: number; sent: boolean };

export interface NewHopStep {
  cmd: string;
  to: string;
  ip?: string;
  user?: string;
  cred?: HopCredSource;
}

/** Salto encadenado: la lista de pasos y el prompt esperado del equipo de partida. */
export function newHopChain(p: { steps: NewHopStep[]; pivot?: string; now: number }): HopJob {
  const first = p.steps[0];
  return {
    phase: "await-prompt",
    steps: p.steps.map((s) => ({ ...s })),
    index: 0,
    cmd: first?.cmd ?? "",
    neighbor: first?.to ?? "",
    pivot: p.pivot,
    startedAt: p.now,
    stepStartedAt: p.now,
    tail: "",
    changedAt: p.now,
    told: [],
    cred: "idle",
    credBase: 0,
    manual: [],
  };
}

/** Un solo salto (el caso de un paso). */
export function newHopJob(p: { cmd: string; neighbor: string; pivot?: string; now: number; cred?: HopCredSource; ip?: string; user?: string }): HopJob {
  return newHopChain({ steps: [{ cmd: p.cmd, to: p.neighbor, ip: p.ip, user: p.user, cred: p.cred }], pivot: p.pivot, now: p.now });
}

/** Resultado de pedir al backend que escriba la credencial: escrita o no. */
export const hopCredResult = (job: HopJob, ok: boolean): HopJob => (job.cred === "asking" ? { ...job, cred: ok ? "typed" : "failed" } : job);

/** Qué espera el salto ahora, para decirlo en la pantalla de Topología (y ofrecer ir a la pestaña). */
export type HopWaiting = "prompt" | "password" | "username" | "hostkey" | "reply" | "done" | "failed";
export function hopWaiting(job: HopJob, screen: string): HopWaiting {
  if (job.phase === "done" || job.phase === "failed") return job.phase;
  const s = classifyHopScreen(job.phase === "sent" ? afterEcho(screen, job.cmd) : screen);
  if (s.kind === "password" || s.kind === "username" || s.kind === "hostkey") {
    // La credencial que escribe la app no necesita al usuario.
    if (s.kind === "password" && (job.cred === "asking" || job.cred === "typed" || (job.cred === "idle" && job.steps[job.index]?.cred))) return "reply";
    return s.kind;
  }
  return job.phase === "await-prompt" ? "prompt" : "reply";
}

const where = (j: HopJob) => (j.steps.length > 1 ? `Paso ${j.index + 1} de ${j.steps.length} (${j.pivot ?? "?"} › ${j.neighbor}): ` : "");

/** ¿El nombre del prompt es el esperado? Un destino dado por IP (equipo sin nombre) no se puede comparar. */
const expected = (to: string, at: string) => isIpv4(nodeId(to)) || isIpv6(to) || samePrompt(to, at);

/**
 * Avanza el trabajo de salto con lo que muestra la pantalla de la pestaña. Devuelve el trabajo
 * nuevo y las acciones a ejecutar (enviar, preguntar al usuario, escribir una credencial, avisar,
 * terminar). Con varios pasos, al llegar a cada equipo espera su prompt estable y recién ahí envía el
 * siguiente; un paso que falla deja la pestaña en el último equipo alcanzado.
 */
export function stepHop(job: HopJob, screen: string, now: number): { job: HopJob; actions: HopAction[] } {
  if (job.phase === "done" || job.phase === "failed") return { job, actions: [] };
  const tail = screen.replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-8).join("\n");
  let j: HopJob = tail === job.tail ? job : { ...job, tail, changedAt: now };
  const actions: HopAction[] = [];
  const tell = (key: string, text: string) => {
    if (j.told.includes(key)) return;
    j = { ...j, told: [...j.told, key] };
    actions.push({ kind: "notify", text });
  };
  const fail = (reason: string) => {
    const sent = j.phase === "sent";
    j = { ...j, phase: "failed" };
    actions.push({ kind: "fail", reason: where(j) + reason, step: j.index, sent });
  };
  const step = j.steps[j.index];
  const last = j.index === j.steps.length - 1;

  // Tope absoluto: una ruta larga con usuarios lentos no queda esperando para siempre.
  if (now - j.startedAt > HOP_TOTAL_MS) {
    fail(`El salto no terminó en ${Math.round(HOP_TOTAL_MS / 60_000)} min.`);
    return { job: j, actions };
  }

  if (j.phase === "await-prompt") {
    const s = classifyHopScreen(screen);
    if (s.kind === "prompt" && (!j.pivot || samePrompt(s.name, j.pivot))) {
      if (now - j.changedAt >= PROMPT_STABLE_MS) {
        j = { ...j, phase: "sent", pivot: j.pivot ?? s.name, sentAt: now, tail: "", changedAt: now, told: [], cred: "idle", credBase: 0 };
        actions.push({ kind: "send", data: `${j.cmd}\r`, step: j.index, from: j.pivot! });
      }
      return { job: j, actions };
    }
    if (s.kind === "prompt") {
      tell("mismatch", `El prompt de la pestaña es ${s.name} y se esperaba ${j.pivot}: no se envía el salto hasta que coincida.`);
    } else if (s.kind === "password" || s.kind === "username") {
      tell(s.kind, `Autentícate en ${j.pivot ?? "el equipo de partida"} en esa pestaña: el salto a ${j.neighbor} se envía solo al aparecer su prompt.`);
    } else if (s.kind === "hostkey") {
      tell(`hostkey:${s.line}`, `${j.pivot ?? "El equipo de partida"} pide confirmar la llave del equipo (${s.line}). Revisa la huella y contesta en la pestaña.`);
    }
    if (now - j.stepStartedAt > PROMPT_WAIT_MS) {
      fail(
        `No apareció el prompt de ${j.pivot ?? "el pivote"} en ${Math.round(PROMPT_WAIT_MS / 60_000)} min: no se envió el salto a ${j.neighbor}.` +
          (j.told.includes("mismatch") ? ` El prompt visible es de otro equipo.` : ""),
      );
    }
    return { job: j, actions };
  }

  // phase === "sent": lo que respondió el equipo después del eco del comando.
  // Tope absoluto del paso: una pantalla que cambia sin parar (logging por consola, un reloj) nunca queda quieta.
  if (now - (j.sentAt ?? now) > USER_WAIT_MS) {
    fail(`El salto a ${j.neighbor} no terminó en ${Math.round(USER_WAIT_MS / 60_000)} min.`);
    return { job: j, actions };
  }
  const after = afterEcho(screen, j.cmd);
  const s = classifyHopScreen(after);
  const err = hopError(after);
  const quiet = now - j.changedAt;
  if (s.kind === "hostkey") {
    if (!j.told.includes(`hostkey:${s.line}`)) {
      j = { ...j, told: [...j.told, `hostkey:${s.line}`] };
      actions.push({ kind: "ask", line: s.line, answer: s.answer });
    }
    if (now - (j.sentAt ?? now) > USER_WAIT_MS) fail(`Sin respuesta a la pregunta de ${j.neighbor}.`);
    return { job: j, actions };
  }
  if (s.kind === "password") {
    const src = step?.cred;
    // Credencial escrita por la app: un solo intento por paso; el rechazo se avisa y la contraseña la escribe el usuario.
    if (src && j.cred === "idle") {
      if (quiet >= FILL_SETTLE_MS) {
        j = { ...j, cred: "asking", credBase: passwordPrompts(after) };
        actions.push({ kind: "fill", source: src, step: j.index, token: `${j.startedAt}|${j.index}` });
      }
      return { job: j, actions };
    }
    if (src && j.cred === "asking") return { job: j, actions };
    if (src && j.cred === "typed") {
      if (passwordPrompts(after) > j.credBase || authRejected(after)) {
        j = { ...j, cred: "rejected" };
        actions.push({
          kind: "cred-rejected",
          source: src,
          step: j.index,
          text: `${src === "saved" ? `La contraseña guardada de ${j.neighbor}` : `La contraseña del pivote en ${j.neighbor}`} fue rechazada: no se reintenta.`,
        });
      }
      return { job: j, actions };
    }
    // Sin credencial (o ya fallada o rechazada): la escribe el usuario en la pestaña.
    if (!j.manual.includes(j.index)) j = { ...j, manual: [...j.manual, j.index] };
    tell("password", `Escribe la contraseña de ${j.neighbor} en la pestaña${src ? "" : " (no se reutiliza la del pivote)"}.`);
    if (now - (j.sentAt ?? now) > USER_WAIT_MS) fail(`Sin respuesta al pedido de contraseña de ${j.neighbor}.`);
    return { job: j, actions };
  }
  if (s.kind === "username") {
    tell("username", `Escribe el usuario de ${j.neighbor} en la pestaña (no se reutiliza el del pivote).`);
    if (now - (j.sentAt ?? now) > USER_WAIT_MS) fail(`Sin respuesta al pedido de usuario de ${j.neighbor}.`);
    return { job: j, actions };
  }
  // Escrita la credencial y sin nuevo pedido: si el equipo dijo que la rechazó, se avisa (el SSH puede seguir pidiendo la clave).
  if (step?.cred && j.cred === "typed" && authRejected(after) && s.kind !== "prompt") {
    j = { ...j, cred: "rejected" };
    actions.push({
      kind: "cred-rejected",
      source: step.cred,
      step: j.index,
      text: `${step.cred === "saved" ? `La contraseña guardada de ${j.neighbor}` : `La contraseña del pivote en ${j.neighbor}`} fue rechazada: no se reintenta.`,
    });
  }
  if (s.kind === "prompt") {
    if (!samePrompt(s.name, j.pivot ?? "")) {
      if (quiet >= PROMPT_STABLE_MS) {
        const mism = expected(j.neighbor, s.name) ? undefined : `Llegó a ${s.name} y se esperaba ${j.neighbor}.`;
        if (!last) {
          if (mism) {
            // Un equipo intermedio equivocado: seguir mandaría los saltos siguientes desde otro equipo.
            j = { ...j, phase: "failed" };
            actions.push({ kind: "fail", reason: `${where(j)}${mism} Se detiene la ruta: la pestaña queda en ${s.name}.`, step: j.index, sent: false });
            return { job: j, actions };
          }
          const next = j.steps[j.index + 1];
          actions.push({ kind: "step", step: j.index, at: s.name });
          j = {
            ...j,
            phase: "await-prompt",
            index: j.index + 1,
            cmd: next.cmd,
            neighbor: next.to,
            pivot: s.name,
            stepStartedAt: now,
            sentAt: undefined,
            told: [],
            cred: "idle",
            credBase: 0,
          };
          return { job: j, actions };
        }
        j = { ...j, phase: "done" };
        const manual = j.manual
          .map((i) => j.steps[i])
          .filter((st): st is HopStep & { ip: string; user: string } => !!st && !!st.ip && !!st.user)
          .map((st) => ({ to: st.to, ip: st.ip, user: st.user }));
        actions.push({ kind: "done", at: s.name, ...(mism ? { mismatch: mism } : {}), manual });
      }
    } else if (err) fail(`No se pudo saltar a ${j.neighbor}: ${err}.`);
    else if (quiet >= ERROR_SETTLE_MS) fail(`El prompt volvió a ${s.name} sin entrar a ${j.neighbor}.`);
    return { job: j, actions };
  }
  if (err && quiet >= ERROR_SETTLE_MS) fail(`No se pudo saltar a ${j.neighbor}: ${err}.`);
  else if (quiet > HOP_IDLE_MS) fail(`${j.neighbor} no respondió en ${Math.round(HOP_IDLE_MS / 1000)} s (sin cambios en la pestaña).`);
  return { job: j, actions };
}

/** La ruta de la pestaña tras un fallo en el paso `step`: queda en el último equipo alcanzado. */
export const routeAfterFail = (r: TabRoute, step: number): TabRoute => truncateRoute(r, step);

// ---------- Vendedor y comando de cada salto ----------

/** Fabricante según el texto de plataforma que informó el equipo (CDP/LLDP); undefined si no se reconoce. */
export function vendorOfPlatform(platform?: string): TopoVendor | undefined {
  if (!platform) return undefined;
  if (/huawei|vrp/i.test(platform)) return "huawei";
  if (/juniper|junos|\bsrx\d|\bmx\d|\bqfx\d|\bex\d{4}/i.test(platform)) return "juniper";
  if (/forti/i.test(platform)) return "fortinet";
  if (/cisco|catalyst|\bws-c|\bc9\d{3}|\bisr|\basr|nexus|nx-?os|\bn\d{1,2}k|\bios\b/i.test(platform)) return "cisco";
  return undefined;
}
export const isNxos = (platform?: string) => !!platform && /nexus|nx-?os|\bn[3579]k/i.test(platform);

// ---------- Plan: qué hace "Abrir terminal" ----------

/** Una pestaña tal como la ve el plan. */
export interface PlanTab {
  tabId: string;
  name: string;
  session: Session;
  status: "connected" | "connecting" | "closed";
  route?: TabRoute;
  /** Equipo donde está (ver `tabDevice`); undefined si cambió a uno desconocido. */
  device?: { name: string; verified: boolean; index: number };
  /** En su prompt y sin trabajo de salto en curso: se puede saltar en ella. */
  free: boolean;
}

export interface PlanNode {
  id: string;
  name: string;
  ip?: string;
  platform?: string;
}

/** De dónde salió un equipo del diagrama: el equipo que lo descubrió (id) y la ruta de la pestaña que estaba en él. */
export interface CameFrom {
  from: string;
  route: TabRoute;
}

export interface PlanInput {
  target: PlanNode;
  nodes: PlanNode[];
  links: { a: string; b: string; logical?: boolean }[];
  tabs: PlanTab[];
  /** Sesión guardada de cada equipo (por id de equipo). */
  saved: Map<string, Session>;
  /**
   * Equipos descubiertos desde una pestaña, por id: el equipo desde el que se descubrió y la ruta de esa pestaña
   * en ese momento. Saltar a N desde M usa esa ruta más el paso M → N, nunca otra por el diagrama.
   */
  cameFrom?: Map<string, CameFrom>;
  /** El usuario marcó que el equipo no se alcanza directo desde este PC. */
  needsPivot: boolean;
  /** Hay una sesión base y la IP del destino es válida: se puede conectar directo. */
  directOk: boolean;
  /**
   * Comando para saltar de `from` (equipo de partida) a `to` desde una sesión de pivote `session`; null si no
   * se puede armar (sin IP válida, usuario inválido).
   */
  cmdFor: (from: PlanNode | undefined, to: PlanNode, session: Session) => { cmd: string; user?: string } | null;
}

export type OpenKind = "focus" | "direct" | "route" | "shortest" | "inplace" | "reconnect";
export interface OpenChoice {
  kind: OpenKind;
  label: string;
  /** Texto corto de apoyo (la ruta, la pestaña). */
  detail?: string;
  tabId?: string;
  /** Ruta completa del equipo (la de la pestaña más el salto, en inplace). */
  route?: TabRoute;
  /** Equipo desde el que se salta (el anterior de la ruta). */
  via?: string;
}

export interface OpenPlan {
  primary?: OpenChoice;
  alternatives: OpenChoice[];
  /** Ruta que se dibuja en el panel: la de la pestaña que ya está en el equipo, o la que se abriría. */
  names: string[];
  /** Por qué no hay acción principal. */
  reason?: string;
  /** Aviso que no impide abrir (la ruta supera el tope y se ofrece otra forma). */
  notice?: string;
}

/** Equipos vecinos por el diagrama (sin sesiones lógicas: no son un salto físico). */
function adjacency(links: PlanInput["links"]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => adj.set(a, [...(adj.get(a) ?? []), b]);
  for (const l of links) {
    if (l.logical || l.a === l.b) continue;
    add(l.a, l.b);
    add(l.b, l.a);
  }
  return adj;
}

/** Ruta más corta hacia el destino desde una pestaña abierta o una sesión guardada, con el comando de cada salto nuevo. */
export function planRoute(inp: PlanInput, max = MAX_ROUTE_STEPS): { route: TabRoute; from?: PlanTab } | undefined {
  const { target } = inp;
  const byId = new Map(inp.nodes.map((n) => [n.id, n]));
  const adj = adjacency(inp.links);
  // BFS desde el destino: para cada equipo, el siguiente hacia el destino y la distancia.
  const next = new Map<string, string>();
  const dist = new Map<string, number>([[target.id, 0]]);
  const queue = [target.id];
  for (let h = 0; h < queue.length; h++) {
    const cur = queue[h];
    if ((dist.get(cur) ?? 0) >= max) continue;
    for (const nb of adj.get(cur) ?? []) {
      if (dist.has(nb)) continue;
      dist.set(nb, (dist.get(cur) ?? 0) + 1);
      next.set(nb, cur);
      queue.push(nb);
    }
  }
  interface Source {
    base: TabRoute;
    from?: PlanTab;
    id: string;
  }
  const sources: Source[] = [];
  for (const t of inp.tabs) {
    if (t.status !== "connected" || !t.device || !isReplayable(t.session)) continue;
    const base: TabRoute = t.route ? truncateRoute(t.route, t.device.index) : { origin: t.device.name, session: t.session, steps: [] };
    sources.push({ base, from: t, id: nodeId(t.device.name) });
  }
  for (const [id, session] of inp.saved) {
    if (!isReplayable(session)) continue;
    const n = byId.get(id);
    if (n) sources.push({ base: { origin: n.name, session, steps: [] }, id });
  }
  const options = sources
    .filter((s) => s.id !== target.id && dist.has(s.id))
    .sort((a, b) => (dist.get(a.id)! - dist.get(b.id)!) || (a.base.steps.length - b.base.steps.length) || (a.from ? 0 : 1) - (b.from ? 0 : 1));
  for (const src of options) {
    if (src.base.steps.length + (dist.get(src.id) ?? 0) > max) continue;
    let route = src.base;
    let cur = src.id;
    let ok = true;
    while (cur !== target.id) {
      const nxt = next.get(cur)!;
      const to = byId.get(nxt);
      const c = to?.ip ? inp.cmdFor(byId.get(cur), to, route.session) : null;
      if (!to || !to.ip || !c) {
        ok = false;
        break;
      }
      route = extendRoute(route, { name: to.name, ip: to.ip, cmd: c.cmd, user: c.user });
      cur = nxt;
    }
    if (ok && route.steps.length <= max) return { route, from: src.from };
  }
  return undefined;
}

const sameRoute = (a: TabRoute, b: TabRoute) => routeNames(a).map(nodeId).join("\u0000") === routeNames(b).map(nodeId).join("\u0000");

/**
 * La ruta heredada: el equipo se descubrió desde una pestaña que estaba en M, así que se llega con la ruta de
 * esa pestaña (la que está ahora en M; si ya no hay, la que tenía al descubrirlo) más el paso M → N. No se
 * recalcula por el diagrama: otro camino más corto (un enlace redundante o de ruteo) sería otro pivote.
 * `tooLong`: la ruta heredada supera el tope.
 */
function planHeritage(inp: PlanInput): { route: TabRoute; from?: PlanTab } | { tooLong: number } | undefined {
  const cf = inp.cameFrom?.get(inp.target.id);
  if (!cf) return undefined;
  const parent = inp.nodes.find((n) => n.id === cf.from);
  const target = inp.nodes.find((n) => n.id === inp.target.id) ?? inp.target;
  if (!parent || !target.ip || !(adjacency(inp.links).get(cf.from) ?? []).includes(target.id)) return undefined;
  const live = inp.tabs.filter((t) => t.status === "connected" && t.device && isReplayable(t.session) && nodeId(t.device.name) === cf.from);
  const at = (t: PlanTab) => (t.route ? truncateRoute(t.route, t.device!.index) : ({ origin: t.device!.name, session: t.session, steps: [] } as TabRoute));
  const tab = live.find((t) => sameRoute(at(t), cf.route)) ?? live.find((t) => t.device?.verified) ?? live[0];
  const base = tab ? at(tab) : cf.route;
  if (!isReplayable(base.session)) return undefined;
  const c = inp.cmdFor(parent, target, base.session);
  if (!c) return undefined;
  const route = extendRoute(base, { name: target.name, ip: target.ip, cmd: c.cmd, user: c.user });
  return route.steps.length > MAX_ROUTE_STEPS ? { tooLong: route.steps.length } : { route, from: tab };
}

const rank = (t: PlanTab) => (t.status === "connected" ? 0 : t.status === "connecting" ? 1 : 2) * 2 + (t.device?.verified ? 0 : 1);

/**
 * Qué hace "Abrir terminal" en un equipo y qué alternativas ofrece el menú desplegable.
 * 1) Hay pestaña conectada en el equipo: la enfoca. 2) Alcanzable directo (sesión guardada, o IP con
 * una sesión base y sin la marca "solo por pivote"): conecta directo. 3) Si no, abre una pestaña nueva
 * por la ruta conocida (salto encadenado). Las alternativas son las otras formas de llegar.
 */
export function planOpen(inp: PlanInput): OpenPlan {
  const { target } = inp;
  const here = inp.tabs.filter((t) => t.device && nodeId(t.device.name) === target.id).sort((a, b) => rank(a) - rank(b));
  const live = here.find((t) => t.status === "connected");
  const dead = here.find((t) => t.status === "closed");
  // Descubierto desde una pestaña: su ruta heredada. Si no, la más corta por el diagrama.
  const heritage = planHeritage(inp);
  const shortest = planRoute(inp);
  const routed = heritage ? ("route" in heritage ? heritage : undefined) : shortest;
  const viaOf = (r: TabRoute) => (r.steps.length > 1 ? r.steps[r.steps.length - 2].name : r.origin);
  const via = routed?.route.steps.length ? viaOf(routed.route) : undefined;
  const direct: OpenChoice | undefined = inp.directOk ? { kind: "direct", label: "Conectar directo desde este PC", detail: target.ip } : undefined;
  const byRoute: OpenChoice | undefined =
    routed && via
      ? { kind: "route", label: `Abrir vía ${via}`, detail: routeTooltip(routed.route), route: routed.route, via }
      : undefined;
  // Otra forma de llegar (más corta por el diagrama): solo si el usuario la elige en el menú.
  const other: OpenChoice | undefined =
    heritage && shortest?.route.steps.length && !(routed && sameRoute(shortest.route, routed.route))
      ? { kind: "shortest", label: `Abrir vía ${viaOf(shortest.route)} (ruta más corta)`, detail: routeTooltip(shortest.route), route: shortest.route, via: viaOf(shortest.route) }
      : undefined;
  // Saltar dentro de una pestaña que ya está en el equipo anterior, si está libre y a un solo paso.
  const inplace: OpenChoice | undefined =
    routed?.from?.free && routed.route.steps.length === (routed.from.route ? routed.from.device!.index : 0) + 1
      ? {
          kind: "inplace",
          label: `Saltar en la pestaña de ${via}`,
          detail: "Usa esa pestaña: deja de estar en su equipo",
          tabId: routed.from.tabId,
          route: routed.route,
          via,
        }
      : undefined;
  const reconnect: OpenChoice | undefined = !live && dead ? { kind: "reconnect", label: "Reconectar", detail: `Pestaña "${dead.name}"`, tabId: dead.tabId } : undefined;
  // Un equipo descubierto desde una pestaña de salto no se alcanza directo por defecto: se llega por su ruta.
  const needsPivot = inp.needsPivot || !!inp.cameFrom?.get(target.id)?.route.steps.length;

  let primary: OpenChoice | undefined;
  if (live) primary = { kind: "focus", label: "Abrir terminal", detail: `Ya hay una pestaña en ${target.name}`, tabId: live.tabId };
  else if (inp.directOk && (!needsPivot || !byRoute)) primary = direct;
  else if (byRoute) primary = byRoute;

  const alternatives = [direct, byRoute, other, inplace, reconnect].filter((c): c is OpenChoice => !!c && c.kind !== primary?.kind);
  // La ruta del panel: la de la pestaña que ya está allí, o la que se abriría.
  const names = live?.route ? routeNames(live.route) : primary?.kind === "route" ? routeNames(primary.route!) : byRoute ? routeNames(byRoute.route!) : live ? [live.device!.name] : [];
  // Sobre el tope se dice con claridad: nunca se cae en silencio a otra forma de llegar.
  const long = heritage && "tooLong" in heritage ? heritage.tooLong : !routed ? planRoute(inp, 64)?.route.steps.length : undefined;
  const notice =
    long && long > MAX_ROUTE_STEPS && !live
      ? `Llegar a ${target.name} por salto toma ${long} saltos y el tope es ${MAX_ROUTE_STEPS}. Conecta una sesión más cerca (guardada o por salto) y descubre desde ella.`
      : undefined;
  const reason = primary
    ? undefined
    : !target.ip
      ? "El equipo no informó IP de gestión."
      : (notice ?? "Sin sesión base ni ruta conocida: conecta el pivote primero.");
  return { primary, alternatives, names, reason, notice };
}

/**
 * Pestaña (la mejor) que está en un equipo, para enfocarla o leer su tráfico: la que su ruta o su
 * prompt ubican allí (verificada por prompt primero). Una pestaña que muestra el prompt de otro equipo
 * no cuenta, aunque su sesión apunte a este: cambió de equipo. Sin prompt a la vista (login,
 * paginador), una pestaña sin ruta cuenta por su nombre o por la IP de su sesión.
 */
export function tabAtDevice<T extends { name: string; host?: string; screen?: (n: number) => string; tabId?: string }>(
  id: string,
  addrs: string[],
  tabs: T[],
  routes?: Record<string, TabRoute>,
): { tab: T; verified: boolean } | undefined {
  let best: { tab: T; verified: boolean; r: number } | undefined;
  for (const t of tabs) {
    const route = t.tabId ? routes?.[t.tabId] : undefined;
    const d = tabDevice(t, route);
    if (!d) continue;
    let r: number;
    if (nodeId(d.name) === id) r = d.verified ? 0 : 2;
    else if (!route && !d.verified && t.host && addrs.includes(t.host)) r = 3;
    else continue;
    if (!best || r <= best.r) best = { tab: t, verified: d.verified, r };
  }
  return best && { tab: best.tab, verified: best.verified };
}


// ---------- Descubrir vecinos desde una pestaña ----------

/**
 * Qué equipo es el que muestra la pestaña al descubrir vecinos: su nombre en el diagrama (el prompt puede traer
 * otro dominio, guion bajo o mayúsculas), su IP (la del paso de la ruta, no la de la sesión del PC) y la ruta de
 * la pestaña hasta él, que heredan los vecinos nuevos. `upto` undefined: el prompt es de un equipo que la ruta no conoce.
 */
export function discoveryIdentity(
  tab: { name: string; host?: string; session: Session; hasTabId: boolean },
  route: TabRoute | undefined,
  prompt: string,
): { name: string; ip: string | undefined; upto?: TabRoute; at: number } {
  if (!route) return { name: prompt, ip: tab.host, upto: tab.hasTabId ? { origin: prompt, session: tab.session, steps: [] } : undefined, at: 0 };
  const shown = routePrompts(route);
  const names = routeNames(route);
  let at = -1;
  for (let i = shown.length - 1; i >= 0 && at < 0; i--) if (samePrompt(prompt, shown[i]) || samePrompt(prompt, names[i])) at = i;
  const ip = route.steps.length ? (at > 0 ? route.steps[at - 1].ip : at === 0 ? route.session.host : undefined) : tab.host;
  return at >= 0 ? { name: names[at], ip, upto: truncateRoute(route, at), at } : { name: prompt, ip, at };
}

/**
 * Procedencia de los vecinos nuevos de un descubrimiento: los que aún no estaban en el diagrama (ni por IP) ni
 * tienen procedencia. Saltar a ellos usa la ruta de la pestaña que los descubrió más un paso.
 */
export function newCameFrom(
  known: { ids: Set<string>; addrs: string[] },
  kept: { name: string; ip?: string }[],
  from: string,
  upto: TabRoute,
  prev: Map<string, CameFrom>,
): Map<string, CameFrom> {
  const out = new Map<string, CameFrom>();
  for (const nb of kept) {
    const id = nodeId(nb.name);
    if (known.ids.has(id) || id === from || prev.has(id) || (nb.ip && known.addrs.includes(nb.ip))) continue;
    out.set(id, { from, route: upto });
  }
  return out;
}

/** El nodo como equipo del plan. */
export const planNode = (n: TopoNode): PlanNode => ({ id: n.id, name: n.name, ip: n.ip, platform: n.platform });
