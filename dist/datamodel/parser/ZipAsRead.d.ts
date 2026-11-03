import type { Zippable } from 'fflate';
import type { ZipMemberStamp } from './Inflate.js';
/**
 * The members in the order the archive they were read from listed them, each with the time
 * stamp and the compression it had there: the zip-level metadata of the package, kept as
 * read, so a save neither reorders nor restamps it. Of 57 binary dictionaries measured, 51
 * stamp every member 1980-01-01 00:00 and 54 do not list `data/chunk0.xml` last, where this
 * writer put it; writing the save's own time also made two saves of one dictionary differ.
 * Members the archive did not list follow, as before; with nothing known about the archive,
 * the members go as they are.
 */
export declare function asRead(members: Record<string, Uint8Array>, stamps: readonly ZipMemberStamp[] | undefined): Zippable;
//# sourceMappingURL=ZipAsRead.d.ts.map