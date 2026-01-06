export function setTaskName(task: Generator, source: Generator | string): void {
  const prototype = Object.getPrototypeOf(task);
  if (prototype && !(prototype as any).threadable) {
    (prototype as any).threadable = true;

    try {
      const resolvedName =
        typeof source === 'string' ? source : getTaskName(source);

      const nameDescriptor = Object.getOwnPropertyDescriptor(
        prototype,
        'name',
      );

      if (!nameDescriptor || nameDescriptor.writable) {
        (prototype as any).name = resolvedName;
      }
    } catch {
      // Same rationale as in the threadable decorator: if the runtime
      // doesn't allow changing prototype.name (or the value is frozen),
      // we don't want to crash user apps – we simply skip renaming.
    }
  }
}

export function getTaskName(task: Generator): string {
  return Object.getPrototypeOf(task).name ?? null;
}
