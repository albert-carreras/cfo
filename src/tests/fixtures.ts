import {
  fixture,
  toSnapshotFacts,
  FIXTURE_AS_OF,
  BASELINE,
} from "../../scripts/seed.fixture";
import type { SnapshotFacts } from "@/calc/snapshot";

// The committed seed fixture, reused as the test fixture (identical data + ids).
export { fixture, FIXTURE_AS_OF, BASELINE };

// Structural view as the pure calculator input (shared with scripts/seed.ts).
export const facts: SnapshotFacts = toSnapshotFacts(fixture);
