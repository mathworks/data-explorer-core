// Copyright 2026 The MathWorks, Inc.
//
// For each Simulink object in the corpus, every property MATLAB reports must
// surface with MATLAB's value. gen_truth.m sets non-default values precisely so a
// property that silently falls back to its default fails here.
//
// The surface is the Property Inspector (`toPIObject`), NOT the child rows: an
// object's properties are not tree children — `aParam` has no children at all and
// `aBus`'s children are its bus elements. See piProperties.
//
// A property sheet cell holds the VALUE, not a MATLAB literal, so `Unit` shows
// `m/s` where a table cell would show `'m/s'`. That one difference is the whole of
// expectedPropertyText; everything else keeps the mat2str spelling.
//
// A nested object (CoderInfo, LoggingInfo, Elements, Table) has no one-line
// spelling — mat2str refuses it — so it is checked for PRESENCE only, and MATLAB's
// own disp says what presence means: either the object's name appears in the sheet
// or every sub-property MATLAB lists for it does.
import { describe, it, expect } from 'vitest';
import {
  truth, loadArtifact, hasArtifact, entry, piProperties, piLookup, verdict, refused,
  ARTIFACT_KINDS, type Artifact, type PropTruth,
} from './loadTruth.js';
import { expectedPropertyText, propertyTextMatches, subPropertyNames } from './expect.js';

const T = truth();

for (const fmt of ARTIFACT_KINDS) {
  describe('property parity — ' + fmt, () => {
    if (!hasArtifact(fmt)) {
      it.skip('artifact not generated — run gen_truth.m', () => {});
      return;
    }
    const root = loadArtifact(fmt);

    for (const [name, v] of Object.entries(T.vars)) {
      // Only the scalar objects carry property truth: gen_truth.m records it for
      // `isobject && ~isstring && isscalar`, because `arr.Prop` on a nonscalar
      // Simulink array silently answers the FIRST element's value.
      if (!v.properties) { continue; }
      if (refused(T, fmt as Artifact, name)) {
        it.skip(name + ' — MATLAB refused: ' + verdict(T, fmt as Artifact, name), () => {});
        continue;
      }

      for (const [prop, pv] of Object.entries(v.properties)) {
        // propTruth records {error} instead of {class,size,disp} for a property
        // MATLAB itself could not read. Nothing to assert against.
        if ('error' in pv) {
          it.skip(name + '.' + prop + ' — MATLAB could not read it: ' + pv.error, () => {});
          continue;
        }
        const want = expectedPropertyText(pv);
        if (want === null) {
          it(name + '.' + prop + ' surfaces its ' + pv.class + ' sub-properties', () => {
            const props = piProperties(entry(root, name));
            expect(
              nestedSurfaces(props, prop, pv, entry(root, name)),
              nestedReport(props, prop, pv),
            ).toBe(true);
          });
          continue;
        }
        it(name + '.' + prop + ' surfaces with MATLAB\'s value', () => {
          const node = entry(root, name);
          const props = piProperties(node);
          const found = piLookup(props, prop);
          expect(found, name + '.' + prop + ' is not in the property sheet: ' +
            JSON.stringify([...props.keys()])).toBeTruthy();
          expect(
            propertyTextMatches(found!.text, pv),
            name + '.' + prop + ' (sheet key ' + found!.path + '): MATLAB ' +
              JSON.stringify(want) + ', model ' + JSON.stringify(found!.text),
          ).toBe(true);
        });
      }

      it(name + ' reports its MATLAB class', () => {
        expect(entry(root, name).className).toBe(v.class);
      });
    }
  });
}

/**
 * Whether a nested-object property surfaces. Three ways, all of them MATLAB's own
 * statement about the value rather than a guess about our layout:
 *
 *   1. its own name is in the sheet, whole or as a path segment —
 *      `Other.CoderInfo.StorageClass` surfaces `CoderInfo`;
 *   2. every sub-property MATLAB's disp lists for it is in the sheet — which is how
 *      a projected prop counts, `CoderInfo.StorageClass` arriving as `storageClass`;
 *   3. it is an ARRAY of objects and the node has that many element rows — a Bus's
 *      `Elements` is a 2x1 BusElement array and surfaces as the two child rows.
 */
function nestedSurfaces(props: Map<string, string>, prop: string, pv: PropTruth, node: any): boolean {
  const want = prop.toLowerCase();
  for (const path of props.keys()) {
    if (path.toLowerCase().split('.').includes(want)) { return true; }
  }
  const subs = subPropertyNames(pv);
  if (subs.length > 0 && subs.every((s) => piLookup(props, s) !== undefined)) { return true; }
  return pv.numel > 1 && (node.children || []).length === pv.numel;
}

function nestedReport(props: Map<string, string>, prop: string, pv: PropTruth): string {
  return prop + ' (' + pv.class + ') is nowhere in the property sheet: no key names it, ' +
    'and MATLAB\'s own sub-properties ' + JSON.stringify(subPropertyNames(pv)) +
    ' are not there either. Sheet: ' + JSON.stringify([...props.keys()]);
}
