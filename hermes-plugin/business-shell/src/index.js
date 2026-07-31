import { PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, host } from '@hermes/plugin-sdk'
import { h } from './dom.js'
import { BusinessShell } from './shell.js'

// Entry module: the official Hermes Desktop plugin contract. It contributes a
// route, a sidebar entry and a command-palette action, all pointing at the
// business shell. This is the object bundled to plugin.js as the default export.
const ROUTE = '/business'

export default {
  id: 'business-shell',
  name: 'Hermes לעסק',
  defaultEnabled: true,
  register(ctx) {
    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        title: 'Hermes לעסק',
        data: { path: ROUTE },
        render: () => h(BusinessShell, { storage: ctx.storage })
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 10,
        data: { path: ROUTE, label: 'לעסק', codicon: 'briefcase' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'business.open',
          label: 'פתח את Hermes לעסק',
          keywords: ['business', 'עסק', 'פשוט'],
          run: () => host.navigate(ROUTE)
        }
      }
    ])
  }
}
