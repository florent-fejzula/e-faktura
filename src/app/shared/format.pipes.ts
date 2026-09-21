import { Pipe, type PipeTransform } from '@angular/core';
import { formatDate, type IsoDate } from '../core/util/dates';
import { currencySuffix, formatAmount, formatMoney } from '../core/util/money';

/** `1234.5 | amount` renders `1.234,50`. */
@Pipe({ name: 'amount' })
export class AmountPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 2): string {
    return formatAmount(value ?? 0, decimals);
  }
}

/** `1234.5 | money: 'MKD'` renders `1.234,50 ден.` */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, currency = 'MKD', decimals = 2): string {
    return formatMoney(value ?? 0, currency, decimals);
  }
}

/** `'MKD' | currencySymbol` renders `ден.` */
@Pipe({ name: 'currencySymbol' })
export class CurrencySymbolPipe implements PipeTransform {
  transform(currency: string | null | undefined): string {
    return currencySuffix(currency || 'MKD');
  }
}

/** `'2026-08-29' | mkDate` renders `29.08.2026`. */
@Pipe({ name: 'mkDate' })
export class MkDatePipe implements PipeTransform {
  transform(value: IsoDate | null | undefined): string {
    return formatDate(value);
  }
}

export const FORMAT_PIPES = [AmountPipe, MoneyPipe, CurrencySymbolPipe, MkDatePipe] as const;
