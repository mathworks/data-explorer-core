/**
 * The class an object array of elements of `classes` is, as MATLAB's text format names it in
 * `_array_class`: the class every element shares; for elements of several classes, the common
 * base class where it can be derived (heterogeneousBaseOf); and otherwise the first element's,
 * which is what each reader named every such array before it kept the elements' own. A config
 * set's Components does not come here: its place names its class (componentsBaseOf).
 *
 * The first element's class is still what an array of no derivable base reads as: of the 71
 * mixed arrays the binary dictionaries of the test fixtures, the parity artifacts and the local
 * corpus hold, one, a simmechanics.ConfigurationSet's Components of two simmechanics classes.
 */
export declare function arrayClassOf(classes: string[]): string;
/**
 * The common base class of an array mixing `classes`, where the readers can derive one, or
 * undefined.
 *
 * Neither a binary dictionary nor an MCOS blob states it: a binary dictionary's `<P
 * Name="UserMLArray2" Dimension="1*2">` carries no Class, an MCOS object array is a list of
 * object ids, and in both each element names only its own. A text dictionary does, and two
 * rules give the base it names from the classes alone:
 * - Simulink.ConfigComponent, for an array whose classes each belong to CONFIG_COMPONENTS: every
 *   Components array of a Simulink.ConfigSet and of a Simulink.RTWCC that MATLAB wrote into a
 *   text dictionary is `_array_class` Simulink.ConfigComponent (30 of 30, in five
 *   dictionaries), over classes each listed there.
 * - The one known MathWorks class (isMathWorksClass) of an array mixing it with classes that are
 *   not: a user's class can derive from a MathWorks class and a MathWorks class never from a
 *   user's, so the MathWorks class is the base the user classes extend. A text dictionary MATLAB
 *   wrote names a Simulink.Signal subclass beside a Simulink.Signal `{"_array_class":
 *   "Simulink.Signal", …}`, and the binary reader read the binary twin of that array, in two
 *   dictionaries, as the subclass, the first element's class. MATLAB's class() of a
 *   dexdata.DerivedSignal beside a Simulink.Signal, read out of a .mat, is Simulink.Signal
 *   (test/fixtures/mcos/configset.truth.json).
 * Of two MathWorks classes or more beside other classes, or of none, it names no base.
 */
export declare function heterogeneousBaseOf(classes: string[]): string | undefined;
/**
 * The class the place of a property named `name` of an object of `ownerClass` names for an
 * object array there, or undefined where it names none: Simulink.ConfigComponent, for the
 * Components of a Simulink.ConfigSet or a Simulink.RTWCC, whatever components it holds.
 *
 * Every such array MATLAB wrote into a text dictionary is `_array_class`
 * Simulink.ConfigComponent (30 of 30, in five dictionaries), and MATLAB's class() of one read
 * out of a .mat is the same (test/fixtures/mcos/configset.truth.json). A binary dictionary and
 * an MCOS blob name no base for it, and a binary dictionary can hold components no text
 * dictionary has shown, so that CONFIG_COMPONENTS does not list them: a
 * CoderTarget.SettingsController, in seven config sets of a corpus dictionary, and an
 * SSC.SimscapeCC, in one of another. Those arrays used to read under their first component's
 * class, a Simulink.SolverCC.
 */
export declare function componentsBaseOf(ownerClass: string | undefined, name: string | undefined): string | undefined;
//# sourceMappingURL=objectArrayClass.d.ts.map