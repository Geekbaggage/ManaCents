// ESM adapter for the accepted ManaBase solver.
// _manabase_solver.js is the byte-identical v1.4.1-js baseline (CommonJS,
// SHA-256 42cfebe02936d9f020c74a66f8184c93179d3868c7b24e6a62d6891595d37258).
// _manabase_solver_esm.js is generated from it by build_solver_esm.py —
// only the export line differs. This file re-exports the ESM interface.
export {
  OptimizedSolver,
  toCents,
  parseDecimal,
  SOLVER_VERSION,
} from "./_manabase_solver_esm.js";
