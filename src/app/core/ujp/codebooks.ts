import type { VatImpact } from '../models/invoice.model';
import { UJP_TAX_INDICATORS } from './tax-indicators.generated';

/**
 * Seed copies of the УЈП шифрарници (code lists).
 *
 * UJP serves the authoritative lists from `/api/v1/tax-groups`,
 * `/api/v1/tax-indicators`, `/api/v1/payment-types` and friends — but every one
 * of those endpoints requires `X-EUJP-ID` and `X-EDB` headers belonging to a
 * registered e-УЈП user, so a company that has not completed registration yet
 * cannot fetch them at all.
 *
 * These seeds therefore exist so the app is fully usable before registration.
 * `CodebookService` prefers synced data whenever it is available and only falls
 * back here. Nothing in the app should hardcode a code outside this file.
 *
 * Sources: https://efakturawiki.ujp.gov.mk/тест_апи (API examples) and
 * https://efakturawiki.ujp.gov.mk/шифрарници/шифрарник (field codebook),
 * captured 2026-08-29 and mirrored under `docs/ujp/`.
 */

export interface TaxGroup {
  code: string;
  name: string;
  percent: number;
  description: string;
}

export interface TaxIndicator {
  code: string;
  categoryName: string;
  /** Printed on the invoice next to the VAT total for this indicator. */
  note: string;
  vatImpact: VatImpact;
  /** Links the indicator to the rate it charges. */
  taxGroupCode: string;
  /**
   * True for the ~16 codes UJP documents individually — the short list a seller
   * realistically picks from. The remaining granular codes stay behind a
   * "show all" toggle so the common case is one tap.
   */
  common?: boolean;
}

export interface PaymentType {
  code: string;
  description: string;
}

export interface DocumentType {
  code: string;
  name: string;
  needSignature: boolean;
  hasItems: boolean;
  hasReference: boolean;
  isReferenceMandatory: boolean;
}

export interface RefDocumentType {
  code: string;
  name: string;
  description: string;
}

export interface ReasonCode {
  code: string;
  text: string;
}

export interface Currency {
  code: string;
  name: string;
  description: string;
}

export interface UnitOfMeasure {
  code: string;
  name: string;
}

/**
 * VAT rates. Macedonia levies a standard 18% plus preferential 5% and 10%.
 *
 * The А/Б/В/Г group letters follow the order the rates were introduced, which
 * is why `DDV-B` is 5% and `DDV-V` is 10% rather than the other way round.
 * Verify against a live `/tax-groups` call once e-УЈП access exists — the app
 * will then use the synced values and ignore these.
 */
export const SEED_TAX_GROUPS: readonly TaxGroup[] = [
  { code: 'DDV-A', name: 'ДДВ 18%', percent: 18, description: 'Општа стапка' },
  { code: 'DDV-B', name: 'ДДВ 5%', percent: 5, description: 'Повластена стапка' },
  { code: 'DDV-V', name: 'ДДВ 10%', percent: 10, description: 'Повластена стапка' },
  { code: 'DDV-G', name: 'ДДВ 0%', percent: 0, description: 'Не е ДДВ обврзник' },
];

/**
 * The full outbound indicator list, generated from the official УЈП page.
 * See `tax-indicators.generated.ts` for provenance and how to regenerate it.
 */
export const SEED_TAX_INDICATORS: readonly TaxIndicator[] = UJP_TAX_INDICATORS;

export const SEED_PAYMENT_TYPES: readonly PaymentType[] = [
  { code: 'P10', description: 'Плаќање во готово' },
  { code: 'P11', description: 'Плаќање со картичка' },
  { code: 'P12', description: 'Плаќање преку банка' },
  { code: 'P13', description: 'Компензација' },
  { code: 'P14', description: 'Цесија' },
  { code: 'P15', description: 'Друго' },
];

export const SEED_DOCUMENT_TYPES: readonly DocumentType[] = [
  {
    code: '100',
    name: 'Фактура',
    needSignature: true,
    hasItems: true,
    hasReference: false,
    isReferenceMandatory: false,
  },
];

