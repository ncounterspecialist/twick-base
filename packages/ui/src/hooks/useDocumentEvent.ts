import {useEffect} from 'preact/hooks';

export function useDocumentEvent<T extends keyof DocumentEventMap>(
  type: T,
  listener: (this: Document, ev: DocumentEventMap[T]) => void,
  enabled = true,
  options: boolean | AddEventListenerOptions = false,
) {
  useEffect(() => {
    if (!enabled) return;
    document.addEventListener(type, listener, options);
    return () => document.removeEventListener(type, listener, options);
  }, [type, listener, enabled, options]);
}
