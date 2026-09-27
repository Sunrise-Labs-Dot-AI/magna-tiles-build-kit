import { contactMatrixFixtures } from "../../tests/fixtures/loaded-contact";
import { CONTACT_CRITERIA, FINER_CONTACT_MATRIX, contactCellKey, contactMatrixCells, passesContactTrial, type ContactMatrixTrial } from "./contact-matrix";

/** A frequency qualifies only together with a collision rate and its next
 * doubled rate. Failed coarse profiles remain visible even if a finer one wins. */
export function assessFinerContactMatrix(trials: ContactMatrixTrial[]) {
  const expected = contactMatrixCells("finer"), keys = trials.map(contactCellKey);
  const expectedKeys = new Set(expected.map(contactCellKey));
  const coverageErrors = [
    ...expected.filter(cell => !keys.includes(contactCellKey(cell))).map(cell => `missing:${contactCellKey(cell)}`),
    ...keys.filter((key, index) => keys.indexOf(key) !== index).map(key => `duplicate:${key}`),
    ...keys.filter(key => !expectedKeys.has(key)).map(key => `unexpected:${key}`),
  ];
  const profiles = FINER_CONTACT_MATRIX.frequencies.flatMap(frequency => FINER_CONTACT_MATRIX.candidateCollisionRates.map(collisionHz => {
    const rates = [collisionHz, collisionHz * 2];
    const rows = trials.filter(t => t.frequency === frequency && rates.includes(t.hz));
    const groups = contactMatrixFixtures().flatMap(build => FINER_CONTACT_MATRIX.seeds.map(seed => {
      const cells = rows.filter(t => t.fixture === build.id && t.seed === seed);
      const complete = cells.length === 4 && new Set(cells.map(contactCellKey)).size === 4 &&
        cells.every(t => expectedKeys.has(contactCellKey(t)) && passesContactTrial(t));
      const peakSpread = complete ? Math.max(...cells.map(t => t.peakPenetration)) - Math.min(...cells.map(t => t.peakPenetration)) : null;
      const lateSpread = complete ? Math.max(...cells.map(t => t.latePenetration!)) - Math.min(...cells.map(t => t.latePenetration!)) : null;
      return { fixture: build.id, seed, complete, peakSpread, lateSpread,
        passed: complete && peakSpread! <= CONTACT_CRITERIA.peakSpread && lateSpread! <= CONTACT_CRITERIA.lateSpread };
    }));
    const passed = !coverageErrors.length && rows.every(t => passesContactTrial(t) &&
      t.peakPenetration <= CONTACT_CRITERIA.selectionPeak && t.latePenetration! <= CONTACT_CRITERIA.selectionLate) && groups.every(g => g.passed);
    return { frequency, collisionHz, refinementHz: collisionHz * 2, passed,
      ordinaryPasses: rows.filter(passesContactTrial).length, totalTrials: rows.length, groups };
  }));
  const selected = profiles.find(p => p.passed);
  return { coverageErrors, profiles, selectedProfile: selected ? { frequency: selected.frequency, collisionHz: selected.collisionHz } : null };
}
