/**
 * A dealer's messages go out from that dealer's own WhatsApp account.
 *
 * `TenantSettings.whatsappMode` has existed since the tenancy work and nothing
 * read it, so every dealer sent from the platform's number whatever it said.
 * That is the same shape of bug as the shared Drive folder: a dealer's staff
 * messaged from a stranger's number reply into a stranger's inbox.
 *
 * SHARED is the default and must stay exactly as it was — a single-dealer
 * deployment behaves identically — so that is pinned here too.
 */
import { describe, expect, it } from 'vitest';
import { tenantSender } from '../src/services/whatsapp/whatsapp.service.js';

const OWN_META = { provider: 'meta', token: 't0ken', phoneId: '12345' };

describe('which WhatsApp account a dealer sends from', () => {
  it('uses the shared platform number by default', () => {
    expect(tenantSender({ whatsappMode: 'SHARED', whatsappConfig: null })).toBeNull();
  });

  it('ignores a config left behind on a dealer that is back on SHARED', () => {
    // Switching back to the shared number must actually switch, rather than
    // keep sending from credentials nobody can see on the settings screen.
    expect(tenantSender({ whatsappMode: 'SHARED', whatsappConfig: OWN_META })).toBeNull();
  });

  it('uses the dealer’s own account when it has one', () => {
    const sender = tenantSender({ whatsappMode: 'OWN', whatsappConfig: OWN_META });
    expect(sender).toEqual({ provider: 'meta', creds: OWN_META });
  });

  it('keeps two dealers’ accounts apart', () => {
    const one = tenantSender({ whatsappMode: 'OWN', whatsappConfig: { provider: 'meta', token: 'a', phoneId: '111' } });
    const two = tenantSender({ whatsappMode: 'OWN', whatsappConfig: { provider: 'meta', token: 'b', phoneId: '222' } });
    expect(one!.creds.phoneId).toBe('111');
    expect(two!.creds.phoneId).toBe('222');
  });

  it('falls back to the shared number when OWN has no config at all', () => {
    expect(tenantSender({ whatsappMode: 'OWN', whatsappConfig: null })).toBeNull();
  });

  it('falls back when the provider name is not one we can send with', () => {
    expect(tenantSender({ whatsappMode: 'OWN', whatsappConfig: { provider: 'carrier-pigeon', token: 'x' } })).toBeNull();
  });

  it('carries each provider’s own credentials through', () => {
    const twilio = tenantSender({
      whatsappMode: 'OWN',
      whatsappConfig: { provider: 'twilio', accountSid: 'AC1', authToken: 's3cret', from: 'whatsapp:+1' },
    });
    expect(twilio!.provider).toBe('twilio');
    expect(twilio!.creds.from).toBe('whatsapp:+1');

    const wati = tenantSender({
      whatsappMode: 'OWN',
      whatsappConfig: { provider: 'wati', apiUrl: 'https://wati.example', apiToken: 'tok' },
    });
    expect(wati!.provider).toBe('wati');
    expect(wati!.creds.apiUrl).toBe('https://wati.example');
  });
});
