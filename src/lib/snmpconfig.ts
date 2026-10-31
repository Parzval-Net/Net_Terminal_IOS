/**
 * Generador de configuración de AGENTE SNMP endurecida (solo lectura) para pegar a mano.
 * Lógica pura: sin red, sin backend, sin persistencia. Los secretos llegan como argumentos
 * y solo se insertan en el texto devuelto; nunca se guardan ni se registran.
 *
 * Fuentes (revisadas para la sintaxis; ver comentarios por plataforma):
 *  - RFC 3414 USM para SNMPv3 (contraseñas de 8 caracteres o más, localización de llaves)
 *    https://www.rfc-editor.org/rfc/rfc3414
 *  - RFC 3415 VACM (vistas, grupos y niveles de seguridad)
 *    https://www.rfc-editor.org/rfc/rfc3415
 *  - RFC 3826 AES-128 en USM (AES-192/256 NO están estandarizados por IETF: existen las
 *    variantes draft-blumenthal-aes-usm-04 y la de Reeder/Cisco, que no interoperan entre sí)
 *    https://www.rfc-editor.org/rfc/rfc3826
 *  - RFC 7860 HMAC-SHA-2 en USM (SHA-224/256/384/512)
 *    https://www.rfc-editor.org/rfc/rfc7860
 *  - net-snmp snmpd.conf(5): http://www.net-snmp.org/docs/man/snmpd.conf.html
 *  - Cisco IOS XE "SNMP Configuration Guide" (snmp-server view/group/user/host, trap-source)
 *  - Cisco Nexus "System Management Configuration Guide", capítulo "Configuring SNMP"
 *  - Huawei VRP "Configuration Guide - Network Management and Monitoring", capítulo SNMP
 *  - Juniper "Configure SNMPv3" y "Configure the SNMPv3 Authentication Type and Encryption Type"
 *    https://www.juniper.net/documentation/us/en/software/junos/network-mgmt/topics/topic-map/configuring-snmpv3.html
 *  - Fortinet "FortiOS CLI Reference": config system snmp sysinfo / community / user
 *  - Cisco "SNMP Best Practices": excluir snmpUsmMIB, snmpVacmMIB y snmpCommunityMIB de las vistas.
 *
 * Política: nunca se genera acceso de escritura (RW, SET, write-view, rwuser, rwcommunity).
 */

export type Platform = "ios" | "nxos" | "vrp" | "junos" | "fortios" | "netsnmp";
export type SnmpVer = "v3" | "v2c";
export type AuthAlg = "sha256" | "sha1";
export type PrivAlg = "aes128" | "aes256";
export type NotifyKind = "trap" | "inform";

export interface PlatformInfo {
  id: Platform;
  label: string;
  /** Soporta AES-256 en USM (con las salvedades de interoperabilidad indicadas). */
  aes256: boolean;
  /** Soporta vistas con subárboles excluidos. */
  views: boolean;
  sourceLabel: string;
  sourcePlaceholder: string;
  filename: string;
  /** Carácter de comentario del CLI o archivo. */
  cm: string;
}

export const PLATFORMS: PlatformInfo[] = [
  { id: "ios", label: "Cisco IOS / IOS-XE", aes256: true, views: true, sourceLabel: "Interfaz de origen (traps)", sourcePlaceholder: "Loopback0", filename: "snmp-cisco-ios.txt", cm: "!" },
  { id: "nxos", label: "Cisco NX-OS", aes256: false, views: false, sourceLabel: "Interfaz de origen (traps)", sourcePlaceholder: "mgmt0", filename: "snmp-cisco-nxos.txt", cm: "!" },
  { id: "vrp", label: "Huawei VRP", aes256: true, views: true, sourceLabel: "Interfaz de origen (traps)", sourcePlaceholder: "LoopBack0", filename: "snmp-huawei-vrp.txt", cm: "#" },
  { id: "junos", label: "Juniper Junos", aes256: false, views: true, sourceLabel: "Origen de traps (lo0 o IP)", sourcePlaceholder: "lo0", filename: "snmp-junos.set", cm: "#" },
  { id: "fortios", label: "Fortinet FortiOS", aes256: true, views: false, sourceLabel: "Interfaz de gestión (allowaccess)", sourcePlaceholder: "mgmt", filename: "snmp-fortios.txt", cm: "#" },
  { id: "netsnmp", label: "Linux net-snmp (snmpd.conf)", aes256: true, views: true, sourceLabel: "Dirección de escucha (IP)", sourcePlaceholder: "192.0.2.5", filename: "snmpd.conf", cm: "#" },
];

