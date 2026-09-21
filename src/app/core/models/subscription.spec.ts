import {
  TRIAL_DAYS,
  daysRemaining,
  defaultSubscription,
  isSubscriptionActive,
  subscriptionState,
  type Subscription,
} from './company.model';
import { addDays } from '../util/dates';

const TODAY = '2026-08-29';

function sub(paidUntil: string | null, plan: 'trial' | 'paid' = 'paid'): Subscription {
  return { paidUntil, plan, note: '' };
}

describe('subscription window', () => {
  it('opens a trial of the advertised length', () => {
    const created = defaultSubscription(TODAY);
    expect(created.plan).toBe('trial');
    expect(created.paidUntil).toBe(addDays(TODAY, TRIAL_DAYS));
    expect(daysRemaining(created, TODAY)).toBe(TRIAL_DAYS);
  });

  it('counts the final day as still paid', () => {
    // Someone paid until the 29th can work all of the 29th.
    expect(daysRemaining(sub(TODAY), TODAY)).toBe(0);
    expect(isSubscriptionActive(sub(TODAY), TODAY)).toBe(true);
    expect(subscriptionState(sub(TODAY), TODAY)).toBe('expiring');
  });

  it('lapses the day after', () => {
    expect(isSubscriptionActive(sub('2026-08-28'), TODAY)).toBe(false);
    expect(daysRemaining(sub('2026-08-28'), TODAY)).toBe(-1);
    expect(subscriptionState(sub('2026-08-28'), TODAY)).toBe('expired');
  });

  it('warns for the last week so a transfer has time to clear', () => {
    expect(subscriptionState(sub(addDays(TODAY, 7)), TODAY)).toBe('expiring');
    expect(subscriptionState(sub(addDays(TODAY, 8)), TODAY)).toBe('active');
  });

  it('keeps a running trial labelled as a trial', () => {
    expect(subscriptionState(sub(addDays(TODAY, 20), 'trial'), TODAY)).toBe('trial');
    expect(subscriptionState(sub(addDays(TODAY, 20), 'paid'), TODAY)).toBe('active');
  });

  it('separates "never configured" from "lapsed"', () => {
    // A company predating subscriptions is grandfathered by the rules; calling
    // it expired in the admin list would accuse a working account.
    expect(subscriptionState(undefined, TODAY)).toBe('none');
    expect(subscriptionState(sub(null), TODAY)).toBe('none');
    expect(subscriptionState(sub('2020-01-01'), TODAY)).toBe('expired');
  });

  it('fails closed on missing or malformed dates', () => {
    // Never "today by accident" — an unreadable value must not grant access.
    expect(isSubscriptionActive(sub(null), TODAY)).toBe(false);
    expect(isSubscriptionActive(sub('не е датум'), TODAY)).toBe(false);
    expect(isSubscriptionActive(undefined, TODAY)).toBe(false);
    expect(subscriptionState(sub('29.08.2026'), TODAY)).toBe('expired');
  });

  it('survives a year boundary', () => {
    expect(daysRemaining(sub('2027-01-01'), '2026-12-31')).toBe(1);
    expect(isSubscriptionActive(sub('2026-12-31'), '2027-01-01')).toBe(false);
  });
});
