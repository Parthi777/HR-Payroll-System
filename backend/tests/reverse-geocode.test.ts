import { describe, expect, it } from 'vitest';
import { cacheKey, formatAddress } from '../src/services/geofence/reverse-geocode.service.js';

// The address line shown under each person on the Live Tracking page.

describe('formatAddress', () => {
  it('reads most specific first: number, road, area, town', () => {
    expect(
      formatAddress({ house_number: '12', road: 'Bhavani Main Road', suburb: 'Kavindapadi', town: 'Erode', state: 'Tamil Nadu' }),
    ).toBe('12, Bhavani Main Road, Kavindapadi, Erode');
  });

  it('leads with a named place when there is one', () => {
    expect(formatAddress({ shop: 'Dharani TVS', road: 'Salem Road', city: 'Erode' })).toBe('Dharani TVS, Salem Road, Erode');
  });

  it('does not repeat a name that fills two roles', () => {
    expect(formatAddress({ road: 'NH544', village: 'Chithode', county: 'Chithode' })).toBe('NH544, Chithode');
  });

  it('falls back to the first parts of the display name', () => {
    expect(formatAddress({ state: 'Tamil Nadu' }, 'Unnamed Road, Kalingarayanpalayam, Bhavani, Erode, Tamil Nadu, India'))
      .toBe('Unnamed Road, Kalingarayanpalayam, Bhavani, Erode');
  });

  it('leaves postcodes and the country out of the fallback', () => {
    expect(formatAddress(undefined, 'Bhavani, Erode, Tamil Nadu, 638300, India')).toBe('Bhavani, Erode, Tamil Nadu');
  });

  it('says nothing rather than something wrong', () => {
    expect(formatAddress(undefined)).toBeNull();
  });
});

describe('cacheKey', () => {
  it('treats points ~10 m apart as the same place, and ~200 m apart as different', () => {
    expect(cacheKey(11.58414, 77.727966)).toBe(cacheKey(11.58421, 77.72801));
    expect(cacheKey(11.58414, 77.727966)).not.toBe(cacheKey(11.58614, 77.727966));
  });
});