export const platformInfo = (p: Platform) => PLATFORMS.find((x) => x.id === p)!;

export interface GenInput {
  platform: Platform;
  version: SnmpVer;
  user: string;
  group: string;
  view: string;
  acl: string;
  auth: AuthAlg;
  priv: PrivAlg;
  /** IPs o redes CIDR del NMS que consulta (IPv4). */
  nms: string;
  /** Receptores de traps/informs (IPv4, opcional). */
  receivers: string;
  notify: NotifyKind;
  source: string;
  contact: string;
  location: string;
  extend: boolean;
  /** Secretos opcionales: vacíos generan marcadores. Nunca se persisten. */
  authPass: string;
  privPass: string;
  community: string;
}

export const DEFAULT_INPUT: GenInput = {
  platform: "ios",
  version: "v3",
  user: "nms-ro",
  group: "NT-GRP-RO",
  view: "NT-VIEW-RO",
  acl: "NT-SNMP-NMS",
  auth: "sha256",
  priv: "aes128",
  nms: "",
  receivers: "",
  notify: "trap",
  source: "",
  contact: "",
  location: "",
  extend: false,
  authPass: "",
  privPass: "",
  community: "",
};

export const PH = { auth: "<AUTH_PASS>", priv: "<PRIV_PASS>", community: "<COMMUNITY>" } as const;

export interface FieldError {
  field: keyof GenInput;
  msg: string;
}

export interface GenResult {
  text: string;
  errors: FieldError[];
  warnings: string[];
}

// ---------- Validación ----------

/** Nombres de usuario, grupo, vista y ACL: sin espacios, comillas ni saltos de línea. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
/** Interfaces: letras, dígitos y / . : - (ej. GigabitEthernet0/0/1, Vlan10, port1). */
const IFACE_RE = /^[A-Za-z][A-Za-z0-9/._:-]{0,47}$/;
/**
 * Secretos: ASCII imprimible sin espacios, comillas, barra invertida ni caracteres que el CLI
 * interpreta (? ayuda en Cisco, ! y # comentarios, ; separador). Largo 8 a 64 (RFC 3414 y net-snmp exigen 8 o más).
 */
const SECRET_RE = /^[A-Za-z0-9@%+=:,._~^*$/-]{8,64}$/;
/** Texto libre (contacto, ubicación): imprimible, sin comillas, sin \ ? ! # ; ni saltos de línea. */
const TEXT_RE = /^[^"'`\\?!#;\r\n\t\x00-\x1f\x7f]{0,120}$/;

export interface Net {
  ip: string;
  prefix: number;
}

const ipToInt = (ip: string) => ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
const maskInt = (prefix: number) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

export const maskOf = (prefix: number) => intToIp(maskInt(prefix));
export const wildcardOf = (prefix: number) => intToIp(~maskInt(prefix) >>> 0);

function parseIpv4(s: string): boolean {
  const p = s.split(".");
  return p.length === 4 && p.every((o) => /^(0|[1-9]\d{0,2})$/.test(o) && Number(o) <= 255);
}

/** Lista de IPv4 o CIDR separadas por coma, espacio o salto de línea. */
export function parseNets(text: string): { nets: Net[]; bad: string[] } {
  const nets: Net[] = [];
  const bad: string[] = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^([\d.]+)(?:\/(\d{1,2}))?$/.exec(tok);
    const prefix = m?.[2] != null ? Number(m[2]) : 32;
    if (!m || !parseIpv4(m[1]) || prefix > 32) {
      bad.push(tok);
      continue;
    }
    // La dirección debe ser la de red (sin bits de host), para que la ACL sea exacta.
    if ((ipToInt(m[1]) & ~maskInt(prefix)) >>> 0 !== 0) {
      bad.push(`${tok} (no es la dirección de red)`);
      continue;
    }
    if (prefix === 0) {
      bad.push(`${tok} (0.0.0.0/0 abre el acceso a cualquiera)`);
      continue;
    }
    nets.push({ ip: m[1], prefix });
  }
  return { nets, bad };
}

const cidr = (n: Net) => `${n.ip}/${n.prefix}`;

