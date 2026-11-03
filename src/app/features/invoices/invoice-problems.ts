import type { Invoice } from '../../core/models/invoice.model';
import type { ValidationIssue } from '../../core/ujp/ujp-validator';

/**
 * Where each problem that blocks issuing shows in the editor, and how it reads
 * there.
 *
 * The validator writes sentences that stand alone in a list — "Купувач:
 * недостига улица.", "Ставка 2: недостига опис." The editor puts each problem
 * next to what it is about instead, so the sentence drops its "Купувач:" or
 * "Ставка 2:", and a client's missing details become a single line.
 */
export interface EditorProblems {
  /** Fields to outline, by validator path: `client`, `items.0.description`, `dueDate`. */
  fields: ReadonlySet<string>;
  /** The line in the Купувач card. */
  client: string | null;
  /** Under each item, by its index. */
  lines: ReadonlyMap<number, string>;
  /** Under a field of the Детали card, by path. */
  details: ReadonlyMap<string, string>;
  /** What has no field on this screen: the company's own data, the totals. */
  other: string[];
  /** Whether `other` includes the company's data, fixed in Поставки. */
  seller: boolean;
}

/** Fields of the Детали card. */
const DETAIL_PATHS = new Set([
  'issueDate',
  'turnoverDate',
  'dueDate',
  'paymentTypeCode',
  'currency',
  'exchangeRate',
  'advanceAmount',
]);

/** A party's fields, as they are named in "недостига …". */
const PARTY_FIELDS: Record<string, string> = {
  name: 'назив',
  taxNumber: 'ЕДБ',
  'address.streetAddress': 'улица',
  'address.streetNumber': 'број на улица',
  'address.city': 'град',
  'address.postalCode': 'поштенски број',
};

/** Item fields that are simply empty, said as what to do. */
const LINE_PROMPTS: Record<string, string> = {
  description: 'Внесете опис.',
  unit: 'Внесете единица мерка.',
};

const LINE_PATH = /^items\.(\d+)\.(\w+)$/;

export function describeProblems(invoice: Invoice, errors: readonly ValidationIssue[]): EditorProblems {
  const fields = new Set<string>();
  const lines = new Map<number, string[]>();
  const details = new Map<string, string>();
  const other: string[] = [];

  const clientMissing: string[] = [];
  const clientOther: string[] = [];
  const sellerMissing: string[] = [];
  const sellerOther: string[] = [];

  for (const issue of errors) {
    const { path, message } = issue;

    const party = path.match(/^(client|seller)\.(.+)$/);
    if (party) {
      const [, who, field] = party;
      const missing = /недостига/.test(message) ? PARTY_FIELDS[field] : undefined;
      if (who === 'client') fields.add('client');
      if (missing) {
        (who === 'client' ? clientMissing : sellerMissing).push(missing);
      } else {
        (who === 'client' ? clientOther : sellerOther).push(afterLabel(message));
      }
      continue;
    }

    const line = path.match(LINE_PATH);
    if (line) {
      const index = Number(line[1]);
      fields.add(path);
      const said = lines.get(index) ?? [];
      said.push(LINE_PROMPTS[line[2]] ?? withoutLabel(message));
      lines.set(index, said);
      continue;
    }

    if (DETAIL_PATHS.has(path)) {
      fields.add(path);
      if (!details.has(path)) details.set(path, withoutLabel(message));
      continue;
    }

    other.push(message);
  }

  // No buyer chosen yet: that is the one thing to say, not its six empty fields.
  let client: string | null = null;
  if (!invoice.client.name.trim()) {
    client = 'Изберете купувач или додадете нов.';
  } else if (clientMissing.length || clientOther.length) {
    client = [
      clientMissing.length ? `Во податоците за купувачот недостига ${listMk(clientMissing)}.` : '',
      ...clientOther,
    ]
      .filter(Boolean)
      .join(' ');
  }

  // The company's own data is fixed in Поставки, not here; it leads the rest.
  const seller = [
    ...(sellerMissing.length
      ? [`Во податоците за вашата фирма недостига ${listMk(sellerMissing)}.`]
      : []),
    ...sellerOther.map((rest) => `Вашата фирма: ${rest}`),
  ];

  return {
    fields,
    client,
    lines: new Map([...lines].map(([index, said]) => [index, said.join(' ')])),
    details,
    other: [...seller, ...other],
    seller: seller.length > 0,
  };
}

/** "Купувач: ЕДБ мора да има …" → "ЕДБ мора да има …" */
function afterLabel(message: string): string {
  const at = message.indexOf(': ');
  return at === -1 ? message : message.slice(at + 2);
}

/** "Ставка 2: количината мора …" → "Количината мора …" */
function withoutLabel(message: string): string {
  const rest = afterLabel(message);
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** `улица`, `улица и град`, `улица, град и поштенски број`. */
export function listMk(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`;
}
