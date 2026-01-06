export function threadable(customName?: string): MethodDecorator {
  return function (
    _: unknown,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) {
    const value = descriptor?.value;

    // In some bundled environments (like CRA + certain babel runtimes),
    // touching prototype.name can throw (non‑writable / non‑configurable),
    // which used to surface as a hard runtime error.
    if (typeof value === 'function' && value.prototype) {
      const prototype: any = value.prototype;

      try {
        const nameDescriptor = Object.getOwnPropertyDescriptor(
          prototype,
          'name',
        );

        // Only try to overwrite the name if it is writable or not defined at all.
        if (!nameDescriptor || nameDescriptor.writable) {
          prototype.name = customName ?? propertyKey;
        }
      } catch {
        // If anything goes wrong (frozen prototype, non‑writable name, etc.),
        // we silently ignore it instead of crashing the app.
      }

      // Mark the function as threadable regardless of whether we managed
      // to override the name. This is what the rest of the system relies on.
      prototype.threadable = true;
    }
  };
}
