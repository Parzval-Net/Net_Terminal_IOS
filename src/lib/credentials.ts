import { invoke } from "@tauri-apps/api/core";

/** Estado de la bóveda de contraseñas. Nunca incluye contraseñas. */
export interface CredStatus {
  /** "keychain": llave en el llavero del sistema. "vault": contraseña maestra. */
  backend: "keychain" | "vault";
  exists: boolean;
  unlocked: boolean;
  portable: boolean;
}

export const credStatus = () => invoke<CredStatus>("cred_status");

/** La bóveda pide contraseña maestra y está bloqueada. */
export const needsUnlock = (st: CredStatus | null) => !!st && st.backend === "vault" && st.exists && !st.unlocked;

/** Dónde queda guardada, en una frase. */
export const storageLabel = (st: CredStatus | null) =>
  !st
    ? "bóveda cifrada"
    : st.backend === "keychain"
      ? "bóveda cifrada de la app, con la llave en el llavero del sistema"
      : "bóveda cifrada con contraseña maestra" + (st.portable ? " (modo portable)" : "");

/** Fuerza aproximada de la contraseña maestra: 0 débil, 1 aceptable, 2 buena, 3 fuerte. */
export function masterStrength(pw: string): number {
  if (pw.length < 8) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let score = pw.length >= 16 ? 2 : pw.length >= 12 ? 1 : 0;
  if (classes >= 3) score++;
  return Math.min(3, Math.max(score, 1));
}

export const strengthText = ["Muy corta (mínimo 8)", "Aceptable", "Buena", "Fuerte"];

/** Máscara fija para una contraseña guardada: no revela ni el largo. */
export const MASK = "••••••••";