export function validate(i: GenInput): FieldError[] {
  const e: FieldError[] = [];
  const name = (field: keyof GenInput, label: string, v: string) => {
    if (!NAME_RE.test(v)) e.push({ field, msg: `${label}: 1 a 32 caracteres (letras, dígitos, . _ -), sin espacios ni comillas.` });
  };
  if (i.version === "v3") name("user", "Usuario", i.user);
  if (i.platform === "ios" || i.platform === "vrp" || i.platform === "junos") name("group", "Grupo", i.group);
  if (platformInfo(i.platform).views) name("view", "Vista", i.view);
  if (i.platform === "ios" || i.platform === "nxos" || i.platform === "junos") name("acl", "ACL", i.acl);

  const nms = parseNets(i.nms);
  if (!nms.nets.length && !nms.bad.length) e.push({ field: "nms", msg: "Indica al menos una IP o red del NMS para la ACL." });
  if (nms.bad.length) e.push({ field: "nms", msg: `No válido: ${nms.bad.join(", ")}. Usa IPv4 o CIDR, ej. 192.0.2.10 o 192.0.2.0/24.` });
  const rcv = parseNets(i.receivers);
  if (rcv.bad.length) e.push({ field: "receivers", msg: `No válido: ${rcv.bad.join(", ")}.` });
  if (rcv.nets.some((n) => n.prefix !== 32)) e.push({ field: "receivers", msg: "Los receptores deben ser IPs de host, no redes." });

  const src = i.source.trim();
  if (src) {
    if (i.platform === "netsnmp" || (i.platform === "junos" && src !== "lo0")) {
      if (!parseIpv4(src)) e.push({ field: "source", msg: i.platform === "junos" ? "Usa lo0 o una IPv4." : "Usa una IPv4 local del servidor." });
    } else if (!IFACE_RE.test(src)) e.push({ field: "source", msg: "Nombre de interfaz no válido (sin espacios ni comillas)." });
  }
  if (!TEXT_RE.test(i.contact)) e.push({ field: "contact", msg: "Contacto: hasta 120 caracteres, sin comillas, \\ ? ! # ; ni saltos de línea." });
  if (!TEXT_RE.test(i.location)) e.push({ field: "location", msg: "Ubicación: hasta 120 caracteres, sin comillas, \\ ? ! # ; ni saltos de línea." });

  const secret = (field: keyof GenInput, label: string, v: string) => {
    if (v && !SECRET_RE.test(v)) e.push({ field, msg: `${label}: 8 a 64 caracteres, sin espacios, comillas, \\ ? ! # ;.` });
  };
  if (i.version === "v3") {
    secret("authPass", "Contraseña auth", i.authPass);
    secret("privPass", "Contraseña priv", i.privPass);
    if (i.authPass && i.privPass && i.authPass === i.privPass) e.push({ field: "privPass", msg: "Usa contraseñas distintas para auth y priv." });
  } else {
    secret("community", "Community", i.community);
    if (/^(public|private)$/i.test(i.community)) e.push({ field: "community", msg: "No uses public ni private." });
  }
  return e;
}

// ---------- Generación ----------

/** OIDs sensibles excluidos de la vista de lectura (Cisco SNMP Best Practices; RFC 3414/3415/3584). */
const SENSITIVE = [
  { oid: "1.3.6.1.6.3.15", name: "snmpUsmMIB (usuarios SNMPv3)" },
  { oid: "1.3.6.1.6.3.16", name: "snmpVacmMIB (control de acceso)" },
  { oid: "1.3.6.1.6.3.18", name: "snmpCommunityMIB (communities)" },
];
/** HOST-RESOURCES-MIB hrSWRunParameters: argumentos de procesos (pueden traer contraseñas). */
const HR_SWRUN_PARAMS = { oid: "1.3.6.1.2.1.25.4.2.1.5", name: "hrSWRunParameters (argumentos de procesos)" };

