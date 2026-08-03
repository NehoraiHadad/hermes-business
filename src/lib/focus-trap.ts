// Dependency-free focus-trap helpers used by Modal. The DOM-touching parts
// (querying focusable elements, calling .focus()) stay thin wrappers so the
// actual cycling DECISION — which index Tab/Shift+Tab should land on — is a
// plain, unit-testable function with no DOM involved.

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function queryFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

// Pure: given how many focusable elements a dialog has and which index (if any,
// -1 otherwise) currently holds focus, compute the index Tab/Shift+Tab should
// move to. Wraps at both ends so focus can never escape the dialog while it's
// open, and never throws for the empty/negative-index edge cases a real dialog
// can hit (e.g. focus briefly outside the tracked set).
export function nextFocusIndex(count: number, currentIndex: number, shiftKey: boolean): number {
  if (count <= 0) return -1
  if (shiftKey) {
    if (currentIndex <= 0) return count - 1
    return currentIndex - 1
  }
  if (currentIndex < 0 || currentIndex >= count - 1) return 0
  return currentIndex + 1
}
