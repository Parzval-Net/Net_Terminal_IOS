/**
 * Lectura de texto de CLI compartida (topología, ciclo de vida, respaldos, CLI Lab): prompt del
 * equipo y mensajes de error. El backend (filexfer.rs) reconoce los mismos prompts para saber
 * cuándo terminó un comando; las pruebas de ambos lados usan la misma lista.
 */

/**
 * Prompts reconocidos, con el nombre del equipo en el grupo 1:
 * - Huawei/H3C `<SW>`, `[SW-GigabitEthernet0/0/1]`, VRP8 `[~SW]` y con cambios sin commit `[*SW]`
 * - MikroTik `[admin@MikroTik] >` (también en un submenú `/interface>`), shell RHEL `[user@host ~]$`
 * - Junos, PAN-OS y shells `user@host>`, `user@host:~$`
 * - Cisco/Arista/Aruba/HPE `sw01#`, `sw01(config-if)#`, IOS-XR `RP/0/RSP0/CPU0:asr9k#`,
 *   ASA multicontexto `ciscoasa/admin#`, `ciscoasa/pri/act(config)#`,
 *   FortiOS `fw01 #`, `fw01 (port1) #` y con VDOM `fw01 (root) (interface) #`
 */
const HUAWEI_BRACKET = 3;
const PROMPTS = [
  /^<([\w.-]+)>$/,
  /^\[[\w.-]+@([\w.-]+)\](?: \/[\w/-]*)? ?>$/,
  /^\[[\w.-]+@([\w.-]+)(?: [^\]]*)?\][#$]$/,
  // Tras el nombre, un separador explícito: "[\w.-]+[^\]]*" era cuadrático en una línea larga. Sin
  // espacios: "[OK - 33591768 bytes]" (copy de Cisco) o "[edit interfaces]" (Junos) no son prompts.
  /^\[[~*]{0,2}([\w.-]+)(?:[^\]\w.\s-][^\]\s]*)?\]$/,
  /^[\w.-]+@([\w.-]+)(?::\S*)?[>#%$]$/,
  /^(?:[\w/]+:)?([\w.-]+(?:\/[\w.-]+){0,2})(?: ?\([^()]*\)){0,3} ?[#>$%]$/,
];

/**
 * Huawei/H3C: la vista se agrega al nombre con un guion ("[SW-01-GigabitEthernet0/0/1]",
 * "[SW-01-ospf-1]"). Se distingue con las mayúsculas del sistema (interfaces con mayúscula y número,
 * vistas de protocolo en minúscula), para no cortar nombres como "CORE-MPLS-01" o "PE-BGP-01".
 */
const HUAWEI_VIEW =
  /-(?:(?:(?:X|10|25|40|50|100|200|400)?GE|(?:X|Ten-|Forty|Hundred|Twenty-Five)?GigabitEthernet|Ethernet|Eth-Trunk|Vlanif|Vlan-interface|LoopBack|NULL|Tunnel|MEth|Bridge-Aggregation|Route-Aggregation)\d[\w/:.-]*|(?:ospfv3|ospf|bgp|isis|ripng|rip|vlan|aaa|ui-vty|ui-console|user-interface|acl-basic|acl-adv|acl|rsa|pki|ike|ipsec|route-policy|traffic-policy|traffic-classifier|traffic-behavior|qos|vpn-instance|stack|mpls-ldp|mpls|dhcp|ntp|snmp|hwtacacs|radius|domain|port-group|lldp|wlan-view|wlan|line|luser)(?:-?\d[\w/:.-]*)?)$/;

/** Nombre del equipo según el prompt de la última línea con texto, o null. */
export function promptName(output: string): string | null {
  const lines = output.trimEnd().split("\n");
  const last = (lines[lines.length - 1] ?? "").replace(/\r/g, "").trim().slice(0, 160);
  for (const [i, re] of PROMPTS.entries()) {
    const m = last.match(re);
    if (m) return i === HUAWEI_BRACKET ? m[1].replace(HUAWEI_VIEW, "") : m[1];
  }
  return null;
}

/**
 * La pantalla de una pestaña termina en un prompt de equipo (ni "--More--", ni Password:, ni un
 * comando a medias). Enviar con otra cosa a la vista pierde el primer carácter del comando
 * ("how interfaces"). Sin lectura de pantalla no se puede saber y se asume que sí.
 */
export function atPrompt(screen: string | undefined): boolean {
  return screen === undefined || promptName(screen.replace(/\r/g, "").trimEnd().split("\n").slice(-1).join("")) !== null;
}

/** La línea es un prompt de equipo o shell. */
export const isPrompt = (line: string) => promptName(line) !== null;

/**
 * Mensajes de error de CLI al comienzo de una línea: Cisco/Arista/Aruba (`% Invalid input`,
 * `% Incomplete command`, `% Ambiguous command`), Huawei/H3C (`Error: Unrecognized command`,
 * `Error: Wrong parameter`), FortiOS (`Command fail`, `command parse error`, `Unknown action`),
 * Junos (`syntax error`, `unknown command`, `error: …`), MikroTik (`bad command name`,
 * `syntax error`) y PAN-OS (`Unknown command`, `Invalid syntax`).
 */
const CLI_ERROR =
  /^\s*(?:%\s*(?:invalid|incomplete|ambiguous|unknown|unrecognized|bad|error|wrong)[^\n]*|error:[^\n]*|command fail[^\n]*|command parse error[^\n]*|unknown (?:action|command)[^\n]*|syntax error[^\n]*|invalid (?:input|command|syntax)[^\n]*|unrecognized command[^\n]*|bad command name[^\n]*|expected end of command[^\n]*)$/im;

/** Quita colores ANSI y aplica retrocesos, como los muestra la terminal (al borrar "--More--"). */
export function plainCli(text: string): string {
  let out = text.replace(/\r/g, "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  while (out.includes("\b")) {
    const next = out.replace(/[^\n\b]\x08|^\x08+/gm, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Primera línea de error de la salida (desde `from`), recortada, o null. */
export function cliErrorLine(output: string, from = 0): string | null {
  const m = plainCli(output).slice(from).match(CLI_ERROR);
  return m ? m[0].trim().slice(0, 200) : null;
}

/**
 * La salida completa de un comando de consulta es un rechazo (comando inexistente en esa versión).
 * Más estricta que cliErrorLine: no cuenta líneas que empiezan con "error:" o "% Error", que
 * aparecen en salidas válidas (logs, contadores).
 */
export function isRejected(output: string): boolean {
  return /% ?Invalid (?:input|command)|% ?Unrecognized command|% ?Incomplete command|% ?Ambiguous command|Error: ?Unrecognized command|Error: ?Wrong parameter|syntax error|unknown command|Unknown action|Command fail|command parse error|Invalid command|Invalid syntax|bad command name/i.test(
    plainCli(output),
  );
}

/**
 * Error de la respuesta a `cmd`, sin mirar el eco del comando (que puede contener "error:" en
 * un filtro como `show logging | i error:`).
 */
export function commandError(output: string, cmd: string): string | null {
  const text = plainCli(output);
  const at = cmd.trim() ? text.indexOf(cmd.trim()) : -1;
  const from = at < 0 ? 0 : text.indexOf("\n", at) + 1 || text.length;
  return cliErrorLine(text, from);
}
