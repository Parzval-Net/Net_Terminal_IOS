/**
 * Exportación a draw.io con íconos de red: cada equipo con el stencil Cisco de draw.io que
 * corresponde a su rol (router, switch L3 o de acceso, firewall, access point, teléfono IP,
 * servidor), enlaces con sus puertos y estilo por origen, revisiones en color y, si se indican,
 * zonas por sitio o carpeta. Los nombres y tamaños de los stencils son los de la biblioteca
 * "Cisco" de draw.io (jgraph/drawio, src/main/webapp/js/diagramly/sidebar/Sidebar-Cisco.js).
 */
import { type TopoNode, type Topology, linkDash, linkGroup, linkKey, protoLabel, isPhysicalProto, xmlEsc } from "./topology";
import { ISSUE_LABEL, type NodeRole, linkChecks, nodeRole, unknownL2, worstSev } from "./topoInsights";

/** Estilo base de la biblioteca Cisco de draw.io (mismos valores que su paleta). */
const BASE =
  "sketch=0;html=1;pointerEvents=1;dashed=0;strokeColor=#ffffff;strokeWidth=2;verticalLabelPosition=bottom;verticalAlign=top;align=center;outlineConnect=0;";

interface Icon {
  shape: string;
  w: number;
  h: number;
}

/** Tamaño en la paleta de draw.io (w y h sobre 100) llevado a la escala del diagrama. */
const icon = (shape: string, w: number, h: number, scale = 0.8): Icon => ({ shape, w: Math.round(w * scale), h: Math.round(h * scale) });

export const ICONS: Record<Exclude<NodeRole, "otro"> | "l3switch", Icon> = {
  router: icon("mxgraph.cisco.routers.router", 78, 53),
  switch: icon("mxgraph.cisco.switches.workgroup_switch", 101, 50),
  l3switch: icon("mxgraph.cisco.switches.layer_3_switch", 64, 64),
  firewall: icon("mxgraph.cisco.security.firewall", 29, 67),
  ap: icon("mxgraph.cisco.misc.access_point", 75, 34),
  phone: icon("mxgraph.cisco.modems_and_phones.ip_phone", 90, 50),
  host: icon("mxgraph.cisco.servers.file_server", 43, 58),
};
const CLOUD = icon("mxgraph.cisco.storage.cloud", 186, 106, 0.45);

/** Switches de núcleo o distribución (capa 3): Catalyst 9400/9500/9600, 6500/6800, Nexus, CloudEngine, EX9200, QFX10000. */
const CORE = /\b(?:C9[456]\d{2}|WS-C6[58]|C68\d{2}|N[3579]K|NEXUS|CE(?:12|16|88)\d{2}|S127\d{2}|EX92\d{2}|QFX10\d{3}|8[34]\d{2}|10000)/i;

/** Ícono de un equipo: por rol, y switch L3 si la plataforma es de núcleo o anuncia ruteo y switching. */
export function iconFor(n: Pick<TopoNode, "name" | "platform" | "caps">): Icon | null {
  const role = nodeRole(n);
  if (role === "otro") return null;
  if (role === "switch") {
    const caps = (n.caps ?? "").toLowerCase();
    if (CORE.test(n.platform ?? "") || (/\brouter\b|\br\b/.test(caps) && /\bswitch\b|\bb\b|\bbridge\b/.test(caps))) return ICONS.l3switch;
  }
  return ICONS[role];
}

const PROTO_COLOR: Record<string, string> = {
  CDP: "#4a5568",
  LLDP: "#4a5568",
  OSPF: "#2563eb",
  EIGRP: "#7c3aed",
  BGP: "#b45309",
  manual: "#6b7280",
  descripción: "#6b7280",
  "MAC/OUI": "#6b7280",
};

/** Texto para un atributo XML con HTML adentro: primero HTML, luego XML. */
const htmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface DrawioIconOptions {
  /** Zona por equipo (sitio o carpeta de la sesión guardada): se dibuja un recuadro por zona. */
  zones?: Map<string, string>;
  /** Líneas extra bajo el equipo (por ejemplo, el ciclo de vida). */
  notes?: Map<string, string>;
  /** Nodo "L2 desconocido" por equipo con puertos activos sin vecino. */
  l2?: boolean;
}