export function generate(input: GenInput): GenResult {
  const i: GenInput = { ...input, user: input.user.trim(), group: input.group.trim(), view: input.view.trim(), acl: input.acl.trim(), source: input.source.trim(), contact: input.contact.trim(), location: input.location.trim() };
  const info = platformInfo(i.platform);
  const errors = validate(i);
  const warnings: string[] = [];
  if (i.version === "v2c") warnings.push("SNMPv2c envía la community en texto claro y no autentica el origen. Úsalo solo si el NMS no soporta v3 y en una red de gestión aislada.");
  if (i.version === "v3" && i.auth === "sha1") warnings.push("SHA-1 (HMAC-SHA-96) está obsoleto. Prefiere SHA-256 (RFC 7860) si el equipo y el NMS lo soportan.");
  if (i.version === "v3" && i.priv === "aes256") {
    if (!info.aes256) warnings.push(`${info.label} no soporta AES-256 en SNMPv3; se usa AES-128 (RFC 3826).`);
    else warnings.push("AES-256 no está estandarizado por IETF: hay dos variantes de derivación de llave (Blumenthal y Reeder/Cisco). Verifica que el NMS use la misma que el equipo, o usa AES-128 (RFC 3826).");
  }
  if (!info.views) warnings.push(`${info.label} no permite vistas con subárboles excluidos desde este bloque; el acceso es de solo lectura a toda la MIB que expone el equipo.`);
  if (errors.length) return { text: "", errors, warnings };

  const priv: PrivAlg = i.priv === "aes256" && info.aes256 ? "aes256" : "aes128";
  const nms = parseNets(i.nms).nets;
  const rcv = parseNets(i.receivers).nets.map((n) => n.ip);
  const v = {
    ...i,
    priv,
    authPass: i.authPass || PH.auth,
    privPass: i.privPass || PH.priv,
    community: i.community || PH.community,
    typed: !!(i.authPass || i.privPass || i.community),
  };
  const gen = { ios, nxos, vrp, junos, fortios, netsnmp }[i.platform];
  const head = [
    `${info.cm} Configuración SNMP de solo lectura generada por NetTerminal para ${info.label}.`,
    `${info.cm} Revisa cada línea antes de aplicarla. No incluye acceso de escritura (SET).`,
    v.typed
      ? `${info.cm} ATENCIÓN: este texto contiene secretos reales. No lo guardes en tickets ni repositorios.`
      : `${info.cm} Reemplaza los marcadores <...> por valores reales de 8 caracteres o más antes de pegar.`,
    "",
  ];
  return { text: [...head, ...gen(v, nms, rcv)].join("\n") + "\n", errors, warnings };
}

type V = GenInput & { priv: PrivAlg; typed: boolean };

const q = (s: string) => `"${s}"`;

// ---------- Cisco IOS / IOS-XE ----------
// snmp-server view/group/user/host/community/trap-source/contact/location: Cisco IOS XE SNMP Configuration Guide.
// Sintaxis de user: snmp-server user U G v3 auth {md5|sha} P priv {des|3des|aes {128|192|256}} P access ACL.
function ios(v: V, nms: Net[], rcv: string[]): string[] {
  const o: string[] = [];
  o.push(`ip access-list standard ${v.acl}`);
  for (const n of nms) o.push(n.prefix === 32 ? ` permit host ${n.ip}` : ` permit ${n.ip} ${wildcardOf(n.prefix)}`);
  o.push(" deny any log", "!");
  o.push(`snmp-server view ${v.view} iso included`);
  for (const s of SENSITIVE) o.push(`snmp-server view ${v.view} ${s.oid} excluded`);
  if (v.contact) o.push(`snmp-server contact ${v.contact}`);
  if (v.location) o.push(`snmp-server location ${v.location}`);
  if (v.version === "v3") {
    o.push(`snmp-server group ${v.group} v3 priv read ${v.view} access ${v.acl}`);
    let auth = "sha";
    if (v.auth === "sha256") {
      o.push(
        "! SHA-256: la palabra clave 'sha-2 256' aplica a IOS XE reciente (reportado desde 17.10, no confirmado en la guía oficial).",
        "! Verifica con 'snmp-server user X Y v3 auth ?'. IOS clásico (15.x) solo acepta md5 o sha.",
      );
      auth = "sha-2 256";
    }
    const pv = v.priv === "aes256" ? "aes 256" : "aes 128";
    o.push(`snmp-server user ${v.user} ${v.group} v3 auth ${auth} ${v.authPass} priv ${pv} ${v.privPass} access ${v.acl}`);
  } else {
    o.push(`snmp-server community ${v.community} view ${v.view} RO ${v.acl}`);
  }
  if (rcv.length) {
    if (v.source) o.push(`snmp-server trap-source ${v.source}`);
    if (v.source && v.notify === "inform") o.push(`snmp-server source-interface informs ${v.source}`);
    for (const ip of rcv) {
      const kind = v.notify === "inform" ? "informs " : "";
      if (v.version === "v3") {
        if (v.notify === "inform") {
          o.push(
            "! Informs v3: el usuario debe existir también para el engineID del receptor.",
            `snmp-server engineID remote ${ip} <ENGINE_ID_NMS>`,
            `snmp-server user ${v.user} ${v.group} remote ${ip} v3 auth ${v.auth === "sha256" ? "sha-2 256" : "sha"} ${v.authPass} priv ${v.priv === "aes256" ? "aes 256" : "aes 128"} ${v.privPass}`,
          );
        }
        o.push(`snmp-server host ${ip} ${kind}version 3 priv ${v.user}`);
      } else o.push(`snmp-server host ${ip} ${kind}version 2c ${v.community}`);
    }
    o.push("snmp-server enable traps snmp authentication linkdown linkup coldstart warmstart");
  }
  o.push("!", "! Verifica que no queden communities antiguas: show running-config | include snmp-server community");
  return o;
}

