classdef DerivedParam < Simulink.Parameter
  % A SUBCLASS of a MathWorks data class — the shape derived_class_{binary,text}.sldd
  % exists for, and the one the corpus had no instance of at all. Everything here is a
  % Simulink.Parameter plus six extra properties, which is how customers extend the
  % class (the documented "define data classes" workflow).
  %
  % WHY IT LIVES IN +dexdata AND NOT BESIDE Widget.m. MATLAB R2027a refuses outright:
  %   Class 'DerivedParam' is a subclass of 'Simulink.DataObject' and must be defined
  %   inside of a package, but not in a nested package
  % So the on-disk class name a customer's dictionary carries for an extended data class
  % is ALWAYS dotted — `dexdata.DerivedParam` here — and never bare. That is a fact about
  % every such entry, not about this fixture: any rule that splits a Class attribute on
  % '.' to find a MathWorks namespace sees a user package in exactly the same shape as
  % `Simulink.Parameter`. A plain custom class (Widget) has the opposite constraint — it
  % cannot be in a nested package either, but it needs no package at all.
  %
  % Why it is worth a fixture: an entry's `Class` attribute becomes DerivedParam, not
  % Simulink.Parameter, so every class-gated rule in the data model sees a name it has
  % never heard of while the VALUE still carries Simulink.Parameter's own properties
  % (Value, DataType, Min, Max, Unit, CoderInfo...). A reader that keys off the exact
  % class name degrades this to a generic object and silently loses the parameter
  % columns; a reader that keys off "is-a" keeps them. The fixture is what makes that
  % choice visible either way.
  %
  % The six extras are one per value kind (double, char, logical, struct, cell, custom
  % enum) so that a derived class's own properties are serialized through the same
  % value paths as a plain custom class's, and any divergence lands on a named property.
  properties
    CalibLevel = 3
    CalibTag = 'cal'
    IsLocked = false
    Limits = struct('lo', 0, 'hi', 1)
    Aliases = {'a', 'b'}
    Mode = GearMode.Drive
  end
end
