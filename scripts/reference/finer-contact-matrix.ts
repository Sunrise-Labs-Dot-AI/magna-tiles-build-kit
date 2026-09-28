import { contactMatrixFixtures } from "../../tests/fixtures/loaded-contact";
import { CONTACT_CRITERIA, FINER_CONTACT_MATRIX, contactCellKey, contactMatrixCells, passesContactTrial, type ContactMatrixTrial } from "./contact-matrix";

/** A frequency qualifies only together with a collision rate and its next
 * doubled rate. Failed coarse profiles remain visible even if a finer one wins. */
function coverageErrors(trials: ContactMatrixTrial[], expected: ReturnType<typeof contactMatrixCells>) {
  const keys = trials.map(contactCellKey);
  const expectedKeys = new Set(expected.map(contactCellKey));
  return [
    ...expected.filter(cell => !keys.includes(contactCellKey(cell))).map(cell => `missing:${contactCellKey(cell)}`),
    ...keys.filter((key, index) => keys.indexOf(key) !== index).map(key => `duplicate:${key}`),
    ...keys.filter(key => !expectedKeys.has(key)).map(key => `unexpected:${key}`),
  ];
}

/** One shared qualification path for historical selection and current verification. */
export function assessContactProfile(trials: ContactMatrixTrial[], frequency: number, collisionHz: number) {
    const rates = [collisionHz, collisionHz * 2];
    const expected = contactMatrixCells("finer").filter(t => t.frequency === frequency && rates.includes(t.hz));
    const expectedKeys = new Set(expected.map(contactCellKey));
    const rows = trials;
    const errors = coverageErrors(rows, expected);
    const groups = contactMatrixFixtures().flatMap(build => FINER_CONTACT_MATRIX.seeds.map(seed => {
      const cells = rows.filter(t => t.fixture === build.id && t.seed === seed);
      const complete = cells.length === 4 && new Set(cells.map(contactCellKey)).size === 4 &&
        cells.every(t => expectedKeys.has(contactCellKey(t)) && passesContactTrial(t));
      const peakSpread = complete ? Math.max(...cells.map(t => t.peakPenetration)) - Math.min(...cells.map(t => t.peakPenetration)) : null;
      const lateSpread = complete ? Math.max(...cells.map(t => t.latePenetration!)) - Math.min(...cells.map(t => t.latePenetration!)) : null;
      return { fixture: build.id, seed, complete, peakSpread, lateSpread,
        passed: complete && peakSpread! <= CONTACT_CRITERIA.peakSpread && lateSpread! <= CONTACT_CRITERIA.lateSpread };
    }));
    const passed = expected.length === 72 && !errors.length && rows.every(t => passesContactTrial(t) &&
      t.peakPenetration <= CONTACT_CRITERIA.selectionPeak && t.latePenetration! <= CONTACT_CRITERIA.selectionLate) && groups.every(g => g.passed);
    return { frequency, collisionHz, refinementHz: collisionHz * 2, passed,
      ordinaryPasses: rows.filter(passesContactTrial).length, totalTrials: rows.length, groups };
}

export function assessFinerContactMatrix(trials: ContactMatrixTrial[]) {
  const errors = coverageErrors(trials, contactMatrixCells("finer"));
  const profiles = FINER_CONTACT_MATRIX.frequencies.flatMap(frequency => FINER_CONTACT_MATRIX.candidateCollisionRates.map(collisionHz => {
    const rows = trials.filter(t => t.frequency === frequency && [collisionHz, collisionHz * 2].includes(t.hz));
    const profile = assessContactProfile(rows, frequency, collisionHz);
    return { ...profile, passed: !errors.length && profile.passed };
  }));
  const selected = profiles.find(p => p.passed);
  return { coverageErrors: errors, profiles, selectedProfile: selected ? { frequency: selected.frequency, collisionHz: selected.collisionHz } : null };
}
