/**
 * Fix for passive wheel event listener warning
 * This ensures that wheel events that need to call preventDefault 
 * are properly marked as non-passive
 */
export function fixPassiveWheelEvents() {
  // Override addEventListener to properly handle wheel events
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  
  EventTarget.prototype.addEventListener = function(
    type: string,
    listener: any,
    options?: boolean | AddEventListenerOptions
  ) {
    if (type === 'wheel') {
      // If options is not specified or is a boolean, convert to object
      let eventOptions: AddEventListenerOptions;
      
      if (typeof options === 'boolean') {
        eventOptions = { capture: options, passive: false };
      } else if (options && typeof options === 'object') {
        // If passive is not explicitly set for wheel events, default to false
        eventOptions = { ...options, passive: options.passive ?? false };
      } else {
        eventOptions = { passive: false };
      }
      
      return originalAddEventListener.call(this, type, listener, eventOptions);
    }
    
    return originalAddEventListener.call(this, type, listener, options);
  };
}

/**
 * Initialize the wheel event fix
 * Call this early in your application lifecycle
 */
export function initializeWheelEventFix() {
  if (typeof window !== 'undefined') {
    fixPassiveWheelEvents();
  }
} 