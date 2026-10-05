import type { PdfFileNaming } from '../models/company.model';
import type { Invoice } from '../models/invoice.model';
import { formatDate } from './dates';
import { formatAmount } from './money';

/**
 * Composing and addressing the message that accompanies an invoice.
 *
 * Everything here is a pure string function so the wording can be tested and
 * so the dialog stays a thin shell over it. Note the deliberate absence of any
 * PDF work: a browser tab cannot attach a file to a `mailto:` or to a WhatsApp
 * web intent, so the message carries the facts the buyer needs to pay — number,
 * amount, deadline, account — and the document itself goes as an attachment the
 * sender adds, or through the native share sheet on a phone.
 */

/**
 * What "Save as PDF" names the file: `ДОДИ ТЕК ДООЕЛ - 0002-2026`.
 *
 * Whose name comes first is the company's choice (Поставки → Печатење). The
 * company's own name suits whoever receives the file; the buyer's suits a
 * company filing its own copies, where its own name on every file tells it
 * nothing. A draft with no buyer yet falls back to the company's name.
 *
 * Browsers take the default file name from the page title, so the editor puts
 * this in the title for the duration of the print.
 */
export function pdfFileName(invoice: Invoice, naming: PdfFileNaming = 'seller'): string {
  const buyer = invoice.client.name.trim();
  return composePdfFileName(naming === 'buyer' && buyer ? buyer : invoice.seller.name, invoice.number);
}

/**
 * `<name> - <number>`, made safe for a file name. The slash in the invoice
 * number becomes a hyphen, and so does anything else Windows refuses in a file
 * name — left in, the browser substitutes its own character or cuts the name
 * short at that point. Quotes around a trading name („...“) are dropped, not
 * replaced, because a hyphen there reads as a separator.
 */
export function composePdfFileName(name: string, number: string): string {
  const party = name.replace(/["„“”«»]/g, '').replace(/[\\/:*?<>|]/g, '-');
  const safeNumber = (number || 'нацрт').replace(/[\\/:*?"<>|]/g, '-');
  return `${party} - ${safeNumber}`.replace(/\s+/g, ' ').trim();
}

/** Subject line for the e-mail channel. */
export function shareSubject(invoice: Invoice): string {
  const number = invoice.number || 'нацрт';
  return `Фактура ${number} — ${invoice.seller.name}`;
}

/**
 * The body. Kept short enough to survive as a WhatsApp or Viber message while
 * still being a complete payment instruction.
 */
export function shareBody(invoice: Invoice): string {
  const lines: string[] = [];
  const greeting = invoice.client.contactPerson || invoice.client.name;

  lines.push(greeting ? `Почитувани ${greeting},` : 'Почитувани,');
  lines.push('');
  lines.push(
    invoice.number
      ? `Во прилог е фактура бр. ${invoice.number} од ${formatDate(invoice.issueDate)}.`
      : `Во прилог е фактура од ${formatDate(invoice.issueDate)}.`,
  );
  lines.push('');
  lines.push(`Износ за плаќање: ${formatAmount(invoice.totals.finalAmount)} ${invoice.currency}`);
  lines.push(`Рок на плаќање: ${formatDate(invoice.dueDate)}`);

  const bank = invoice.seller.bankAccount;
  if (bank?.accountNumber) {
    lines.push(
      `Сметка: ${bank.accountNumber}${bank.bankName ? ` (${bank.bankName})` : ''}`,
    );
  }

  lines.push('');
  lines.push('Со почит,');
  lines.push(invoice.seller.name);

  return lines.join('\n');
}

/**
 * Normalises a Macedonian phone number to the digits-only international form
 * WhatsApp and Viber expect: `070 302 376` and `+389 70 302376` both become
 * `38970302376`. Returns null when there is nothing usable, so the caller can
 * fall back to a share without a recipient.
 */
export function toInternationalPhone(raw: string, countryCode = '389'): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 6) return null;

  // Already international.
  if (digits.startsWith(countryCode)) return digits;
  // 00389... — the other way of writing a leading +.
  if (digits.startsWith(`00${countryCode}`)) return digits.slice(2);
  // National form: a single leading 0 stands in for the country code.
  if (digits.startsWith('0')) return countryCode + digits.slice(1);

  return countryCode + digits;
}

export function mailtoHref(to: string, subject: string, body: string): string {
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(to)}?${query}`;
}

/**
 * `wa.me` opens the app on a phone and WhatsApp Web on a desktop. Without a
 * number it opens the contact picker, which is the sensible fallback when the
 * client record has no phone.
 */
export function whatsappHref(text: string, phone?: string | null): string {
  const target = phone ? toInternationalPhone(phone) : null;
  return `https://wa.me/${target ?? ''}?text=${encodeURIComponent(text)}`;
}

/**
 * Viber has no addressed web intent that works across platforms; `forward`
 * opens the app with the text ready and lets the sender pick the chat.
 */
export function viberHref(text: string): string {
  return `viber://forward?text=${encodeURIComponent(text)}`;
}
