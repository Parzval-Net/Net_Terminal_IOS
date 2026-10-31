/**
 * Packs incluidos en la app. Cada fabricante combina su catálogo investigado (con
 * fuentes y variantes por plataforma, en src/packs/*.json) con el catálogo base; los
 * comandos repetidos se toman del investigado. El usuario puede desactivarlos pero no
 * modificarlos ni borrarlos.
 */
import { vendors } from "./commands";
import { Pack, PackCommand, Platform, validatePack } from "./packs";

interface ResearchFile {
  name: string;
  detectCommand?: string;
  platforms?: Platform[];
  commands: PackCommand[];
}

// Vite incluye estos JSON en el bundle; no se leen del disco en tiempo de ejecución.
const research = import.meta.glob<ResearchFile>("../packs/*.json", { eager: true, import: "default" });

function researchFor(vendor: string): ResearchFile | undefined {
  return Object.entries(research).find(([path]) => path.endsWith(`/${vendor}.json`))?.[1];
}

// Fabricantes que solo vienen de la investigación (sin catálogo base).
const researchOnly = Object.entries(research)
  .map(([path, r]) => ({ id: path.split("/").pop()!.replace(/\.json$/, ""), r }))
  .filter(({ id }) => !vendors.some((v) => v.id === id))
  .map(({ id, r }) => ({ id, name: r.name, note: "", commands: [] as PackCommand[] }));

export const builtinPacks: Pack[] = [...vendors, ...researchOnly].flatMap((v): Pack[] => {
  const r = researchFor(v.id);
  // Con catálogo investigado se usa solo ese: el base no tiene variantes por plataforma y
  // podría contradecir la sintaxis correcta (p. ej. YunShan OS frente a VRP5).
  const commands = r?.commands.length ? r.commands : v.commands;
  // Pasa por la misma validación que un pack importado.
  const result = validatePack({
    format: "netterminal-commands",
    formatVersion: 1,
    id: `builtin-${v.id}`,
    name: `${v.name} (incluido)`,
    vendor: v.id,
    vendorName: v.name,
    description: v.note || undefined,
    detectCommand: r?.detectCommand,
    platforms: r?.platforms ?? [],
    commands,
  });
  return result.pack ? [{ ...result.pack, builtin: true, description: v.note || undefined }] : [];
});
