import type { Invoice } from '../models/invoice.model';
import {
  mailtoHref,
  pdfFileName,
  shareBody,
  shareSubject,
  toInternationalPhone,
  viberHref,
  whatsappHref,
} from './share';

/** Just enough of an invoice for the message composer. */
function invoiceFixture(overrides: Record<string, unknown> = {}): Invoice {
  return {
    number: '0002/2026',
    issueDate: '2026-08-29',
    dueDate: '2026-09-05',
    currency: 'MKD',
    totals: { finalAmount: 6100 },
    seller: {
      name: 'ДОДИ ТЕК ДООЕЛ',
      bankAccount: { bankName: 'СТОПАНСКА БАНКА АД СКОПЈЕ', accountNumber: '200004007076491' },
    },
    client: { name: 'МАИСОН ДЕ ПАРФУМ ДООЕЛ', email: '', phone: '', contactPerson: '' },
    ...overrides,
  } as unknown as Invoice;
}

describe('share message', () => {
  it('names the seller in the subject', () => {
    expect(shareSubject(invoiceFixture())).toBe('Фактура 0002/2026 — ДОДИ ТЕК ДООЕЛ');
  });

  it('falls back to "нацрт" when there is no number yet', () => {
    expect(shareSubject(invoiceFixture({ number: '' }))).toContain('нацрт');
  });

  it('carries the amount, deadline and account so the buyer can pay from it', () => {
    const body = shareBody(invoiceFixture());
    // Macedonian separators, not en-US ones.
    expect(body).toContain('6.100,00 MKD');
    expect(body).toContain('05.09.2026');
    expect(body).toContain('200004007076491');
    expect(body).toContain('ДОДИ ТЕК ДООЕЛ');
  });

  it('greets the contact person when one is known', () => {
    const body = shareBody(invoiceFixture({
      client: { name: 'МАИСОН', email: '', phone: '', contactPerson: 'Марија' },
    }));
    expect(body.startsWith('Почитувани Марија,')).toBe(true);
  });

  it('omits the account line when no bank is set', () => {
    const body = shareBody(invoiceFixture({
      seller: { name: 'ДОДИ ТЕК ДООЕЛ', bankAccount: null },
    }));
    expect(body).not.toContain('Сметка:');
  });
});

describe('PDF file name', () => {
  it('is the seller and the invoice number', () => {
    expect(pdfFileName(invoiceFixture())).toBe('ДОДИ ТЕК ДООЕЛ - 0002-2026');
  });

  it('turns every slash in the number into a hyphen', () => {
    expect(pdfFileName(invoiceFixture({ number: 'ФА/08/2026/0007' }))).toBe(
      'ДОДИ ТЕК ДООЕЛ - ФА-08-2026-0007',
    );
  });

  it('names a draft as such rather than leaving a dangling separator', () => {
    expect(pdfFileName(invoiceFixture({ number: '' }))).toBe('ДОДИ ТЕК ДООЕЛ - нацрт');
  });

  it('drops quotes and replaces characters Windows forbids', () => {
    const seller = { name: 'ТРГОВИЈА „СОНЦЕ“ ДОО: СКОПЈЕ', bankAccount: null };
    expect(pdfFileName(invoiceFixture({ seller }))).toBe('ТРГОВИЈА СОНЦЕ ДОО- СКОПЈЕ - 0002-2026');
  });
});

describe('phone normalisation', () => {
  it('expands a national number to the country code', () => {
    expect(toInternationalPhone('070 302 376')).toBe('38970302376');
  });

  it('keeps an already international number', () => {
    expect(toInternationalPhone('+389 70 302376')).toBe('38970302376');
  });

  it('strips the 00 international prefix', () => {
    expect(toInternationalPhone('0038970302376')).toBe('38970302376');
  });

  it('rejects anything too short to be a number', () => {
    expect(toInternationalPhone('123')).toBeNull();
    expect(toInternationalPhone('')).toBeNull();
  });
});

describe('channel links', () => {
  it('encodes subject and body into a mailto', () => {
    const href = mailtoHref('kupuvac@example.mk', 'Фактура 1', 'Здраво\nсвет');
    expect(href.startsWith('mailto:kupuvac%40example.mk?')).toBe(true);
    expect(href).toContain('subject=' + encodeURIComponent('Фактура 1'));
    expect(href).toContain(encodeURIComponent('Здраво\nсвет'));
  });

  it('addresses wa.me when a phone is known and omits it otherwise', () => {
    expect(whatsappHref('здраво', '070302376')).toContain('wa.me/38970302376?text=');
    expect(whatsappHref('здраво', '')).toContain('wa.me/?text=');
  });

  it('builds a viber forward link', () => {
    expect(viberHref('здраво')).toBe('viber://forward?text=' + encodeURIComponent('здраво'));
  });
});
