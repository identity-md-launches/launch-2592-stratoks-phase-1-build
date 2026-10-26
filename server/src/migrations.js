// Snapshot schema migrations. Each entry upgrades snapshot.state from version N to N+1 in place.
// v0 is a documented legacy layout used to exercise the framework (creatures had `hp`, no totals.interventions).
export const CURRENT_SCHEMA = 1;
export const MIGRATIONS = {
  0(state) {
    for (const c of state.creatures ?? []) { if (c.health === undefined && c.hp !== undefined) { c.health = c.hp; delete c.hp; } }
    state.totals ??= {}; state.totals.interventions ??= 0; state.totals.deathsByCause ??= {};
    state.interventions ??= {}; state.interventionOrder ??= []; state.interventionTimes ??= {};
    state.learning ??= true; state.vstate ??= {};
  },
};
export function migrate(snap) {
  let v = snap.schemaVersion ?? 0;
  if (v > CURRENT_SCHEMA) throw new Error(`snapshot schema ${v} is newer than this server (${CURRENT_SCHEMA}); refusing to load`);
  const from = v;
  while (v < CURRENT_SCHEMA) { MIGRATIONS[v](snap.state); v++; }
  snap.schemaVersion = v;
  return { snap, from, to: v };
}