export const SEED_REF_DOCUMENT_TYPES: readonly RefDocumentType[] = [
  { code: 'DOG', name: 'Договор', description: '' },
  { code: 'NAR_DOC', name: 'Нарачка', description: '' },
  { code: 'PON_DOC', name: 'Понуда', description: '' },
  { code: 'PRO_FAK', name: 'Профактура', description: '' },
  { code: 'DOC_JN', name: 'Документ за јавна набавка', description: '' },
  { code: 'DOC_SEP', name: 'Документ за СЕП проект', description: '' },
  { code: 'CAR_DEC', name: 'Царинска декларација', description: '' },
  { code: 'CAR_RES', name: 'Решение од Царинска управа', description: '' },
  { code: 'GRD_DOC', name: 'Градежни документи', description: '' },
  {
    code: 'TRN_DOC',
    name: 'Транспортни документи',
    description: 'ЦМР, товарен лист, пропратница',
  },
  { code: 'KUP_REF', name: 'Референца на купувач', description: '' },
  { code: 'FISK_SMET', name: 'Фискална сметка', description: '' },
  { code: 'SYS', name: 'Од систем', description: 'EUID на поврзана е-фактура' },
  { code: 'DR_DOG', name: 'Други документи', description: '' },
];

export const SEED_VOID_REASONS: readonly ReasonCode[] = [
  { code: 'S-1', text: 'Погрешен купувач' },
  { code: 'S-2', text: 'Поништување на договор' },
  { code: 'S-3', text: 'Стоката е вратена во целост' },
];

export const SEED_REJECT_REASONS: readonly ReasonCode[] = [
  {
    code: 'O-1',
    text: 'Погрешно пресметан ДДВ (несоодветна даночна основа, ДДВ стапка, неправилен даночен индикатор и сл.)',
  },
  { code: 'O-2', text: 'Грешка во нарачка (количина, цена, опис на промет и друго)' },
  { code: 'O-3', text: 'Погрешни податоци за купувач (едб, назив, адреса и друго)' },
];

export const SEED_CORRECTION_REASONS: readonly ReasonCode[] = [
  { code: 'C01', text: 'Грешка во цена' },
  { code: 'C02', text: 'Грешка во количина' },
  { code: 'C03', text: 'Грешка во опис на промет' },
];

export const SEED_CURRENCIES: readonly Currency[] = [
  { code: 'MKD', name: 'MKD', description: 'Македонски денар' },
  { code: 'EUR', name: 'EUR', description: 'Евро' },
  { code: 'USD', name: 'USD', description: 'Американски долар' },
  { code: 'GBP', name: 'GBP', description: 'Британска фунта' },
  { code: 'CHF', name: 'CHF', description: 'Швајцарски франк' },
];

/**
 * Units of measure. UJP takes `docItemMUnit` as free text (max length aside),
 * so this list is a convenience for the editor rather than a validated code
 * list — but keeping it consistent avoids "ком" / "kom" / "парче" drift across
 * a company's invoices.
 */
export const SEED_UNITS: readonly UnitOfMeasure[] = [
  { code: 'ком', name: 'Комад / парче' },
  { code: 'услуга', name: 'Услуга' },
  { code: 'час', name: 'Час' },
  { code: 'ден', name: 'Ден' },
  { code: 'месец', name: 'Месец' },
  { code: 'кг', name: 'Килограм' },
  { code: 'г', name: 'Грам' },
  { code: 'т', name: 'Тон' },
  { code: 'л', name: 'Литар' },
  { code: 'м', name: 'Метар' },
  { code: 'м2', name: 'Квадратен метар' },
  { code: 'м3', name: 'Кубен метар' },
  { code: 'км', name: 'Километар' },
  { code: 'пар', name: 'Пар' },
  { code: 'пак', name: 'Пакување' },
  { code: 'сет', name: 'Сет' },
  { code: 'проект', name: 'Проект' },
];

export const COUNTRY_MK = { code: 'MK', name: 'Северна Македонија' } as const;

