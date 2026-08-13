import { createContext } from 'react'

/**
 * The partner-feed "unseen since your last visit" count, published by the ONE
 * place that already owns it: FullAppShell holds the single usePartnerFeed
 * instance plus the FEED_SEEN_STORAGE_KEY marker, and computes the number the
 * Sidebar badge renders. The home screen's "מצב העסק" strip needs that same
 * number — and must not recompute it, because a second usePartnerFeed instance
 * would fire its own fetches and a second localStorage read could disagree with
 * the badge.
 *
 * Context rather than a prop because ChatScreen is not FullAppShell's child in
 * the JSX sense: App.tsx builds the <ChatScreen> element and hands it down as an
 * opaque `chatScreen: ReactNode` (through MainScreen, and to MiniShell). There
 * is no prop path from the value's owner to the consumer without turning that
 * node into a render prop across three components that have nothing else to do
 * with the feed.
 *
 * Default 0 = "nothing unseen to report" — the honest reading anywhere no
 * provider exists (MiniShell, isolated tests): the strip's activity card only
 * ever appears for a positive count, so the absent-provider case renders
 * nothing rather than a fabricated number.
 */
export const FeedUnseenContext = createContext(0)
