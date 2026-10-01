classdef GearMode < Simulink.IntEnumType
  % A CUSTOM enumeration, used three ways by make_class_fixtures.m: as a property
  % value on a custom class, as a property value on a Simulink.Parameter subclass,
  % and as a dictionary entry value in its own right.
  %
  % The corpus had no custom enum before this. It matters because an enum is the one
  % value whose serialization is not inferable from its class name — MATLAB writes it
  % with the IsEnum / EnumerationName / EnumerationType attributes, three of the
  % fourteen attributes DictionaryXmlFast interns that no fixture here exercised.
  %
  % Reverse is deliberately NEGATIVE: the underlying storage is int32, and a minus
  % sign is the one character in an enum's serialized text that a scanner reading
  % digits could get wrong.
  enumeration
    Park(0)
    Drive(1)
    Reverse(-1)
  end
end