// ---------- Cisco NX-OS ----------
// Cisco Nexus System Management Configuration Guide, "Configuring SNMP":
// snmp-server user U network-operator auth sha P priv aes-128 P; use-ipv4acl; globalEnforcePriv;
// snmp-server host IP traps|informs version 3 priv U; snmp-server source-interface traps|informs IF.
// NX-OS usa roles (network-operator = solo lectura) en vez de vistas VACM configurables.
function nxos(v: V, nms: Net[], rcv: string[]): string[] {
  const o: string[] = [];
  o.push(`ip access-list ${v.acl}`);
  nms.forEach((n, k) => o.push(`  ${(k + 1) * 10} permit udp ${cidr(n)} any`));
  o.push("!");
  if (v.contact) o.push(`snmp-server contact ${v.contact}`);
  if (v.location) o.push(`snmp-server location ${v.location}`);
  if (v.version === "v3") {
    let auth = "sha";
    if (v.auth === "sha256") {
      o.push("! SHA-256: 'sha-256' depende de la versión de NX-OS (no confirmado en la guía oficial). Verifica con 'snmp-server user X auth ?'.");
      auth = "sha-256";
    }
    o.push(`snmp-server user ${v.user} network-operator auth ${auth} ${v.authPass} priv aes-128 ${v.privPass}`);
    o.push(`snmp-server user ${v.user} use-ipv4acl ${v.acl}`);
    o.push("snmp-server globalEnforcePriv");
  } else {
    o.push(`snmp-server community ${v.community} group network-operator`);
    o.push(`snmp-server community ${v.community} use-ipv4acl ${v.acl}`);
  }
  if (rcv.length) {
    const kind = v.notify === "inform" ? "informs" : "traps";
    if (v.source) o.push(`snmp-server source-interface ${kind} ${v.source}`);
    for (const ip of rcv) {
      o.push(v.version === "v3" ? `snmp-server host ${ip} ${kind} version 3 priv ${v.user}` : `snmp-server host ${ip} ${kind} version 2c ${v.community}`);
      if (v.source === "mgmt0") o.push(`snmp-server host ${ip} use-vrf management`);
    }
    if (v.version === "v3" && v.notify === "inform") o.push("! Informs v3: NX-OS requiere el engineID del receptor en el usuario (opción engineID). Revisa la guía de tu versión.");
  }
  o.push("!", "! Revisa communities previas: show snmp community");
  return o;
}

