// Copyright 2026 The MathWorks, Inc.

import type { ZipOptions, Zippable } from 'fflate';
import type { ZipMemberStamp } from './Inflate.js';

// A package written back as it was read: its members in the order its directory listed them,
// each with the time stamp and the compression it had there (Inflate.zipMemberStamps). For every
// writer that zips a package back up: a compressed-binary dictionary's (BinarySlddSerializer) and
// a model's (ModelFileWriter).

/**
 * The members in the order the archive they were read from listed them, each with the time
 * stamp and the compression it had there: the zip-level metadata of the package, kept as
 * read, so a save neither reorders nor restamps it. Of 57 binary dictionaries measured, 51
 * stamp every member 1980-01-01 00:00 and 54 do not list `data/chunk0.xml` last, where this
 * writer put it; writing the save's own time also made two saves of one dictionary differ.
 * Members the archive did not list follow, as before; with nothing known about the archive,
 * the members go as they are.
 */
export function asRead(members: Record<string, Uint8Array>, stamps: readonly ZipMemberStamp[] | undefined): Zippable {
    if (!stamps) {
        return members;
    }
    const out: Zippable = {};
    for (const stamp of stamps) {
        if (Object.prototype.hasOwnProperty.call(members, stamp.name) && !Object.prototype.hasOwnProperty.call(out, stamp.name)) {
            out[stamp.name] = [members[stamp.name], optionsOf(stamp)];
        }
    }
    for (const [name, data] of Object.entries(members)) {
        if (!Object.prototype.hasOwnProperty.call(out, name)) {
            out[name] = data;
        }
    }
    return out;
}

function optionsOf(stamp: ZipMemberStamp): ZipOptions {
    const options: ZipOptions = stamp.method === 0 ? { level: 0 } : {};
    const mtime = dosDateTime(stamp.dosTime, stamp.dosDate);
    if (mtime) {
        options.mtime = mtime;
    }
    return options;
}

// The local time an MS-DOS time and date field pair names, or undefined for one that names
// none. The zip writer stores the Date's LOCAL fields, so the round trip is exact only for a
// pair whose every field is in range and that is not a local time a clock change skips; any
// other is written with the writer's own time, as every member used to be.
function dosDateTime(dosTime: number, dosDate: number): Date | undefined {
    const year = 1980 + (dosDate >> 9);
    const month = (dosDate >> 5) & 15;
    const day = dosDate & 31;
    const hours = dosTime >> 11;
    const minutes = (dosTime >> 5) & 63;
    const seconds = (dosTime & 31) * 2;
    const date = new Date(year, month - 1, day, hours, minutes, seconds);
    const exact = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        && date.getHours() === hours && date.getMinutes() === minutes && date.getSeconds() === seconds;
    return exact && year <= 2099 ? date : undefined;
}
