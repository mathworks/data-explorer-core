// Copyright 2026 The MathWorks, Inc.

// The class of an object array whose elements are of more than one class, as MATLAB's text
// format names it, for the readers whose format does not state it: a binary dictionary
// (BinarySlddParser), and a .mat or a model workspace's MCOS blob (McosParser). Both used to
// name such an array after its first element; one rule here keeps the two from drifting
// apart again.
//
// Each element of another class than the array's keeps its own, as `_object_class`; that is
// the readers' half. This is the class the array itself is, `_array_class`.

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
export function arrayClassOf(classes: string[]): string {
  if (classes.every((c) => c === classes[0])) {
    return classes[0];
  }
  return heterogeneousBaseOf(classes) ?? classes[0];
}

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
export function heterogeneousBaseOf(classes: string[]): string | undefined {
  if (classes.every((c) => c === CONFIG_COMPONENT || CONFIG_COMPONENTS.has(c))) {
    return CONFIG_COMPONENT;
  }
  const known = new Set(classes.filter(isMathWorksClass));
  return known.size === 1 ? [...known][0] : undefined;
}

/**
 * Whether `cls` is a known MathWorks class: a class of a package whose classes this package
 * already names as MathWorks' (MATHWORKS_PACKAGES). Simulink and mpt are the packages of every
 * class the node registry, the schema and the Kind column name (NodeClassMap, schema/index,
 * kindMap), and the two the test suite tells MATLAB's own objects from custom ones by; SlCovCC,
 * Sldv and hdlcoderui are the packages of the config components CONFIG_COMPONENTS names. A class
 * of any other package, MathWorks' or not (CoderTarget, SSC, simmechanics, AUTOSAR among them),
 * is not known here, and counts as one that is not MathWorks' (heterogeneousBaseOf).
 */
function isMathWorksClass(cls: string): boolean {
  const dot = cls.indexOf('.');
  return dot > 0 && MATHWORKS_PACKAGES.has(cls.slice(0, dot));
}

/** The packages of the known MathWorks classes (isMathWorksClass). */
const MATHWORKS_PACKAGES: ReadonlySet<string> = new Set(['Simulink', 'mpt', 'SlCovCC', 'Sldv', 'hdlcoderui']);

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
export function componentsBaseOf(ownerClass: string | undefined, name: string | undefined): string | undefined {
  return name === 'Components' && (ownerClass === 'Simulink.ConfigSet' || ownerClass === 'Simulink.RTWCC') ? CONFIG_COMPONENT : undefined;
}

const CONFIG_COMPONENT = 'Simulink.ConfigComponent';

/** Each class MATLAB's text format lists as an element of a Simulink.ConfigComponent array (see heterogeneousBaseOf). */
const CONFIG_COMPONENTS: ReadonlySet<string> = new Set([
  'Simulink.SolverCC',
  'Simulink.DataIOCC',
  'Simulink.OptimizationCC',
  'Simulink.DebuggingCC',
  'Simulink.HardwareCC',
  'Simulink.ModelReferenceCC',
  'Simulink.SFSimCC',
  'Simulink.RTWCC',
  'Simulink.CodeAppCC',
  'Simulink.GRTTargetCC',
  'Simulink.ERTTargetCC',
  'Simulink.STFCustomTargetCC',
  'SlCovCC.ConfigComp',
  'Sldv.ConfigComp',
  'hdlcoderui.hdlcc',
]);