// ---------- Huawei VRP ----------
// Huawei VRP Configuration Guide, SNMP: snmp-agent mib-view, snmp-agent group v3 ... privacy read-view ... acl,
// snmp-agent usm-user v3 ... authentication-mode / privacy-mode (en versiones recientes pide la contraseña en forma interactiva),
// snmp-agent target-host trap address udp-domain ... params securityname ... v3 privacy, snmp-agent trap source.
function vrp(v: V, nms: Net[], rcv: string[]): string[] {
  const o: string[] = [];
  const acl = 2999;
  o.push(`# ACL básica ${acl}: verifica que el número esté libre (display acl ${acl}).`);
  o.push(`acl number ${acl}`);
  nms.forEach((n, k) => o.push(` rule ${(k + 1) * 5} permit source ${n.ip} ${n.prefix === 32 ? "0" : wildcardOf(n.prefix)}`));
  o.push(" rule 1000 deny", " quit", "#");
  o.push("snmp-agent");
  o.push(`snmp-agent sys-info version ${v.version === "v3" ? "v3" : "v2c"}`);
  o.push("# Confirma con 'display snmp-agent sys-info version' que solo quede habilitada esta versión (sin v1).");
  o.push(`snmp-agent mib-view included ${v.view} iso`);
  for (const s of SENSITIVE) o.push(`snmp-agent mib-view excluded ${v.view} ${s.oid}`);
  if (v.contact) o.push(`snmp-agent sys-info contact ${q(v.contact)}`);
  if (v.location) o.push(`snmp-agent sys-info location ${q(v.location)}`);
  if (v.version === "v3") {
    const am = v.auth === "sha256" ? "sha2-256" : "sha";
    const pm = v.priv === "aes256" ? "aes256" : "aes128";
    o.push(`snmp-agent group v3 ${v.group} privacy read-view ${v.view} notify-view ${v.view} acl ${acl}`);
    o.push(`snmp-agent usm-user v3 ${v.user}`);
    o.push(`snmp-agent usm-user v3 ${v.user} group ${v.group}`);
    o.push("# Las dos líneas siguientes piden la contraseña dos veces: pégalas una a una y escríbela en el equipo.");
    o.push(`#   auth: ${v.authPass === PH.auth ? PH.auth : "(la que escribiste en NetTerminal)"}  priv: ${v.privPass === PH.priv ? PH.priv : "(la que escribiste en NetTerminal)"}`);
    if (v.auth === "sha256") o.push("# sha2-256 requiere VRP reciente; versiones antiguas solo aceptan md5/sha. Verifica con '?'.");
    o.push(`snmp-agent usm-user v3 ${v.user} authentication-mode ${am}`);
    o.push(`snmp-agent usm-user v3 ${v.user} privacy-mode ${pm}`);
    o.push(`snmp-agent usm-user v3 ${v.user} acl ${acl}`);
  } else {
    o.push(`snmp-agent community read cipher ${v.community} mib-view ${v.view} acl ${acl}`);
  }
  if (rcv.length) {
    if (v.source) o.push(`snmp-agent trap source ${v.source}`);
    o.push("snmp-agent trap enable");
    const kind = v.notify === "inform" ? "inform" : "trap";
    for (const ip of rcv) {
      o.push(
        v.version === "v3"
          ? `snmp-agent target-host ${kind} address udp-domain ${ip} params securityname ${v.user} v3 privacy`
          : `snmp-agent target-host ${kind} address udp-domain ${ip} params securityname cipher ${v.community} v2c`,
      );
    }
    if (v.notify === "inform") o.push("# Informs: la sintaxis de target-host inform y el engineID remoto varían por versión de VRP; verifica con '?'.");
  }
  // Las contraseñas tecleadas no se escriben en el texto de Huawei: el equipo las pide de forma interactiva.
  return o;
}

// ---------- Juniper Junos ----------
// Juniper "Configure SNMPv3": set snmp v3 usm local-engine user U authentication-sha256|authentication-sha authentication-password,
// privacy-aes128 privacy-password; vacm security-to-group y access group ... read-view; target-address/target-parameters/notify.
// authentication-sha256 se reporta desde Junos 21.1R1 (foro de Juniper, no confirmado en release notes). Junos no ofrece AES-256 en USM.
function junos(v: V, nms: Net[], rcv: string[]): string[] {
  const o: string[] = [];
  if (v.contact) o.push(`set snmp contact ${q(v.contact)}`);
  if (v.location) o.push(`set snmp location ${q(v.location)}`);
  o.push(`set snmp view ${v.view} oid .1 include`);
  for (const s of SENSITIVE) o.push(`set snmp view ${v.view} oid ${s.oid} exclude`);
  if (v.version === "v3") {
    o.push(...nms.map((n) => `set policy-options prefix-list ${v.acl} ${cidr(n)}`));
    const a = v.auth === "sha256" ? "authentication-sha256" : "authentication-sha";
    if (v.auth === "sha256") o.push("# authentication-sha256 requiere Junos reciente (reportado desde 21.1R1). Verifica con '?'.");
    o.push(`set snmp v3 usm local-engine user ${v.user} ${a} authentication-password ${q(v.authPass)}`);
    o.push(`set snmp v3 usm local-engine user ${v.user} privacy-aes128 privacy-password ${q(v.privPass)}`);
    o.push(`set snmp v3 vacm security-to-group security-model usm security-name ${v.user} group ${v.group}`);
    o.push(`set snmp v3 vacm access group ${v.group} default-context-prefix security-model usm security-level privacy read-view ${v.view}`);
    o.push(`set snmp v3 vacm access group ${v.group} default-context-prefix security-model usm security-level privacy notify-view ${v.view}`);
    o.push(
      "# SNMPv3 en Junos no limita el origen por usuario. Usa el prefix-list en tu filtro de lo0 existente, por ejemplo:",
      `#   set firewall family inet filter <FILTRO-LO0> term snmp from source-prefix-list ${v.acl}`,
      "#   set firewall family inet filter <FILTRO-LO0> term snmp from protocol udp",
      "#   set firewall family inet filter <FILTRO-LO0> term snmp from destination-port snmp",
      "#   set firewall family inet filter <FILTRO-LO0> term snmp then accept",
      "# (ubícalo antes del término de descarte; no apliques un filtro nuevo a lo0 sin revisar el actual).",
    );
  } else {
    o.push(`set snmp community ${q(v.community)} authorization read-only`);
    o.push(`set snmp community ${q(v.community)} view ${v.view}`);
    for (const n of nms) o.push(`set snmp community ${q(v.community)} clients ${cidr(n)}`);
    o.push(`set snmp community ${q(v.community)} clients 0.0.0.0/0 restrict`);
  }
  if (rcv.length) {
    if (v.source) o.push(`set snmp trap-options source-address ${v.source}`);
    if (v.version === "v3") {
      rcv.forEach((ip, k) => {
        o.push(`set snmp v3 target-address NT-NMS${k + 1} address ${ip}`);
        o.push(`set snmp v3 target-address NT-NMS${k + 1} tag-list NT-NOTIFY`);
        o.push(`set snmp v3 target-address NT-NMS${k + 1} target-parameters NT-TP`);
      });
      o.push(`set snmp v3 target-parameters NT-TP parameters message-processing-model v3 security-model usm security-level privacy security-name ${v.user}`);
      o.push(`set snmp v3 notify NT-NOTIFY type ${v.notify} tag NT-NOTIFY`);
      if (v.notify === "inform") o.push("# Informs v3: Junos requiere el usuario bajo 'snmp v3 usm remote-engine <ENGINE_ID_NMS> user ...'. Revisa la guía.");
    } else {
      o.push(`set snmp trap-group NT-TRAPS version v2 targets ${rcv.join(" ")}`);
      if (v.notify === "inform") o.push("# Informs v2c en Junos se configuran vía snmp v3 snmp-community; aquí se generan traps.");
    }
    o.push("# Si la gestión va por una routing-instance, agrega 'routing-instance <nombre>' a cada target.");
  }
  return o;
}

