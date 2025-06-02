import {useEffect, useRef} from 'preact/hooks';

export function useWheelEvent<T extends HTMLElement>(
  handler: (event: WheelEvent) => void,
  preventDefault = true,
) {
  const ref = useRef<T>(null);
  
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const wheelHandler = (event: WheelEvent) => {
      handler(event);
    };

    // Explicitly set passive to false since we may call preventDefault
    element.addEventListener('wheel', wheelHandler, { 
      passive: !preventDefault 
    });

    return () => {
      element.removeEventListener('wheel', wheelHandler);
    };
  }, [handler, preventDefault]);

  return ref;
} 