/** Diagrama draw.io (mxfile) con íconos de red, editable y con las mismas posiciones del mapa. */
export function toDrawioIcons(topo: Topology, opts: DrawioIconOptions = {}): string {
  // Más aire vertical que en el mapa: bajo cada ícono van nombre, IP y modelo.
  const t: Topology = { ...topo, nodes: topo.nodes.map((n) => ({ ...n, x: Math.round(n.x * 1.1), y: Math.round(n.y * 1.35) })) };
  const ids = new Map(t.nodes.map((n, i) => [n.id, `n${i}`]));
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const checks = linkChecks(t);
  const zones: string[] = [];
  // Enlaces antes que equipos: el nombre (con fondo blanco) queda sobre las líneas que lo cruzan.
  const edges: string[] = [];
  const cells: string[] = [];

  // Zonas: un recuadro punteado por sitio o carpeta, detrás de los equipos.
  if (opts.zones?.size) {
    const groups = new Map<string, TopoNode[]>();
    for (const n of t.nodes) {
      const z = opts.zones.get(n.id);
      if (z) groups.set(z, [...(groups.get(z) ?? []), n]);
    }
    let i = 0;
    for (const [name, list] of groups) {
      const pad = 70;
      const xs = list.map((n) => n.x);
      const ys = list.map((n) => n.y);
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      const w = Math.max(...xs) - x + pad;
      const h = Math.max(...ys) - y + pad + 40;
      zones.push(
        `<mxCell id="z${i++}" value="${xmlEsc(name.split("/").join(" › "))}" style="rounded=1;arcSize=6;dashed=1;fillColor=none;strokeColor=#6b7280;verticalAlign=top;align=left;spacingLeft=10;spacingTop=6;fontStyle=1;fontSize=12;html=0;" vertex="1" parent="1"><mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/></mxCell>`,
      );
    }
  }

  for (const n of t.nodes) {
    const ic = iconFor(n);
    const lines = [`<b>${htmlText(n.name)}</b>`];
    if (n.ip && n.ip !== n.name) lines.push(htmlText(n.ip));
    if (n.platform) lines.push(`<font color="#6b7280">${htmlText(n.platform.slice(0, 40))}</font>`);
    const note = opts.notes?.get(n.id);
    if (note) lines.push(`<font color="#b91c1c">${htmlText(note)}</font>`);
    if (!n.explored) lines.push(`<i><font color="#6b7280">${n.manual ? "manual" : n.addrOnly ? "visto por ruteo" : "sin explorar"}</font></i>`);
    const value = xmlEsc(lines.join("<br>"));
    // Sin explorar: el mismo ícono más claro. Sin rol conocido: recuadro como el diagrama simple.
    const fill = n.explored ? "#036897" : "#7fb1cc";
    const style = ic
      ? `${BASE}fillColor=${fill};shape=${ic.shape};labelBackgroundColor=#ffffff;`
      : `rounded=1;whiteSpace=wrap;html=1;fillColor=${n.explored ? "#eaf1ff" : "#f4f5f7"};strokeColor=${n.explored ? "#2563eb" : "#9aa1ab"};verticalLabelPosition=bottom;verticalAlign=top;`;
    const w = ic?.w ?? 60;
    const h = ic?.h ?? 40;
    cells.push(
      `<mxCell id="${ids.get(n.id)}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="${Math.round(n.x - w / 2)}" y="${Math.round(n.y - h / 2)}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
    );
  }

  // Enlaces paralelos (miembros de un Port-channel): separados con un punto intermedio, como en el mapa.
  const pairs = new Map<string, number[]>();
  t.links.forEach((l, i) => {
    const k = [l.a, l.b].sort().join("~");
    pairs.set(k, [...(pairs.get(k) ?? []), i]);
  });
  t.links.forEach((l, i) => {
    const s = ids.get(l.a);
    const d = ids.get(l.b);
    if (!s || !d) return;
    const sibs = pairs.get([l.a, l.b].sort().join("~"))!;
    const at = sibs.indexOf(i);
    let points = "";
    if (sibs.length > 1) {
      const [p, q] = l.a < l.b ? [byId.get(l.a)!, byId.get(l.b)!] : [byId.get(l.b)!, byId.get(l.a)!];
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const off = (at - (sibs.length - 1) / 2) * 28;
      const mx = (p.x + q.x) / 2 + (-(q.y - p.y) / len) * off;
      const my = (p.y + q.y) / 2 + ((q.x - p.x) / len) * off;
      points = `<Array as="points"><mxPoint x="${Math.round(mx)}" y="${Math.round(my)}"/></Array>`;
    }
    const issues = checks.get(linkKey(l));
    const sev = worstSev(issues);
    const color = sev === "crit" ? "#cf222e" : sev === "warn" ? "#bf8700" : (PROTO_COLOR[String(l.proto)] ?? "#4a5568");
    const label = [
      // El agregado se rotula una vez por par, no en cada miembro.
      at === 0 ? linkGroup(t, l, byId) : "",
      isPhysicalProto(l.proto) ? "" : protoLabel(l),
      issues?.length ? `! ${[...new Set(issues.map((x) => ISSUE_LABEL[x.kind]))].join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const dash = linkDash(l);
    edges.push(
      `<mxCell id="e${i}" value="${xmlEsc(label)}" style="endArrow=none;html=0;strokeWidth=${sev ? 2.5 : 1.5};strokeColor=${color};fontSize=10;fontColor=${sev ? color : "#374151"};labelBackgroundColor=#ffffff;${dash ? `dashed=1;dashPattern=${dash};` : ""}" edge="1" parent="1" source="${s}" target="${d}"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`,
      `<mxCell id="e${i}a" value="${xmlEsc(l.aPort)}" style="edgeLabel;html=0;fontSize=10;labelBackgroundColor=#ffffff;" vertex="1" connectable="0" parent="e${i}"><mxGeometry x="-0.6" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`,
      `<mxCell id="e${i}b" value="${xmlEsc(l.bPort)}" style="edgeLabel;html=0;fontSize=10;labelBackgroundColor=#ffffff;" vertex="1" connectable="0" parent="e${i}"><mxGeometry x="0.6" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`,
    );
  });

  // Puertos activos sin vecino: una nube pequeña bajo el equipo.
  if (opts.l2) {
    let i = 0;
    for (const [id, info] of unknownL2(t)) {
      const n = byId.get(id);
      const src = ids.get(id);
      if (!n || !src) continue;
      const cid = `l${i}`;
      // Del lado contrario a sus vecinos, como en el mapa.
      let dx = 0;
      let dy = 0;
      for (const l of t.links) {
        const o = l.a === id ? byId.get(l.b) : l.b === id ? byId.get(l.a) : undefined;
        if (o) (dx += o.x - n.x), (dy += o.y - n.y);
      }
      const len = Math.hypot(dx, dy);
      const [ux, uy] = len ? [-dx / len, -dy / len] : [1, 0];
      const x = n.x + ux * 140;
      const y = n.y + uy * 110;
      cells.push(
        `<mxCell id="${cid}" value="${xmlEsc(`L2 desconocido<br>${info.ports.length} puertos${info.macs ? ` · ${info.macs} MAC` : ""}`)}" style="${BASE}fillColor=#9aa1ab;shape=${CLOUD.shape};fontSize=10;" vertex="1" parent="1"><mxGeometry x="${Math.round(x - CLOUD.w / 2)}" y="${Math.round(y - CLOUD.h / 2)}" width="${CLOUD.w}" height="${CLOUD.h}" as="geometry"/></mxCell>`,
        `<mxCell id="${cid}e" value="" style="endArrow=none;dashed=1;dashPattern=2 4;strokeColor=#9aa1ab;html=0;" edge="1" parent="1" source="${src}" target="${cid}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
      );
      i++;
    }
  }

  return [
    '<mxfile host="NetTerminal">',
    '<diagram name="Topologia" id="topologia">',
    '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0">',
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${zones.join("")}${edges.join("")}${cells.join("")}</root>`,
    "</mxGraphModel>",
    "</diagram>",
    "</mxfile>",
  ].join("\n");
}