// ---------- Fortinet FortiOS ----------
// FortiOS CLI Reference: config system snmp sysinfo (status, contact-info, location),
// config system snmp user (queries, notify-hosts, security-level auth-priv, auth-proto sha|sha256, priv-proto aes|aes256, trap-status),
// config system snmp community (hosts host-type query|trap, query-v1-status/query-v2c-status). SNMP en FortiOS es solo lectura.
function fortios(v: V, nms: Net[], rcv: string[]): string[] {
  const o: string[] = [];
  o.push("config system snmp sysinfo", "    set status enable");
  if (v.contact) o.push(`    set contact-info ${q(v.contact)}`);
  if (v.location) o.push(`    set location ${q(v.location)}`);
  o.push("end");
  if (v.version === "v3") {
    o.push("config system snmp user", `    edit ${q(v.user)}`, "        set status enable", "        set queries enable", "        set query-port 161");
    if (rcv.length) o.push(`        set notify-hosts ${rcv.join(" ")}`, "        set trap-status enable");
    else o.push("        set trap-status disable");
    o.push("        set security-level auth-priv");
    o.push(`        set auth-proto ${v.auth === "sha256" ? "sha256" : "sha"}`, `        set auth-pwd ${v.authPass}`);
    o.push(`        set priv-proto ${v.priv === "aes256" ? "aes256" : "aes"}`, `        set priv-pwd ${v.privPass}`);
    if (v.priv === "aes256") o.push("        # aes256 usa la variante Blumenthal; 'aes256cisco' es la variante Reeder/Cisco. Usa la misma que el NMS.");
    o.push("    next", "end");
    o.push(
      `# FortiOS no limita por IP las consultas v3 en este bloque según la documentación revisada.`,
      `# Permite SNMP solo en la interfaz de gestión y restringe el origen (${nms.map(cidr).join(", ")}) con una local-in-policy.`,
    );
  } else {
    o.push("config system snmp community", "    # Usa un ID libre (show system snmp community).", "    edit 10", `        set name ${q(v.community)}`, "        config hosts");
    let k = 1;
    for (const n of nms) o.push(`            edit ${k++}`, `                set ip ${n.ip} ${maskOf(n.prefix)}`, "                set host-type query", "            next");
    for (const ip of rcv) o.push(`            edit ${k++}`, `                set ip ${ip} 255.255.255.255`, "                set host-type trap", "            next");
    o.push("        end", "        set query-v1-status disable", "        set query-v2c-status enable", "        set trap-v1-status disable", `        set trap-v2c-status ${rcv.length ? "enable" : "disable"}`, "    next", "end");
  }
  if (rcv.length && v.notify === "inform") o.push("# FortiOS envía traps; no se documenta envío de informs, así que se configuran traps.");
  if (v.source) o.push("config system interface", `    edit ${q(v.source)}`, "        append allowaccess snmp", "    next", "end");
  else o.push("# Habilita SNMP solo en la interfaz de gestión: config system interface / edit <IF> / append allowaccess snmp");
  return o;
}

