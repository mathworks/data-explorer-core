/**
 * Parameters whose dialog restricts the value to a fixed option list, per BlockType.
 *
 * A value drawn from an option list never names data, however much it may LOOK like a
 * variable: a Math block's `Operator` reads `square`, and crediting that would put the
 * block on the Usage cell of any variable spelled the same way. Simulink itself enforces
 * the option list, so no loadable model can hold a reference here.
 *
 * Keyed on the (BlockType, parameter) PAIR rather than the bare name, because the same
 * name can be an option list on one block and an expression on another — `Format`,
 * `SimulateUsing`, `TriggerType`, `OutDataTypeStr` and `IntermediateResultsDataTypeStr`
 * are each measured both ways. A name-keyed table would suppress the expression too.
 */
export declare const ENUM_BLOCK_PARAMS: Readonly<Record<string, readonly string[]>>;
//# sourceMappingURL=enumBlockParams.d.ts.map