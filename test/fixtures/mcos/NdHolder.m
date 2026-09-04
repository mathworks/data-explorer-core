classdef NdHolder
  % The authoring class for ndNested.mat: one property holding a RANK-3 object
  % array, which nothing else in the corpus has. Written by MATLAB R2027a as
  %
  %   h = NdHolder;
  %   h.Kids = reshape(arrayfun(@(k) Simulink.Parameter(k), 1:12), [2 3 2]);
  %   save('ndNested.mat', 'h');
  %
  % MATLAB reports size(h.Kids) as [2 3 2] and h.Kids(:) as Values 1..12, so the
  % element list in the file is column-major. A Bus's Elements_internal — the only
  % other nested object array here — is always Nx1, which cannot see a rank
  % truncation.
  properties
    Kids                      % 2x3x2 Simulink.Parameter
    Tag = 'h'
  end
end
