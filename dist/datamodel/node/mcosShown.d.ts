/**
 * The Signedness MATLAB shows of a saved SignednessBool: true, false, or none (a 0x0 logical), which
 * a MAT-file's object holds as `[]`, a text dictionary as the logical `[]` and a binary one as the
 * logical's bare `Matrix(0,0)` header (XmlUtils.emptyHeaderDims).
 */
export declare function signednessShown(saved: unknown): string | null;
/** The three shown of a NumericType's saved bag, or null where it holds them not as numbers. */
export declare function numericTypeShown(bag: Record<string, unknown>): {
    Signed: string;
    FractionLength: number;
    Slope: number;
} | null;
/**
 * The saved three of a NumericType's bag that the shown three it also holds say otherwise, as what they
 * say: numericTypeShown's other way (SignednessBool true, false or a 0x0 logical for 'Signed',
 * 'Unsigned', 'Auto'; FixedExponent = -FractionLength; SlopeAdjustmentFactor = Slope * 2^FractionLength).
 * Only of a bag that holds both, which is a MAT-file's node's (withNumericTypeShown), whose edits write
 * the shown three while its save writes the saved: what a copy of it holds of them, so that the copy is
 * what the save writes. A dictionary's bag holds the saved three alone, or a hand-written shown pair.
 */
export declare function numericTypeSaved(bag: Record<string, unknown>): Record<string, unknown>;
/** `bag`, a NumericType's as MCOS decoded it, with the shown three added where it holds the saved. */
export declare function withNumericTypeShown(bag: Record<string, unknown>): Record<string, unknown>;
/**
 * `bag`, a Simulink.Parameter's as MCOS decoded it, with a Value held as a char row (a string, as the
 * decode gives a char) as the string scalar MATLAB loads it as: measured against MATLAB R2027a, a
 * Parameter whose Value cell holds the char row 's' loads with Value "s", class string, as its setter
 * makes of any text. Such a cell is what a save of this package writes for a string Value typed in
 * (McosEditRules: "a char row, which MATLAB loads as a string scalar"), in a MAT-file and in a
 * binary dictionary's encoded value alike, and the file opened again showed the char 's'. An empty
 * char is left as it is, as no such measurement holds it.
 */
export declare function withParameterValueShown(bag: Record<string, unknown>): Record<string, unknown>;
/**
 * What MATLAB R2027a holds of a Simulink.NumericType made with nothing set, in MATLAB's own
 * alphabetical key order: what a new one is (NumericTypeNode.createDefault), and what MATLAB reads
 * of a property a dictionary's NumericType does not hold (withDefaultsShown).
 */
export declare const NUMERIC_TYPE_DEFAULTS: Readonly<Record<string, unknown>>;
/**
 * `bag`, a `className` object's, with what MATLAB reads of each property it does not hold, for a
 * row to read: a NumericType's default (NUMERIC_TYPE_DEFAULTS), and the FixedExponent of a
 * FractionLength and the SignednessBool of a Signedness it states, as MATLAB's setter makes each.
 * A binary dictionary System Composer wrote holds its NumericType's DataTypeMode and IsAlias alone
 * (arch_binary.sldd), and its rows showed nothing for the rest; measured against MATLAB R2027a, it
 * reads as one with nothing set does, and a hand-written one stating Signedness, WordLength 16 and
 * FractionLength 3 (typeLink.sldd) as FixedExponent -3, Slope 0.125. No default is taken of what
 * the bag states otherwise: a FixedExponent or a SlopeAdjustmentFactor where it states a Slope.
 * Display only: a copy, `bag` itself never changed, and answered as it is where nothing is added;
 * for any other class, `bag`.
 */
export declare function withDefaultsShown(className: string, bag: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
/**
 * The property bag of a `className` object as MATLAB shows it, for a row to read: what it saves under
 * other names shown as the property it is, of any file, a dictionary's as a MAT-file's. A
 * NumericType's Signedness, FractionLength and Slope (withNumericTypeShown), and a Parameter's or a
 * Signal's CoderInfo's Identifier, of the Alias it is saved as. A Signedness the file states, as a
 * hand-written dictionary does, is shown only where the bag holds no SignednessBool,
 * FixedExponent and SlopeAdjustmentFactor as numbers: where it holds them, the Signedness shown is
 * the SignednessBool's, whatever the stated one says. A MAT-file's object holds them (mcosTypedNode
 * adds them as it decodes one); a dictionary's holds what MATLAB saves alone, and its rows showed
 * nothing of them. Display only: `bag` itself is never changed, and is answered as it is where
 * nothing is to be added, so that what a writer writes of it stays the file's.
 */
export declare function shownPropertiesOf(className: string, bag: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
/**
 * `value`, handed to a dictionary (a paste: SectionNode.parseEntry), without what MATLAB shows of
 * each object in it that it saves under other names (shownPropertiesOf), where the object's bag
 * also holds the saved keys it is shown of and the two say the same: a NumericType's Signed,
 * FractionLength and Slope beside its SignednessBool, FixedExponent and SlopeAdjustmentFactor, a
 * Parameter's or a Signal's CoderInfo Identifier beside its Alias. A MAT-file's object holds both
 * (mcosTypedNode), and its copy carried both into the dictionary's file, `Signed` a key MATLAB has
 * no property of; MATLAB saves the saved ones alone, and a dictionary's rows show the rest of them
 * as the MAT-file's did. A shown key saying otherwise is no copy's, and is kept: what MATLAB would
 * load of the two is not measured. And, for a binary dictionary (`binary`), a CoderInfo in the
 * order MATLAB writes one there (savedOnly). A copy where anything changed, the same value where
 * nothing did.
 */
export declare function withoutShownOfSaved(value: unknown, binary?: boolean): unknown;
/**
 * Of a property a `className` object's row shows at `path` (a schema sourcePath), the property
 * MATLAB shows and what it saves it as, where it saves it under another name (shownPropertiesOf):
 * null where it saves it as it is.
 */
export declare function shownOfSaved(className: string, path: string): {
    property: string;
    saved: string;
} | null;
//# sourceMappingURL=mcosShown.d.ts.map