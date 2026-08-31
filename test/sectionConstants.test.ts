// Copyright 2026 The MathWorks, Inc.
//
// The two halves of the section↔metadata mapping, and the round trip between them.
//
// A .sldd stores no section names. Every entry carries only a namespace UUID and
// an isderived flag, and which of the four sections it lands in is DERIVED from
// that pair on load (getSectionKey) and stamped back from it on save
// (getSectionMetadata). Those two functions therefore have to be exact inverses:
// if they ever disagree, an entry moves section on the round trip — the classic
// symptom being an Architectural Data entry that reopens under Design Data,
// because arch and design share one namespace and differ ONLY in isderived.
//
// getSectionMetadata is also a PUBLIC barrel export. The vscode host calls it in
// three places to stamp a newly created or pasted entry (structuralEdit,
// xmlStructuralEdit) and to decide whether a section is derived (sectionRules), so
// its exact string shape — 'isderived' as '1'/'0', not a boolean — is a contract
// with a consumer outside this repo.
//
// Section behaviour built on top of these lives in sectionNode.test.ts; this suite
// covers the constants module alone.
import { describe, it, expect } from 'vitest';
import {
  NS_DESIGN,
  NS_CONFIGURATIONS,
  NS_OTHER,
  SECTION_NAMESPACE,
  getSectionKey,
  getSectionMetadata,
} from '../src/datamodel/SectionConstants.js';
import { getSectionMetadata as fromBarrel } from '../src/index.js';

const KEYS = ['design', 'arch', 'config', 'other'] as const;

describe('getSectionMetadata', () => {
  it('maps each section key to its namespace and derived flag', () => {
    expect(getSectionMetadata('design')).toEqual({ namespace: NS_DESIGN, isderived: '0' });
    // Design and Architectural Data share NS_DESIGN — isderived is the only
    // difference, and the only thing that keeps the two sections apart on disk.
    expect(getSectionMetadata('arch')).toEqual({ namespace: NS_DESIGN, isderived: '1' });
    expect(getSectionMetadata('config')).toEqual({ namespace: NS_CONFIGURATIONS, isderived: '0' });
    expect(getSectionMetadata('other')).toEqual({ namespace: NS_OTHER, isderived: '0' });
  });

  it('reports the flags as the strings the file format stores, not booleans', () => {
    // The host compares `getSectionMetadata(s.name).isderived === '1'`, so a
    // boolean here would make every section read as non-derived with no type error.
    for (const key of KEYS) {
      expect(typeof getSectionMetadata(key).isderived).toBe('string');
      expect(['0', '1']).toContain(getSectionMetadata(key).isderived);
    }
  });

  it('files an unknown key under Other rather than returning nothing', () => {
    // An entry with no namespace at all would be unplaceable on reload; Other is
    // the catch-all section that exists for exactly this case.
    expect(getSectionMetadata('notASection')).toEqual({ namespace: NS_OTHER, isderived: '0' });
    expect(getSectionMetadata('')).toEqual({ namespace: NS_OTHER, isderived: '0' });
  });

  it('is reachable from the package barrel, where the host imports it', () => {
    expect(fromBarrel).toBe(getSectionMetadata);
  });
});

describe('getSectionKey', () => {
  it('splits the shared design namespace on the derived flag', () => {
    expect(getSectionKey({ namespace: NS_DESIGN, isderived: '1' })).toBe('arch');
    expect(getSectionKey({ namespace: NS_DESIGN, isderived: '0' })).toBe('design');
    // Only the exact string '1' means derived; anything else is a design entry.
    expect(getSectionKey({ namespace: NS_DESIGN, isderived: 1 })).toBe('design');
    expect(getSectionKey({ namespace: NS_DESIGN, isderived: 'true' })).toBe('design');
    expect(getSectionKey({ namespace: NS_DESIGN })).toBe('design');
  });

  it('maps the config and other namespaces regardless of the derived flag', () => {
    // isderived is meaningless outside NS_DESIGN, so it must not divert the entry.
    expect(getSectionKey({ namespace: NS_CONFIGURATIONS, isderived: '1' })).toBe('config');
    expect(getSectionKey({ namespace: NS_OTHER, isderived: '1' })).toBe('other');
  });

  it('falls back to Design Data for a missing or unrecognized namespace', () => {
    // A dictionary written by another tool, or one whose metadata we failed to
    // read, must still open — placing every such entry in Design Data.
    expect(getSectionKey({})).toBe('design');
    expect(getSectionKey({ namespace: '' })).toBe('design');
    expect(getSectionKey({ namespace: 'not-a-uuid' })).toBe('design');
    expect(getSectionKey({ namespace: undefined })).toBe('design');
  });
});

describe('getSectionKey / getSectionMetadata round trip', () => {
  it('returns every section key to itself', () => {
    // The load↔save invariant. A mismatch here means an entry silently changes
    // section on every open/save cycle.
    for (const key of KEYS) {
      expect(getSectionKey(getSectionMetadata(key) as unknown as Record<string, unknown>), key).toBe(key);
    }
  });

  it('keeps SECTION_NAMESPACE and getSectionMetadata in agreement', () => {
    // SECTION_NAMESPACE is consumed directly by SectionNode (for _namespaceEntryNames
    // and addEntry's metadata stamp), so the table and the function must not drift.
    for (const key of KEYS) {
      expect(getSectionMetadata(key).namespace, key).toBe(SECTION_NAMESPACE[key]);
    }
    // A key absent from the table is exactly the case that falls back to Other.
    expect(SECTION_NAMESPACE.notASection).toBeUndefined();
  });

  it('gives the three namespaces distinct UUIDs', () => {
    expect(new Set([NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER]).size).toBe(3);
    for (const ns of [NS_DESIGN, NS_CONFIGURATIONS, NS_OTHER]) {
      expect(ns).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
