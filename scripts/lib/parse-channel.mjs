// One `--channel` parser for the whole release toolchain.
//
// Five scripts each hand-rolled this. Four of them used the same one-liner —
// `argv.includes('--channel') ? argv[argv.indexOf('--channel') + 1] : 'public'` —
// which silently yields `undefined` for a trailing `--channel`, and happily
// accepts `--channel prod`, `--channel Public` or `--channel --force`. A typo in
// a release command therefore selected an unknown channel rather than failing.
// Here the value must be exactly one of the known channels, present, and not
// another flag.

export const CHANNELS = Object.freeze(['public', 'qa'])
export const DEFAULT_CHANNEL = 'public'

export class ChannelArgError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ChannelArgError'
    this.code = 'CHANNEL_ARG_INVALID'
  }
}

/**
 * @param {string[]} argv            arguments after the script name (process.argv.slice(2))
 * @param {object}   [options]
 * @param {string}   [options.defaultChannel='public'] used when no --channel is given
 * @param {boolean}  [options.allowShorthand=false]    also accept a bare `--qa`
 * @returns {'public'|'qa'}
 */
export function parseChannel(argv = process.argv.slice(2), { defaultChannel = DEFAULT_CHANNEL, allowShorthand = false } = {}) {
  const args = Array.isArray(argv) ? argv.map(String) : []
  let channel = null

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    let value
    if (arg === '--channel') {
      value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new ChannelArgError(`--channel requires a value (${CHANNELS.join('|')})`)
      }
      i += 1
    } else if (allowShorthand && arg.startsWith('--') && CHANNELS.includes(arg.slice(2))) {
      value = arg.slice(2)
    } else {
      continue
    }
    if (!CHANNELS.includes(value)) {
      throw new ChannelArgError(`unknown channel ${JSON.stringify(value)}; expected ${CHANNELS.join('|')}`)
    }
    if (channel && channel !== value) {
      throw new ChannelArgError(`conflicting channel arguments: ${channel} and ${value}`)
    }
    channel = value
  }

  if (!channel) {
    if (!CHANNELS.includes(defaultChannel)) {
      throw new ChannelArgError(`invalid default channel ${JSON.stringify(defaultChannel)}`)
    }
    return defaultChannel
  }
  return channel
}
