function probe_description_isprop()
% Copyright 2026 The MathWorks, Inc.
% Whether an object of each class the test fixtures hold has a Description: MATLAB's
% isprop(obj, 'Description'), with the fixtures' own class definitions on the path
% (test/descriptionApplies.test.ts, src/datamodel/node/descriptionClasses.ts). A class MATLAB
% cannot make with no argument answers by its metaclass's property list; one it cannot load prints
% NOCLASS, and the test answers for it from the object's stored bag. Run (one line):
%
%   mw -using Bmain matlab -nodesktop -batch "cd('<this folder>'); probe_description_isprop"
%
% Measured with MATLAB R2027a on 2026-10-24.
root = fullfile(fileparts(mfilename('fullpath')), '..', '..', 'fixtures');
addpath(fullfile(root, 'mcos')); addpath(fullfile(root, 'mcos', 'shared')); addpath(fullfile(root, 'sparse')); addpath(fullfile(root, 'display'));
addpath(fullfile(root, 'subclasses'));
cls = {'Simulink.AliasType','Simulink.Breakpoint','Simulink.Bus','Simulink.BusElement','Simulink.CoderInfo','Simulink.ConfigSet', ...
  'Simulink.ConnectionBus','Simulink.ConnectionElement','Simulink.FunctionElement','Simulink.LoggingInfo','Simulink.LookupTable', ...
  'Simulink.NumericType','Simulink.Parameter','Simulink.ServiceBus','Simulink.Signal','Simulink.ValueType','Simulink.VariableUsage', ...
  'Simulink.VariantBank','Simulink.VariantBankCoderInfo','Simulink.VariantControl','Simulink.VariantExpression','Simulink.VariantVariable', ...
  'Simulink.data.dictionary.EnumTypeDefinition','SimulinkCSC.AttribClass_Simulink_Default','mpt.Parameter','mpt.Signal', ...
  'Simulink.ConfigSetRef','Simulink.SolverCC','Simulink.LookupTable','Simulink.lookuptable.StructTypeInfo','Simulink.lookuptable.Breakpoint', ...
  'Simulink.lookuptable.Table','Simulink.ServiceElement', ...
  'DagNode','DispLevel','DispWidget','dexsparse.FhHolder','dexsparse.HolderAlias','dexsparse.FhAlias','dexsparse.NumAlias','MyEngine','NdHolder', ...
  'ComplexHolder','Widget','GearMode','WidgetPart','MyGadget','dexdata.DerivedSignal','dexdata.DerivedParam', ...
  'DispColor','Engine','Fleet','Garage','Vehicle','Level1','Level2','Level3','ProbeH','CesP','DynP','DexHue','TbColor','dProbeColors', ...
  'matlab.lang.OnOffSwitchState','containers.Map','datetime','Simulink.VariantConfigurations', ...
  'dexsub.Alias','dexsub.Num','dexsub.VT','dexsub.Bus','dexsub.Param','dexsub.Sig'};
for k = 1:numel(cls)
  c = cls{k};
  try
    mc = meta.class.fromName(c);
    if isempty(mc)
      fprintf('RESULT %s NOCLASS\n', c);
      continue
    end
    if mc.Enumeration
      e = enumeration(c);
      obj = e(1);
    else
      obj = feval(c);
    end
    fprintf('RESULT %s isprop=%d class=%s\n', c, isprop(obj, 'Description'), class(obj));
  catch err
    % A class MATLAB knows but cannot make with no argument: its property list says it.
    try
      mc = meta.class.fromName(c);
      has = any(strcmp({mc.PropertyList.Name}, 'Description'));
      fprintf('RESULT %s metaclass Description=%d (%s)\n', c, has, err.message);
    catch err2
      fprintf('RESULT %s ERROR %s\n', c, err.message);
    end
  end
end
vals = {1, single(1), int8(1), int16(1), int32(1), int64(1), uint8(1), uint16(1), uint32(1), uint64(1), true, 'a', "s", struct('a', 1), {1}, @sin, table(1), categorical({'a'})};
for k = 1:numel(vals)
  v = vals{k};
  fprintf('RESULT value %s isprop=%d\n', class(v), isprop(v, 'Description'));
end
try
  f = fi(1);
  fprintf('RESULT value %s isprop=%d\n', class(f), isprop(f, 'Description'));
catch err
  fprintf('RESULT value fi ERROR %s\n', err.message);
end
end
