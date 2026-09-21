import type { MatDateFormats } from '@angular/material/core';

/**
 * Macedonian date presentation: `29.08.2026`.
 *
 * `parse.dateInput` is left as-is because the native adapter parses with
 * `Date.parse`, which handles the dotted form via the `mk-MK` locale.
 */
export const MK_DATE_FORMATS: MatDateFormats = {
  parse: {
    dateInput: 'DD.MM.YYYY',
  },
  display: {
    dateInput: { day: '2-digit', month: '2-digit', year: 'numeric' },
    monthYearLabel: { month: 'short', year: 'numeric' },
    dateA11yLabel: { day: 'numeric', month: 'long', year: 'numeric' },
    monthYearA11yLabel: { month: 'long', year: 'numeric' },
  },
};
