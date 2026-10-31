import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface JobEvent {
  job: string;
  kind: string;
  text: string;
  data?: { output: string; ok?: boolean; declined?: string | null };
}

export interface DeviceResult {
  /** Sin errores reconocidos en la salida ni preguntas rechazadas. */
  ok: boolean;
  output: string;
  /** Pregunta del equipo que se respondió que no (`answer = false`). */
  declined?: string;
}

/**
 * Ejecuta un comando en la sesión (responde --More-- y confirmaciones) y devuelve toda
 * su salida cuando vuelve el prompt. Los eventos que llegan antes de conocer el id del
 * trabajo se guardan y se procesan después, para no perder respuestas rápidas.
 */
export async function runOnDevice(conn: string, command: string, timeoutSecs = 60): Promise<string> {
  return (await runOnDeviceResult(conn, command, timeoutSecs)).output;
}

/** Igual que runOnDevice, con el veredicto. `answer = false`: no confirma preguntas del equipo. */
export async function runOnDeviceResult(conn: string, command: string, timeoutSecs = 60, answer = true): Promise<DeviceResult> {
  let job: string | null = null;
  const early: JobEvent[] = [];
  let output = "";
  let ok = true;
  let declined: string | undefined;
  let failure = "";
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));

  const handle = (e: JobEvent) => {
    if (e.kind === "result" && e.data) {
      output = e.data.output;
      ok = e.data.ok !== false;
      declined = e.data.declined ?? undefined;
    }
    if (e.kind === "error") failure = e.text;
    if (e.kind === "done") resolveDone();
  };

  const un = await listen<JobEvent>("tool-job", ({ payload }) => {
    if (job === null) early.push(payload);
    else if (payload.job === job) handle(payload);
  });
  try {
    job = await invoke<string>("device_run", { conn, command, timeoutSecs, answer });
    early.filter((e) => e.job === job).forEach(handle);
    await done;
  } finally {
    un();
  }
  if (failure && !output) throw new Error(failure);
  return { ok: ok && !failure, output, declined };
}
