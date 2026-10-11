// Narrow correction for @scriptc/compiler 0.2.8: ArrayOwnership eagerly invokes
// dynamicViewKeys, but the callback's bindings are initialized after construction.
// Apply through a Node module load hook; never edit the installed dependency.
export function fixScriptcArrayOwnership(source) {
  const startMarker = '        const ownership = new ArrayOwnership(sourceFiles, {';
  const endMarker = '        let dynamicViews = null;';
  const nextMarker = '        const elementStates = new ArrayElementStates({';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  const next = source.indexOf(nextMarker, end);
  if (start < 0 || end < start || next < end || source.indexOf(startMarker, start + 1) !== -1) {
    throw new Error('Unexpected ScriptC 0.2.8 ArrayOwnership initializer; refusing to apply the compiler fix.');
  }
  const constructor = source.slice(start, end);
  const collectors = source.slice(end, next);
  if (!constructor.includes('dynamicViewKeys: () => (dynamicViews ??= collectDynamicViews())') ||
      !collectors.includes('const collectDynamicViews = () => {')) {
    throw new Error('Unexpected ScriptC dynamic-view collector; refusing to apply the compiler fix.');
  }
  return source.slice(0, start) + collectors + constructor + source.slice(next);
}
