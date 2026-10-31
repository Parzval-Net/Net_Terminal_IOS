/**
 * Verificación MD5 después de SCP/SFTP. La copia corre en otra pestaña (scp o sftp sobre un
 * PTY): esa pestaña avisa cuando el proceso termina con el evento SCP_EXIT_EVENT y el gestor de
 * archivos decide qué hacer. Solo una subida terminada con código 0 se verifica, con el mismo
 * comando MD5 por plataforma que TFTP/HTTP/FTP.
 */

/** Evento de ventana que emite la pestaña de transferencia al terminar o al cerrarse. */
export const SCP_EXIT_EVENT = "nt-scp-exit";

export interface ScpExit {
  /** Id de la transferencia (id de la sesión de la pestaña). */
  transfer: string;
  /** Motivo de término que informa el backend ("Sesión finalizada" o "Proceso terminado (código N)"). */
  reason: string | null;
  /** La pestaña se cerró antes de que el proceso terminara. */
  closed?: boolean;
}

/** Código de salida desde el motivo de término de connection.rs (spawn_pty). null: desconocido. */
export function scpExitCode(reason: string | null): number | null {
  if (!reason) return null;
  if (/^Sesión finalizada/.test(reason)) return 0;
  const m = /código (-?\d+)/.exec(reason);
  return m ? Number(m[1]) : null;
}

export interface ScpJob {
  upload: boolean;
  /** "scp", "sftp" o "shell" (sftp interactivo). */
  mode: "scp" | "sftp" | "shell";
  files: string[];
  /** "Verificar MD5 después de enviar" marcado. */
  verify: boolean;
  /** La plataforma tiene comando MD5. */
  canVerify: boolean;
}

export type ScpNext =
  | { action: "verify"; files: string[]; text: string }
  | { action: "done"; text: string }
  | { action: "failed"; text: string }
  | { action: "manual"; text: string };

/** Qué hacer cuando termina (o se cierra) la pestaña de una transferencia. */
export function scpOutcome(job: ScpJob, exit: ScpExit): ScpNext {
  const name = job.mode === "scp" ? "SCP" : "SFTP";
  // SFTP interactivo: el usuario escribe put/get, no hay un fin de transferencia claro.
  if (job.mode === "shell")
    return { action: "manual", text: "Sesión SFTP cerrada: para verificar lo que subiste, selecciona los archivos en el gestor y pulsa MD5." };
  if (exit.closed) return { action: "failed", text: `Pestaña ${name} cerrada antes de terminar: no se verifica el MD5` };
  const code = scpExitCode(exit.reason);
  if (code !== 0)
    return { action: "failed", text: `${name} terminó ${code === null ? "con error" : `con código ${code}`}: no se verifica el MD5` };
  if (job.upload && job.verify && job.canVerify && job.files.length)
    return { action: "verify", files: job.files, text: `${name} terminó bien: verificando MD5` };
  return { action: "done", text: `${name} terminó bien` };
}

/** La sesión del equipo está tomada por un script (scripts::BUSY): se reintenta más tarde. */
export const isBusyError = (e: unknown) => String(e).includes("Un script está usando esta sesión");

/** Reintentos de una verificación con el equipo ocupado: cada 5 s, hasta 2 minutos. */
export const BUSY_RETRY_MS = 5000;
export const BUSY_RETRIES = 24;

/** Espera antes del próximo intento, o null si ya no se reintenta. */
export function busyRetry(attempt: number): number | null {
  return attempt < BUSY_RETRIES ? BUSY_RETRY_MS : null;
}
