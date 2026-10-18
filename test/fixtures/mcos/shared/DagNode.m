classdef DagNode < handle
  % The authoring class for make_dag_fixtures.m: a HANDLE, so a node assigned to two
  % places is one object, and `save` writes it once and points at it from both.
  properties
    Kids                      % 1x2 DagNode, the same handle twice; [] in the leaf
    Tag = 0
  end
end
