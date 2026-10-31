// Ejecuta un script o plugin real con Python 3 y el netterminal.py de la app, respondiendo sus
// pedidos (mismo protocolo JSON por stdin/stdout que src-tauri/src/scripts.rs) con equipos
// ficticios. Sin red ni equipos.
//
// Simula lo que hace la app con un script: varias sesiones destino, el control de riesgo de
// cada línea (scriptLineRisk/scriptNeedsConfirm de src/lib/scriptGate.ts, con computeRisk real),
// ask_secret con enmascarado, "Detener script" y el tiempo máximo de la ejecución.
import { spawn } from "node:child_process";
import { registerHooks } from "node:module";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { respuesta } from "./equipo-ficticio.js";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// scriptGate.ts y packs.ts importan sin extensión (lo resuelve vite): se agrega ".ts".
registerHooks?.({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        /* sigue con la resolución normal */
      }
    }
    return next(specifier, context);
  },
});
let gate = null;
const cargarGate = () => (gate ??= import(`${ROOT}src/lib/scriptGate.ts`));

const MASK = "••••••";

/** Edición de línea como el CLI del equipo (misma regla que split_commits en scripts.rs). */
function teclear(st, data) {
  const out = [];
  let prevCr = false;
  for (const c of data) {
    if (c === "\n" && prevCr) {
      prevCr = false;
      continue;
    }
    prevCr = c === "\r";
    if (c === "\r" || c === "\n" || c === "\x1a") {
      out.push({ line: st.buf, opaque: st.opaque });
      st.buf = "";
      st.opaque = false;
    } else if (c === "\x04") {
      out.push({ line: st.buf + "^D", opaque: true });
      st.buf = "";
      st.opaque = false;
    } else if (c === "\x7f" || c === "\b") st.buf = st.buf.slice(0, -1);
    else if (c === "\x15") st.buf = "";
    else if (c === "\x03") (st.buf = ""), (st.opaque = false);
    else if (c === "?" || /[\x00-\x1f\x7f​-‏‪-‮⁦-⁩﻿]/.test(c)) {
      st.buf += c === "\t" ? "⇥" : c === "\x1b" ? "␛" : c;
      st.opaque = true;
    } else st.buf += c;
  }
  return out;
}

/**
 * @param {string} path archivo .py
 * @param {object} opts
 *   - session=false simula un plugin sin el permiso "session" (la app rechaza leer o escribir).
 *   - `responder(cmd, nombre)` reemplaza al equipo ficticio y devuelve:
 *     - un arreglo de líneas: salida completa seguida del prompt;
 *     - `{ lento: true, parcial, resto }`: la primera espera vence (como expect::wait_for, con lo
 *       recibido) y `read()` entrega el resto y el prompt;
 *     - `{ mudo: true }`: el equipo no responde (wait_for vence, read() no trae nada);
 *     - `{ colgado: true }`: el equipo no responde y la espera no vence (para "Detener");
 *     - null: comando desconocido (la prueba falla).
 *   - `sesiones`: destinos [{ name, host, type?, platform? }]; por defecto uno (`host`).
 *   - `permitirCambios`, `paralelo` (1 a 4): lo que el usuario elige al lanzar.
 *   - `confirmar(p)`: respuesta del usuario a una línea que pide confirmación
 *     ({ line, risk, session, targets, opaque }); por defecto rechaza.
 *   - `secreto`: lo que el usuario ingresa en ask_secret (null o ausente: cancela).
 *   - `boveda`: el usuario marcó "Permitir que el script escriba contraseñas guardadas". El
 *     equipo ficticio pide contraseña si `responder` devuelve `{ pide: "Password: " }`.
 *   - `detenerTras` (ms): el usuario pulsa "Detener script". `tiempoMax` (ms): tiempo máximo.
 *   - `latencia` (ms): demora de cada operación de sesión (mide cuántas corren a la vez).
 *   - `helperDir`: carpeta del netterminal.py (por defecto el de la app).
 * @returns {Promise<{ commands: string[], porSesion: Record<string, string[]>, logs: string[],
 *   confirmaciones: object[], estado: "ok" | "detenido" | "rechazado" | "tiempo", motivo?: string,
 *   enVueloMax: number }>}
 */
