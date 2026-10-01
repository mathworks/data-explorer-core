classdef DerivedSignal < Simulink.Signal
  % The Signal half of the derived-class pair (see DerivedParam for the argument, and
  % for why both are in the +dexdata package rather than beside Widget.m).
  % Separate from DerivedParam because Simulink.Parameter and Simulink.Signal are
  % different classes with different property sets and different data-model nodes, and
  % a fixture that only subclassed one would leave the other's path unmeasured.
  %
  % Priority is int32 on purpose: a typed integer property is written with
  % Class="int32", so the derived class also pins that an extra property keeps its
  % MATLAB type rather than widening to double on the way through XML.
  properties
    Routing = 'bus'
    Priority = int32(5)
  end
end
