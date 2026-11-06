// Catalog membership and reviewed model support are separate facts. This map
// drives both browse labels and the pre-solver hold gate. Deck-specific color,
// legality, bracket and budget checks remain the solver's responsibility.
const BOUNCE_HOLDS = new Set(["Azorius Chancery", "Dimir Aqueduct"]);
const FETCH_NAMES = new Set(["Flooded Strand", "Polluted Delta"]);

export function buildCatalogStatuses(lands, heldExcluded = []) {
  const inCatalog = new Set(lands.map((land) => land.name));
  const excluded = new Set(heldExcluded);
  return new Map([...new Set([...inCatalog, ...excluded])].map((name) => {
    const bounce = BOUNCE_HOLDS.has(name);
    const held = bounce || excluded.has(name);
    const reasonCode = !held ? null : bounce ? "bounce_model_unreviewed"
      : FETCH_NAMES.has(name) ? "fetch_model_unreviewed" : "catalog_hold";
    const reason = !held ? null : bounce
      ? "Bounce land: returning a land is not yet modeled by the optimizer."
      : FETCH_NAMES.has(name)
        ? "Typed fetchland: searching for a land is not yet modeled by the optimizer."
        : "Held for catalog review; not available for optimization.";
    return [name, {
      name, inCatalog: inCatalog.has(name),
      optimizationStatus: held ? "held" : "available",
      optimizationReason: reason, optimizationReasonCode: reasonCode,
    }];
  }));
}
