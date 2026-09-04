// src/datamodel/parser/ParseWarning.ts
// Copyright 2026 The MathWorks, Inc.
//
// The diagnostics channel for a parse that SUCCEEDED but is short.
//
// Every reader in this package has two ways to fail and, until this existed, only
// one way to say so. It could throw — which a host renders as a failed open, and
// which is right when nothing at all could be read — or it could return a value
// with the unreadable part silently absent. The second is the worse failure: a
// file that opens, renders, and is quietly missing half of what it says, with
// nothing anywhere to distinguish it from a file that really is that small.
//
// A warning is for the gap between those two: the source opened, this named piece
// of it did not, and the result you are holding is therefore incomplete.
//
// WHAT IS NOT A WARNING. A reader that meets the limit of the FILE has read it
// correctly and must stay quiet. An `.slx` written before R2020a carries no model
// UUID; a dictionary from R2013b has no linked dictionary; a newer release adds
// documents to a project store that this version does not model. None of those is
// a defect in the file or in the read, and warning about them would put a count on
// every legacy file a user opens — which teaches a host, and its user, to ignore
// the count. Warn when the bytes claim something is there and it could not be read.

/**
 * Stable, machine-readable warning kinds. Hosts group, filter and localize on
 * `code`; `message` is for display and may be reworded at any time.
 *
 * Deliberately about CONTAINERS AND PARTS rather than about any one format, so a
 * `.slx` part, a `.prj` store document and a `.mat` variable all report through
 * the same three shapes as their readers gain the channel.
 */
export type ParseWarningCode =
  /** One named piece of the source could not be read; the rest of it was. */
  | 'part-unreadable'
  /** The source opened but held nothing this reader recognizes; the result is empty. */
  | 'source-empty'
  /** Reading the source failed outright and was recovered from; the result is empty. */
  | 'source-unreadable';

/** One thing that could not be read, in a source that otherwise opened. */
export interface ParseWarning {
  code: ParseWarningCode;
  /** One line, host-renderable, naming what was lost rather than where it broke. */
  message: string;
  /**
   * The piece this is about, in whatever way the format names one: an OPC part
   * path, a project-store relpath, a variable name. Absent when the warning is
   * about the source as a whole.
   */
  part?: string;
}

/**
 * The reason an unknown throw carried, reduced to a string.
 *
 * Warnings cross a worker boundary by structured clone or JSON in every host that
 * parses off-thread, and an `Error` does not survive that in a form anything can
 * read. Keeping the cause as text is what makes a warning a value rather than a
 * live object — which is also why nothing here holds the Error itself.
 */
export function reasonOf(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