// ---------- Linux net-snmp ----------
// snmpd.conf(5): agentAddress, view NAME included|excluded OID, rouser [-s usm] USER priv -V VIEW,
// rocommunity COMMUNITY SOURCE -V VIEW, createUser U SHA-256|SHA AUTHPASS AES|AES256 PRIVPASS,
// trapsess -v 3 ... HOST, trap2sink/informsink, sysContact/sysLocation (fijarlos los deja de solo lectura), extend.
// SHA-256 requiere net-snmp 5.8 o superior. AES256 requiere compilar con --enable-blumenthal-aes (AES256C = variante Cisco).
function netsnmp(v: V, nms: Net[], rcv: string[]): string[] {
  const o: string[] = [];
  o.push(v.source ? `agentAddress udp:${v.source}:161` : "# Sin dirección de escucha: snmpd escuchará en todas las interfaces.\nagentAddress udp:161");
  o.push("");
  o.push(`view ${v.view} included .1`);
  for (const s of [...SENSITIVE, HR_SWRUN_PARAMS]) o.push(`view ${v.view} excluded .${s.oid}   # ${s.name}`);
  o.push("");
  if (v.contact) o.push(`sysContact ${v.contact}`);
  if (v.location) o.push(`sysLocation ${v.location}`);
  if (v.contact || v.location) o.push("");
  const a = v.auth === "sha256" ? "SHA-256" : "SHA";
  const x = v.priv === "aes256" ? "AES256" : "AES";
  if (v.version === "v3") {
    o.push(
      "# createUser: con snmpd detenido, ponlo en el archivo persistente (/var/lib/net-snmp/snmpd.conf o /var/lib/snmp/snmpd.conf en Debian).",
      "# snmpd lo convierte en llaves localizadas (usmUser) al iniciar y borra la línea. En /etc/snmp/snmpd.conf quedaría en texto claro.",
      `createUser ${v.user} ${a} ${q(v.authPass)} ${x} ${q(v.privPass)}`,
      "",
    );
    if (v.priv === "aes256") o.push("# AES256 requiere net-snmp compilado con --enable-blumenthal-aes; AES256C es la variante Cisco.");
    if (v.auth === "sha256") o.push("# SHA-256 requiere net-snmp 5.8 o superior.");
    o.push(`rouser -s usm ${v.user} priv -V ${v.view}`);
    o.push(`# USM no filtra por IP: limita UDP/161 a ${nms.map(cidr).join(", ")} con nftables/iptables o el firewall del host.`);
  } else {
    for (const n of nms) o.push(`rocommunity ${v.community} ${cidr(n)} -V ${v.view}`);
  }
  if (rcv.length) {
    o.push("");
    if (v.source) o.push(`# Origen de traps: agrega 'clientaddr ${v.source}' en snmp.conf si el servidor tiene varias IPs.`);
    for (const ip of rcv) {
      if (v.version === "v3") o.push(`trapsess -v 3 ${v.notify === "inform" ? "-Ci " : ""}-u ${v.user} -l authPriv -a ${a} -A ${v.authPass} -x ${x} -X ${v.privPass} ${ip}:162`);
      else o.push(`${v.notify === "inform" ? "informsink" : "trap2sink"} ${ip} ${v.community}`);
    }
    if (v.version === "v3") o.push("# trapsess deja las contraseñas en el archivo: protégelo con chmod 600.");
  }
  if (v.extend) {
    o.push(
      "",
      "# extend: ejecuta el comando como el usuario de snmpd y publica su salida en NET-SNMP-EXTEND-MIB (.1.3.6.1.4.1.8072.1.3.2).",
      "# Usa rutas absolutas, sin argumentos sensibles, y nunca scripts que impriman secretos.",
      "extend uptime /usr/bin/uptime",
    );
  }
  o.push("", "# Verifica que no queden rwcommunity/rwuser ni 'rocommunity public' heredados del archivo por defecto.");
  return o;
}
