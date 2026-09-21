import type { Invoice } from '../models/invoice.model';
import { round2 } from '../util/money';
import type { CodebookSet } from './codebooks';
import { findIndicator } from './codebooks';
import { FIELD_LIMITS } from './ujp-document.builder';
import { computeInvoice } from './totals';

/**
 * Pre-flight validation.
 *
 * UJP answers a bad document with an error code and a field path, after the
 * user has already plugged in a smart card and typed a PIN. Everything that
 * can be caught locally is caught here instead, and surfaced in the editor
 * while the invoice is still a draft.
 *
 * `error` blocks submission. `warning` does not — it flags things that are
 * legal but probably not what the user meant (a truncated name, a VAT-exempt
 * indicator on a VAT-registered company).
 */

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** Dot path into the invoice, used to focus the offending control. */
  path: string;
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** True when nothing blocks submission. */
  canSubmit: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Macedonian ЕДБ: 13 digits. Foreign parties are checked more loosely. */
const MK_TIN = /^\d{13}$/;
const MK_POSTAL = /^\d{4}$/;

interface PartyInput {
  label: string;
  path: string;
  name: string;
  taxNumber: string;
  countryCode: string;
  street: string;
  streetNumber: string;
  postalCode: string;
  city: string;
}

function validateParty(party: PartyInput, push: (i: ValidationIssue) => void): void {
  const domestic = (party.countryCode || 'MK') === 'MK';

  if (!party.name.trim()) {
    push({ severity: 'error', path: `${party.path}.name`, message: `${party.label}: недостига назив.` });
  } else if (party.name.trim().length > FIELD_LIMITS.partyName) {
    push({
      severity: 'warning',
      path: `${party.path}.name`,
      message: `${party.label}: називот е подолг од ${FIELD_LIMITS.partyName} знаци и ќе биде скратен.`,
    });
  }

  const tin = party.taxNumber.trim();
  if (!tin) {
    push({
      severity: 'error',
      path: `${party.path}.taxNumber`,
      message: `${party.label}: недостига ЕДБ (даночен број).`,
    });
  } else if (domestic && !MK_TIN.test(tin)) {
    push({
      severity: 'error',
      path: `${party.path}.taxNumber`,
      message: `${party.label}: ЕДБ мора да има точно 13 цифри (внесено: ${tin.length}).`,
    });
  }

  if (!party.street.trim()) {
    push({
      severity: 'error',
      path: `${party.path}.address.streetAddress`,
      message: `${party.label}: недостига улица.`,
    });
  }
  if (!party.streetNumber.trim()) {
    push({
      severity: 'error',
      path: `${party.path}.address.streetNumber`,
      message: `${party.label}: недостига број на улица.`,
    });
  }
  if (!party.city.trim()) {
    push({
      severity: 'error',
      path: `${party.path}.address.city`,
      message: `${party.label}: недостига град.`,
    });
  }
  const postal = party.postalCode.trim();
  if (!postal) {
    push({
      severity: 'error',
      path: `${party.path}.address.postalCode`,
      message: `${party.label}: недостига поштенски број.`,
    });
  } else if (domestic && !MK_POSTAL.test(postal)) {
    push({
      severity: 'warning',
      path: `${party.path}.address.postalCode`,
      message: `${party.label}: поштенскиот број обично има 4 цифри (пр. 1000).`,
    });
  }
}

