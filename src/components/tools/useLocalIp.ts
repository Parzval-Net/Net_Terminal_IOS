import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface LocalIf {
  name: string;
  ip: string;
  /** Interfaz de la ruta por defecto del sistema. */
  default?: boolean;
}

const KEY = "localIp";
const EVENT = "nt-local-ip";

const stored = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * IPs de este PC y la elegida para los comandos que se copian al equipo. El backend las
 * ordena: primero la de la ruta por defecto, luego físicas (en*, eth*, Ethernet, Wi-Fi) y al
 * final las virtuales (bridge, utun, vEthernet). La elección se comparte entre herramientas
 * (Transferencias, Syslog, SNMP) y se recuerda en este navegador.
 */
export function useLocalIp() {
  const [ips, setIps] = useState<LocalIf[]>([]);
  const [chosen, setChosen] = useState(stored);

  useEffect(() => {
    invoke<LocalIf[]>("local_ips")
      .then((l) => setIps(l ?? []))
      .catch(() => {});
    const on = (e: Event) => setChosen((e as CustomEvent<string>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  const setIp = (ip: string) => {
    try {
      localStorage.setItem(KEY, ip);
    } catch {
      /* solo comodidad */
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: ip }));
  };

  // Una IP recordada que ya no existe (otra red) no se usa.
  const ip = ips.some((i) => i.ip === chosen) ? chosen : (ips[0]?.ip ?? "");
  return { ips, ip, setIp };
}
