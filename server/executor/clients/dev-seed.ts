/**
 * Seeds the in-memory fakes with the external objects the design's sample tickets refer to, so the
 * dev server (no credentials) can approve #4824, #4809, #4822 and retry #4820 end to end.
 */
import type { FakeAuthAdmin } from './auth-admin'
import type { FakeInstaradar } from './instaradar-fake'
import type { FakeLinear } from './linear-fake'
import type { FakeStripe } from './stripe-fake'

export function seedDesignFakes(fakes: {
  stripe?: FakeStripe
  linear?: FakeLinear
  instaradar?: FakeInstaradar
  authAdmin?: FakeAuthAdmin
}): void {
  const day = 86_400
  const now = Math.floor(Date.now() / 1000)
  const oct14 = Math.floor(Date.UTC(2026, 9, 14) / 1000)
  if (fakes.stripe) {
    const s = fakes.stripe
    // #4824 Tom Becker · cancellation only
    s.seedCustomer({
      customer: 'cus_TBecker0203',
      subscription: 'sub_1PzT8c',
      paymentIntent: 'pi_tom_sep14',
      charge: 'ch_tom_sep14',
      amount: 799,
      currentPeriodEnd: oct14,
      created: now - 13 * day,
    })
    // #4822 Marco Bianchi · refund stage 1
    s.seedCustomer({
      customer: 'cus_MBianchi8820',
      subscription: 'sub_1QfA7y',
      paymentIntent: 'pi_3QfA7x',
      charge: 'ch_3QfA7x',
      amount: 1307,
      created: now - 12 * day,
    })
    // #4809 Daniel Okafor · refund stage 2
    s.seedCustomer({
      customer: 'cus_DOkafor2291',
      subscription: 'sub_1Qd2Ln',
      paymentIntent: 'pi_3Qd2Lm',
      charge: 'ch_3Qd2Lm',
      amount: 1307,
      created: now - 18 * day,
    })
    // #4819 Jonas Weber, #4820 Priya Nair, #4801 Kate Morgan · active customers
    s.seedCustomer({
      customer: 'cus_JWeber3310',
      subscription: 'sub_jweber',
      paymentIntent: 'pi_jweber_sep3',
      charge: 'ch_jweber_sep3',
      amount: 499,
      created: now - 24 * day,
    })
    s.seedCustomer({
      customer: 'cus_PNair1009',
      subscription: 'sub_pnair',
      paymentIntent: 'pi_pnair_nov2',
      charge: 'ch_pnair_nov2',
      amount: 17_900,
      created: now - 329 * day,
    })
    s.seedCustomer({
      customer: 'cus_KMorgan5540',
      subscription: 'sub_kmorgan',
      paymentIntent: 'pi_kmorgan_sep21',
      charge: 'ch_kmorgan_sep21',
      amount: 799,
      created: now - 6 * day,
    })
    s.addInvoice({
      id: 'in_1Qa9Xz',
      customer: 'cus_KMorgan5540',
      subscription: 'sub_kmorgan',
      status: 'paid',
      autoAdvance: false,
      amountDue: 799,
      attemptCount: 2,
      number: 'IR-2026-0821',
    })
  }
  if (fakes.linear) {
    fakes.linear.addIssue({
      identifier: 'INS-198',
      title: 'False “post deleted” alerts when Instagram CDN returns 404',
      description: 'Open, 3 reports.',
    })
    fakes.linear.addIssue({ identifier: 'INS-209', title: 'Dark mode' })
    fakes.linear.addIssue({ identifier: 'INS-214', title: 'Weekly PDF report of follower changes' })
    fakes.linear.addIssue({ identifier: 'INS-215', title: 'Date and time in file names' })
  }
  if (fakes.instaradar) {
    const ir = fakes.instaradar
    for (const [user, handles] of [
      ['usr_tbecker_71c0', ['berlin.eats', 'tb.runs']],
      ['usr_mbianchi_9e11', ['marcobianchi', 'trattoria.nonna', 'mb.photo', 'fc.lecco']],
      ['usr_dokafor_44b2', ['okafor.designs', 'lagos.lens']],
      ['usr_pnair_0b7d', ['studio.kolo', 'kolo.ceramics', 'priya.makes']],
      ['usr_jweber_5a2c', ['weber.woodworks']],
      ['usr_kmorgan_c1e8', ['kate.morgan.art']],
    ] as const) {
      ir.addUser(user, { tracked_profiles: handles.length, profiles: 1 })
      for (const h of handles) ir.track(h, user)
    }
  }
  if (fakes.authAdmin) {
    fakes.authAdmin.addUser('usr_tbecker_71c0', 'tom.becker@web.de')
    fakes.authAdmin.addUser('usr_mbianchi_9e11', 'marco.bianchi@libero.it')
    fakes.authAdmin.addUser('usr_dokafor_44b2', 'd.okafor@proton.me')
    fakes.authAdmin.addUser('usr_pnair_0b7d', 'priya.nair@gmail.com')
    fakes.authAdmin.addUser('usr_jweber_5a2c', 'jonas.weber@gmx.net')
    fakes.authAdmin.addUser('usr_kmorgan_c1e8', 'kate.morgan@yahoo.com')
  }
}
