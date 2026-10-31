/** Diagramas Mermaid dentro de una nota: bloques ```mermaid … ``` o la nota entera si es un diagrama. */

/** Primera palabra de un diagrama Mermaid (tipos que trae la versión incluida). */
const DIAGRAM_START =
  /^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|mindmap|timeline|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|radar-beta|treemap-beta)\b/;

export interface MermaidBlock {
  code: string;
  /** Línea (desde 1) donde empieza el código, para ubicarlo en la nota. */
  line: number;
}

/** Máximo de diagramas que se dibujan por nota y largo máximo de cada uno. */
export const MAX_DIAGRAMS = 12;
export const MAX_DIAGRAM_CHARS = 20000;

export function extractMermaid(text: string): MermaidBlock[] {
  const lines = text.split(/\r?\n/);
  const out: MermaidBlock[] = [];
  for (let i = 0; i < lines.length && out.length < MAX_DIAGRAMS; i++) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})\s*mermaid\s*$/i);
    if (!open) continue;
    const fence = open[1];
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !lines[j].trim().startsWith(fence); j++) body.push(lines[j]);
    const code = body.join("\n").trim();
    if (code) out.push({ code: code.slice(0, MAX_DIAGRAM_CHARS), line: i + 2 });
    i = j;
  }
  if (out.length) return out;
  // Sin bloques: la nota completa, si empieza como un diagrama (tras comentarios %% o vacías).
  const first = lines.findIndex((l) => l.trim() && !l.trim().startsWith("%%"));
  if (first >= 0 && DIAGRAM_START.test(lines[first].trim())) return [{ code: text.trim().slice(0, MAX_DIAGRAM_CHARS), line: first + 1 }];
  return [];
}

/** Plantilla de red para empezar (se inserta como bloque en la nota). */
export const NETWORK_TEMPLATE = `\`\`\`mermaid
flowchart LR
  inet((Internet)) ---|wan1| fw[FW perímetro]
  mpls((MPLS)) ---|wan2| fw
  fw ---|port1 / Te1/1/1| core[Core SW]
  core ---|Po1| dist[Distribución]
  dist --- acc1[Acceso piso 1]
  dist --- acc2[Acceso piso 2]
  classDef nube fill:#e8f0fe,stroke:#4a6fa5;
  class inet,mpls nube;
\`\`\`
`;