export function validateInvoice(invoice: Invoice, codebooks: CodebookSet): ValidationResult {
  const issues: ValidationIssue[] = [];
  const push = (issue: ValidationIssue) => issues.push(issue);

  // --- header -------------------------------------------------------------
  // A draft has no number yet — issuing is what allocates one, so requiring it
  // here would make it impossible to ever issue. Only a document that is past
  // draft and still unnumbered is actually broken.
  if (invoice.status !== '00' && !invoice.number.trim()) {
    push({ severity: 'error', path: 'number', message: 'Недостига број на фактура.' });
  }
  for (const [field, label] of [
    ['issueDate', 'Датум на издавање'],
    ['turnoverDate', 'Датум на промет'],
  ] as const) {
    if (!ISO_DATE.test(invoice[field] ?? '')) {
      push({ severity: 'error', path: field, message: `${label}: неважечки датум.` });
    }
  }
  if (invoice.dueDate && !ISO_DATE.test(invoice.dueDate)) {
    push({ severity: 'error', path: 'dueDate', message: 'Рок на плаќање: неважечки датум.' });
  }
  if (invoice.dueDate && invoice.dueDate < invoice.issueDate) {
    push({
      severity: 'warning',
      path: 'dueDate',
      message: 'Рокот на плаќање е пред датумот на издавање.',
    });
  }
  if (invoice.turnoverDate > invoice.issueDate) {
    push({
      severity: 'warning',
      path: 'turnoverDate',
      message: 'Датумот на промет е по датумот на издавање.',
    });
  }

  // --- parties ------------------------------------------------------------
  validateParty(
    {
      label: 'Издавач',
      path: 'seller',
      name: invoice.seller.name,
      taxNumber: invoice.seller.taxNumber,
      countryCode: invoice.seller.address.countryCode,
      street: invoice.seller.address.streetAddress,
      streetNumber: invoice.seller.address.streetNumber,
      postalCode: invoice.seller.address.postalCode,
      city: invoice.seller.address.city,
    },
    push,
  );
  validateParty(
    {
      label: 'Купувач',
      path: 'client',
      name: invoice.client.name,
      taxNumber: invoice.client.taxNumber,
      countryCode: invoice.client.address.countryCode,
      street: invoice.client.address.streetAddress,
      streetNumber: invoice.client.address.streetNumber,
      postalCode: invoice.client.address.postalCode,
      city: invoice.client.address.city,
    },
    push,
  );

  if (
    invoice.seller.taxNumber &&
    invoice.seller.taxNumber === invoice.client.taxNumber
  ) {
    push({
      severity: 'warning',
      path: 'client.taxNumber',
      message: 'Издавачот и купувачот имаат ист ЕДБ.',
    });
  }

  // --- payment ------------------------------------------------------------
  if (!codebooks.paymentTypes.some((p) => p.code === invoice.paymentTypeCode)) {
    push({
      severity: 'error',
      path: 'paymentTypeCode',
      message: `Непознат тип на плаќање: ${invoice.paymentTypeCode || '(празно)'}.`,
    });
  }
  if (!invoice.currency) {
    push({ severity: 'error', path: 'currency', message: 'Недостига валута.' });
  } else if (invoice.currency !== 'MKD' && !(invoice.exchangeRate > 0)) {
    push({
      severity: 'error',
      path: 'exchangeRate',
      message: 'За странска валута мора да се внесе курс поголем од 0.',
    });
  }

  // --- items --------------------------------------------------------------
  if (!invoice.items.length) {
    push({ severity: 'error', path: 'items', message: 'Фактурата нема ниту една ставка.' });
  }

  invoice.items.forEach((item, index) => {
    const at = `items.${index}`;
    const label = `Ставка ${index + 1}`;

    if (!item.description.trim()) {
      push({ severity: 'error', path: `${at}.description`, message: `${label}: недостига опис.` });
    }
    if (!item.unit.trim()) {
      push({ severity: 'error', path: `${at}.unit`, message: `${label}: недостига единица мерка.` });
    }
    if (!(item.qty > 0) && invoice.docStorno !== 1) {
      push({
        severity: 'error',
        path: `${at}.qty`,
        message: `${label}: количината мора да биде поголема од 0.`,
      });
    }
    if (item.unitPrice < 0 && invoice.docStorno !== 1) {
      push({
        severity: 'error',
        path: `${at}.unitPrice`,
        message: `${label}: цената не смее да биде негативна.`,
      });
    }
    if (item.discountPercent < 0 || item.discountPercent > 100) {
      push({
        severity: 'error',
        path: `${at}.discountPercent`,
        message: `${label}: попустот мора да биде помеѓу 0 и 100%.`,
      });
    }

    const indicator = findIndicator(codebooks, item.taxIndicator);
    if (!indicator) {
      push({
        severity: 'error',
        path: `${at}.taxIndicator`,
        message: `${label}: непознат даночен индикатор „${item.taxIndicator || '(празно)'}“.`,
      });
    } else {
      if (item.taxIndicator.length > 10) {
        push({
          severity: 'warning',
          path: `${at}.taxIndicator`,
          message: `${label}: шифрата на даночниот индикатор е подолга од 10 знаци.`,
        });
      }
      // A company registered for VAT cannot invoice as "не е ДДВ обврзник",
      // and one that is not registered must not charge VAT.
      if (invoice.seller.isVatRegistered && indicator.vatImpact === 'NULA') {
        push({
          severity: 'warning',
          path: `${at}.taxIndicator`,
          message: `${label}: издавачот е ДДВ обврзник, а индикаторот е „не е ДДВ обврзник“.`,
        });
      }
      if (!invoice.seller.isVatRegistered && indicator.vatImpact === 'STANDARD') {
        push({
          severity: 'error',
          path: `${at}.taxIndicator`,
          message: `${label}: издавачот не е ДДВ обврзник и не смее да пресметува ДДВ.`,
        });
      }
    }
  });

  // --- amounts ------------------------------------------------------------
  // UJP recomputes every total; a mismatch between what is stored on the
  // invoice and what its own lines produce means something wrote a total
  // directly, and the document would be rejected.
  const computed = computeInvoice(invoice.items, codebooks, {
    advanceAmount: invoice.advanceAmount,
  });

  const storedTotals: [keyof typeof computed.totals, string][] = [
    ['netAmount', 'Основица'],
    ['vatAmount', 'ДДВ'],
    ['grossAmount', 'Вкупно со ДДВ'],
    ['finalAmount', 'За плаќање'],
  ];
  for (const [key, label] of storedTotals) {
    if (round2(invoice.totals[key]) !== round2(computed.totals[key])) {
      push({
        severity: 'error',
        path: `totals.${key}`,
        message: `${label}: зачуваниот износ (${invoice.totals[key]}) не се совпаѓа со пресметаниот (${computed.totals[key]}).`,
      });
    }
  }

  if (invoice.advanceAmount < 0) {
    push({
      severity: 'error',
      path: 'advanceAmount',
      message: 'Авансот не смее да биде негативен.',
    });
  }
  if (invoice.advanceAmount > computed.totals.grossAmountRounded) {
    push({
      severity: 'error',
      path: 'advanceAmount',
      message: 'Авансот е поголем од вкупниот износ на фактурата.',
    });
  }
  if (computed.totals.finalAmount === 0 && invoice.items.length > 0) {
    push({
      severity: 'warning',
      path: 'totals.finalAmount',
      message: 'Износот за плаќање е 0.',
    });
  }

  // --- storno / correction ------------------------------------------------
  if (invoice.docStorno === 1) {
    if (!invoice.relatedEuid) {
      push({
        severity: 'error',
        path: 'relatedEuid',
        message: 'Сторно документот мора да реферира на оригиналната е-фактура (EUID).',
      });
    }
    if (computed.totals.grossAmount > 0) {
      push({
        severity: 'error',
        path: 'items',
        message: 'Кај сторно документ количините и износите мора да бидат негативни.',
      });
    }
  }
  if (invoice.docStorno === 2 && !invoice.relatedEuid) {
    push({
      severity: 'error',
      path: 'relatedEuid',
      message: 'Корекцијата мора да реферира на документот што се корегира (EUID).',
    });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return { issues, errors, warnings, canSubmit: errors.length === 0 };
}

/**
 * Lighter check used to decide whether the "Издај" button is enabled, without
 * running the full amount reconciliation on every keystroke.
 */
export function hasMinimumData(invoice: Invoice): boolean {
  return Boolean(
    invoice.client.name.trim() &&
      invoice.client.taxNumber.trim() &&
      invoice.items.length &&
      invoice.items.some((i) => i.description.trim()),
  );
}