export function ejecutar(
  path,
  {
    action,
    session = true,
    host = "core-sw01",
    responder = respuesta,
    dataDir,
    sessionInfo,
    sesiones,
    permitirCambios = false,
    paralelo = 1,
    confirmar = () => false,
    secreto = null,
    boveda = false,
    detenerTras,
    tiempoMax,
    latencia = 0,
    helperDir,
  } = {},
) {
  const destinos = (sesiones ?? [{ name: host, host: "192.0.2.1", ...sessionInfo }]).map((s) => ({
    name: s.name,
    type: s.type ?? "ssh",
    host: s.host,
    port: s.port ?? 22,
    platform: s.platform ?? null,
  }));
  const principal = sessionInfo ?? { ...destinos[0], username: "operador" };
  return new Promise((resolve, reject) => {
    const py = spawn("python3", ["-u", "-B", path], {
      cwd: ROOT,
      env: {
        ...process.env,
        PYTHONPATH: helperDir ?? `${ROOT}src-tauri/src`,
        PYTHONIOENCODING: "utf-8",
        PYTHONDONTWRITEBYTECODE: "1",
        NT_DATA_DIR: dataDir ?? "/tmp/nt-ejemplos-no-se-usa",
        NT_SESSION: JSON.stringify(session ? principal : {}),
        NT_ALLOW_CHANGES: permitirCambios ? "1" : "0",
        NT_MAX_PARALLEL: String(Math.max(1, Math.min(4, paralelo))),
        ...(action ? { NT_ACTION: action } : {}),
      },
    });
    const commands = [];
    const porSesion = Object.fromEntries(destinos.map((d) => [d.name, []]));
    const logs = [];
    const confirmaciones = [];
    const secretos = [];
    /** Sesiones donde la app escribió la contraseña guardada (type_saved_password). */
    const escritas = [];
    const aprobadas = new Set();
    /** Estado del equipo ficticio de cada sesión. */
    const eq = Object.fromEntries(destinos.map((d) => [d.name, { pending: "", resto: null, colgado: false, linea: { buf: "", opaque: false } }]));
    let estado = "ok";
    let motivo;
    let err = "";
    let fail = null;
    let enVuelo = 0;
    let enVueloMax = 0;
    const timers = [];
    const enmascarar = (t) => secretos.reduce((acc, s) => (s ? acc.split(s).join(MASK) : acc), t);
    const terminar = (e, m) => {
      if (estado !== "ok") return;
      estado = e;
      motivo = m;
      py.kill();
    };
    if (detenerTras !== undefined) timers.push(setTimeout(() => terminar("detenido", "Detenido por el usuario"), detenerTras));
    if (tiempoMax !== undefined) timers.push(setTimeout(() => terminar("tiempo", "Tiempo máximo del script agotado"), tiempoMax));

    const responderOp = async (req) => {
      const op = req.op;
      if (op === "log") {
        logs.push(enmascarar(req.msg));
        return { ok: true };
      }
      if (op === "sessions") return session ? { ok: true, sessions: destinos } : { ok: false, code: "permission", error: "Este plugin no declaró el permiso 'session'" };
      if (op === "ask_secret") {
        if (typeof secreto !== "string") return { ok: false, code: "cancelled", error: "El usuario canceló el ingreso del secreto" };
        secretos.push(secreto);
        return { ok: true, value: secreto };
      }
      // Contraseña guardada: la escribe la app (aquí no hay valor) y el script solo recibe ok.
      if (op === "type_saved_password") {
        if (!session) return { ok: false, code: "permission", error: "Este plugin no declaró el permiso 'session'" };
        if (!boveda) return { ok: false, code: "permission", error: "No se permitió escribir contraseñas guardadas en esta ejecución (casilla al lanzar el script)" };
        const nombre = req.session ?? destinos[0].name;
        const s = eq[nombre];
        if (!s) return { ok: false, code: "session", error: `La sesión "${nombre}" no está entre los destinos elegidos al lanzar el script` };
        // Como la app, mira la pantalla (no lo que el script ya leyó) y responde una vez por pedido.
        if (!s.pidiendo) return { ok: false, code: "vault", error: "La pantalla no muestra un pedido de contraseña" };
        s.pidiendo = false;
        escritas.push(nombre);
        logs.push(`Contraseña guardada escrita en ${nombre} (el script no la ve)`);
        s.pending = `\r\n${nombre}#`;
        return { ok: true };
      }
      if (!["send", "wait", "read", "clear"].includes(op)) return { ok: false, code: "unknown", error: `operación desconocida: ${op}` };
      if (!session) return { ok: false, code: "permission", error: "Este plugin no declaró el permiso 'session'" };
      if (estado !== "ok") return { ok: false, code: "cancelled", error: "El script se detuvo" };
      const nombre = req.session ?? destinos[0].name;
      const s = eq[nombre];
      if (!s) return { ok: false, code: "session", error: `La sesión "${nombre}" no está entre los destinos elegidos al lanzar el script` };
      enVuelo++;
      enVueloMax = Math.max(enVueloMax, enVuelo);
      try {
        if (latencia) await new Promise((r) => setTimeout(r, latencia));
        if (op === "send") {
          for (const { line, opaque } of teclear(s.linea, req.data)) {
            const cmd = line;
            const secretoSolo = !opaque && secretos.some((x) => x && x.trim() === cmd.trim());
            if (cmd.trim() && !secretoSolo) {
              const { scriptLineRisk, scriptNeedsConfirm } = await cargarGate();
              const risk = scriptLineRisk(enmascarar(cmd), opaque);
              const clave = `${opaque ? "\0" : ""}${cmd.trim()}`;
              if (scriptNeedsConfirm(risk, permitirCambios) && !aprobadas.has(clave)) {
                const p = { line: enmascarar(cmd.trim()), risk, opaque, session: nombre, targets: destinos.map((d) => d.name) };
                confirmaciones.push(p);
                if (!confirmar(p)) {
                  const m = `Rechazado: «${p.line}» en ${nombre}. Script detenido.`;
                  setImmediate(() => terminar("rechazado", m));
                  return { ok: false, code: "denied", error: m };
                }
              }
              aprobadas.add(clave);
            }
            // El equipo no repite una contraseña: no queda en `commands` ni en la salida.
            if (secretoSolo) {
              s.pending = `\r\n${nombre}#`;
              continue;
            }
            commands.push(cmd);
            porSesion[nombre].push(cmd);
            const out = responder(cmd, nombre);
            s.resto = null;
            s.colgado = false;
            s.pidiendo = false;
            if (!out) {
              fail = `El equipo ficticio no conoce: ${cmd}`;
              s.pending = `${cmd}\r\n${nombre}#`;
            } else if (out.colgado) {
              s.pending = `${cmd}\r\n`;
              s.colgado = true;
            } else if (out.mudo) {
              s.pending = `${cmd}\r\n`;
              s.resto = "";
            } else if (out.pide) {
              s.pending = `${cmd}\r\n${out.pide}`;
              s.pidiendo = true;
            } else if (out.lento) {
              s.pending = `${cmd}\r\n${out.parcial.join("\r\n")}`;
              s.resto = `\r\n${out.resto.join("\r\n")}\r\n${nombre}#`;
            } else s.pending = `${cmd}\r\n${out.join("\r\n")}\r\n${nombre}#`;
          }
          return { ok: true };
        }
        if (op === "wait") {
          const m = new RegExp(req.pattern).exec(s.pending);
          if (m) {
            let output = s.pending;
            s.pending = "";
            if (req.return_match_only) {
              s.pending = output.slice(m.index + m[0].length);
              output = output.slice(0, m.index + m[0].length);
            }
            return { ok: true, output };
          }
          // Equipo colgado: la espera no vuelve (solo "Detener" o el tiempo máximo la cortan).
          if (s.colgado) return new Promise(() => {});
          if (s.resto !== null) {
            const output = s.pending;
            s.pending = "";
            return { ok: false, code: "timeout", error: "timeout", output };
          }
          fail = `El patrón ${req.pattern} no coincide`;
          const output = s.pending;
          s.pending = "";
          return { ok: true, output };
        }
        if (op === "read") {
          const output = s.pending + (s.resto ?? "");
          s.pending = "";
          s.resto = null;
          return { ok: true, output };
        }
        s.pending = "";
        s.resto = null;
        return { ok: true };
      } finally {
        enVuelo--;
      }
    };

    py.stderr.on("data", (d) => (err += d));
    py.stdin.on("error", () => {});
    createInterface({ input: py.stdout }).on("line", (line) => {
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        logs.push(enmascarar(line));
        return;
      }
      responderOp(req).then((reply) => {
        if ("id" in req) reply.id = req.id;
        if (!py.stdin.destroyed) py.stdin.write(JSON.stringify(reply) + "\n");
      });
    });
    py.on("close", (code) => {
      timers.forEach(clearTimeout);
      const r = { commands, porSesion, logs, confirmaciones, estado, motivo, enVueloMax, escritas, stderr: enmascarar(err) };
      if (estado !== "ok") resolve(r);
      else if (fail) reject(new Error(fail));
      else if (code === 0) resolve(r);
      else reject(new Error(`${path} terminó con ${code}: ${enmascarar(err)}`));
    });
  });
}
