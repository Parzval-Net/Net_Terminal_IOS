/**
 * Búsqueda de fabricante por OUI (los primeros 24 bits de una MAC). Se carga con import()
 * dinámico solo cuando la fuente "Sugerencias por MAC/fabricante" está activa, para no sumar
 * los datos al arranque de la aplicación. Datos: src/lib/ouiData.ts (registro MA-L del IEEE).
 */
import { OUI_DATA, OUI_SNAPSHOT } from "./ouiData";
import type { OuiInfo } from "./topology";

export { OUI_SNAPSHOT };

let index: Map<string, OuiInfo> | null = null;

function build(): Map<string, OuiInfo> {
  const m = new Map<string, OuiInfo>();
  for (const [vendor, kind, ouis] of OUI_DATA) for (let i = 0; i < ouis.length; i += 6) m.set(ouis.slice(i, i + 6), { vendor, kind });
  return m;
}

/** Fabricante de una MAC en cualquier formato (aabb.ccdd.eeff, aa:bb:..., aabb-ccdd-eeff). */
export function lookupOui(mac: string): OuiInfo | undefined {
  const hex = mac.replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (hex.length < 6) return undefined;
  index ??= build();
  return index.get(hex.slice(0, 6));
}