/** Everything a company needs loaded before it can edit an invoice. */
export interface CodebookSet {
  taxGroups: readonly TaxGroup[];
  taxIndicators: readonly TaxIndicator[];
  paymentTypes: readonly PaymentType[];
  documentTypes: readonly DocumentType[];
  refDocumentTypes: readonly RefDocumentType[];
  voidReasons: readonly ReasonCode[];
  rejectReasons: readonly ReasonCode[];
  correctionReasons: readonly ReasonCode[];
  currencies: readonly Currency[];
  units: readonly UnitOfMeasure[];
  /** When the set was last pulled from UJP; null means these are the seeds. */
  syncedAt: number | null;
}

export function seedCodebooks(): CodebookSet {
  return {
    taxGroups: SEED_TAX_GROUPS,
    taxIndicators: SEED_TAX_INDICATORS,
    paymentTypes: SEED_PAYMENT_TYPES,
    documentTypes: SEED_DOCUMENT_TYPES,
    refDocumentTypes: SEED_REF_DOCUMENT_TYPES,
    voidReasons: SEED_VOID_REASONS,
    rejectReasons: SEED_REJECT_REASONS,
    correctionReasons: SEED_CORRECTION_REASONS,
    currencies: SEED_CURRENCIES,
    units: SEED_UNITS,
    syncedAt: null,
  };
}

/** Resolves the VAT rate an indicator implies, via its tax group. */
export function rateForIndicator(set: CodebookSet, indicatorCode: string): number {
  const indicator = set.taxIndicators.find((i) => i.code === indicatorCode);
  if (!indicator) return 0;
  if (indicator.vatImpact === 'OSLOBODEN' || indicator.vatImpact === 'NULA') return 0;
  const group = set.taxGroups.find((g) => g.code === indicator.taxGroupCode);
  return group?.percent ?? 0;
}

export function findIndicator(set: CodebookSet, code: string): TaxIndicator | undefined {
  return set.taxIndicators.find((i) => i.code === code);
}

export function vatImpactOf(set: CodebookSet, code: string): VatImpact {
  return findIndicator(set, code)?.vatImpact ?? 'STANDARD';
}

/** What choosing a tax indicator implies for a line: its group and its rate. */
export interface ResolvedIndicator {
  taxIndicator: string;
  vatGroup: string;
  vatRate: number;
  /**
   * Whether a price may be entered "with VAT". Only for standard VAT: on
   * exempt, zero-rated and reverse-charge lines no VAT is added, so a gross
   * price would silently mean the same as net.
   */
  allowsGrossPrice: boolean;
}

/**
 * Resolves an indicator code to the group and rate it charges, so a line can
 * never carry an indicator from one rate and a percentage from another. Exempt
 * and zero-rated codes resolve to 0% whatever their group says.
 *
 * Shared by the invoice editor and the price list, which both set all three
 * fields from a single choice.
 */
export function resolveIndicator(set: CodebookSet, code: string): ResolvedIndicator | null {
  const indicator = set.taxIndicators.find((i) => i.code === code);
  if (!indicator) return null;
  const group = set.taxGroups.find((g) => g.code === indicator.taxGroupCode);
  // Reverse charge keeps its rate on the line (and reports notional VAT);
  // only exempt and zero-rated supplies drop to 0%.
  const rated = indicator.vatImpact !== 'OSLOBODEN' && indicator.vatImpact !== 'NULA';
  return {
    taxIndicator: indicator.code,
    vatGroup: indicator.taxGroupCode,
    vatRate: rated ? (group?.percent ?? 0) : 0,
    allowsGrossPrice: indicator.vatImpact === 'STANDARD',
  };
}

/**
 * Short label for a tax indicator, e.g. `ДДВ 18%` or `DDV-11-A · пренесен`.
 * The full category name is far too long for a narrow field or a list row, but
 * the bare code alone tells a user nothing.
 */
export function indicatorShortLabel(set: CodebookSet, code: string): string {
  const indicator = set.taxIndicators.find((i) => i.code === code);
  if (!indicator) return code;

  const rate = set.taxGroups.find((g) => g.code === indicator.taxGroupCode)?.percent ?? 0;
  switch (indicator.vatImpact) {
    case 'STANDARD':
      return `ДДВ ${rate}%`;
    case 'PRENESEN':
      return `${code} · пренесен`;
    case 'OSLOBODEN':
      return `${code} · ослободен`;
    case 'NULA':
      return `${code} · без ДДВ`;
  }
}
