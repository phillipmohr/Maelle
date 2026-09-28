import type { ActionHandler } from '../types'

/**
 * Safety: the Instagram profile can no longer be tracked or viewed on InstaRadar. Existing tracking
 * by all users stops and re-adding is blocked through the InstaRadar blocklist.
 */
export const removeFromTracking: ActionHandler<'remove_from_tracking'> = {
  type: 'remove_from_tracking',
  consequence: 'the profile was not blocked',
  async run(params, ctx) {
    const r = await ctx.clients.instaradar.blockProfile(
      params.instagramHandle,
      params.reason,
      `Maelle ticket #${ctx.ticket.displayNumber}`,
    )
    return {
      result: {
        handle: r.handle,
        blockedForTracking: true,
        blockedForViewing: true,
        alreadyBlocked: r.alreadyBlocked,
        trackingStopped: r.trackingStopped,
      },
    }
  },
}
