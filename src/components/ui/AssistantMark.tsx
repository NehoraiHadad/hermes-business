// Compact assistant/product mark: the friendly speech-bubble face from the
// generated app icon (assets/app-icon.svg → build/icon.ico). Rendered as vector
// so it stays crisp and recognisable even at the 25px chat avatar size, unlike
// the abstract brand Logo it replaces. The SVG scales to fill its container.
export function AssistantMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="העוזר"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="48" y="48" width="928" height="928" rx="264" fill="#5C5BA8" />
      <path
        d="M246 285h532c58 0 105 47 105 105v254c0 58-47 105-105 105H500L318 866V749h-72c-58 0-105-47-105-105V390c0-58 47-105 105-105Z"
        fill="#FFF"
      />
      <circle cx="386" cy="518" r="42" fill="#5C5BA8" />
      <circle cx="638" cy="518" r="42" fill="#5C5BA8" />
      <path d="M780 182l20 54 54 20-54 20-20 54-20-54-54-20 54-20 20-54Z" fill="#F4C86A" />
    </svg>
  )
}
