import { round2 } from './money';

type Gender = 'm' | 'f';

const ONES_M = ['нула', 'еден', 'два', 'три', 'четири', 'пет', 'шест', 'седум', 'осум', 'девет'];
const ONES_F = ['нула', 'една', 'две', 'три', 'четири', 'пет', 'шест', 'седум', 'осум', 'девет'];
const TEENS = [
  'десет',
  'единаесет',
  'дванаесет',
  'тринаесет',
  'четиринаесет',
  'петнаесет',
  'шеснаесет',
  'седумнаесет',
  'осумнаесет',
  'деветнаесет',
];
const TENS = [
  '',
  '',
  'дваесет',
  'триесет',
  'четириесет',
  'педесет',
  'шеесет',
  'седумдесет',
  'осумдесет',
  'деведесет',
];
const HUNDREDS = [
  '',
  'сто',
  'двеста',
  'триста',
  'четиристотини',
  'петстотини',
  'шестотини',
  'седумстотини',
  'осумстотини',
  'деветстотини',
];

/** Words for a number below 1000, agreeing with `gender`. */
function chunkToWords(value: number, gender: Gender): string {
  const ones = gender === 'f' ? ONES_F : ONES_M;
  const parts: string[] = [];

  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(HUNDREDS[hundreds]);

  if (rest >= 10 && rest <= 19) {
    if (hundreds) parts.push('и');
    parts.push(TEENS[rest - 10]);
    return parts.join(' ');
  }

  const tens = Math.floor(rest / 10);
  const units = rest % 10;

  if (tens) {
    if (hundreds) parts.push('и');
    parts.push(TENS[tens]);
  }
  if (units) {
    if (tens || hundreds) parts.push('и');
    parts.push(ones[units]);
  }

  return parts.join(' ');
}

/** Words for a whole number, e.g. 2105 becomes `две илјади и сто и пет`. */
export function numberToWordsMk(value: number, gender: Gender = 'm'): string {
  if (!Number.isFinite(value)) return 'нула';
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'нула';

  const parts: string[] = [];

  const billions = Math.floor(n / 1_000_000_000);
  n %= 1_000_000_000;
  const millions = Math.floor(n / 1_000_000);
  n %= 1_000_000;
  const thousands = Math.floor(n / 1000);
  n %= 1000;

  if (billions) {
    parts.push(chunkToWords(billions, 'f'));
    parts.push(billions === 1 ? 'милијарда' : 'милијарди');
  }
  if (millions) {
    parts.push(chunkToWords(millions, 'm'));
    parts.push(millions === 1 ? 'милион' : 'милиони');
  }
  if (thousands) {
    // "илјада" is feminine: една илјада, две илјади.
    parts.push(chunkToWords(thousands, 'f'));
    parts.push(thousands === 1 ? 'илјада' : 'илјади');
  }
  if (n) {
    // "две илјади и пет" reads naturally, "две илјади и сто дваесет" does not.
    if (parts.length && n < 100) parts.push('и');
    parts.push(chunkToWords(n, gender));
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

interface CurrencyWords {
  major: readonly [one: string, many: string];
  minor: readonly [one: string, many: string];
  gender: Gender;
}

const CURRENCY_WORDS: Record<string, CurrencyWords> = {
  MKD: { major: ['денар', 'денари'], minor: ['ден', 'дени'], gender: 'm' },
  EUR: { major: ['евро', 'евра'], minor: ['цент', 'центи'], gender: 'm' },
  USD: { major: ['долар', 'долари'], minor: ['цент', 'центи'], gender: 'm' },
  GBP: { major: ['фунта', 'фунти'], minor: ['пени', 'пенија'], gender: 'f' },
};

/**
 * Renders an amount the way it has to appear in the "Со зборови" line of a
 * Macedonian invoice, e.g. 1234.50 MKD becomes
 * `Илјада и двеста и триесет и четири денари и педесет дени`.
 */
export function amountInWordsMk(amount: number, currency = 'MKD'): string {
  const words: CurrencyWords = CURRENCY_WORDS[currency] ?? {
    major: [currency, currency],
    minor: ['', ''],
    gender: 'm',
  };

  const value = round2(Number.isFinite(amount) ? amount : 0);
  const magnitude = Math.abs(value);
  const major = Math.floor(magnitude);
  const minor = Math.round((magnitude - major) * 100);

  const majorWords = numberToWordsMk(major, words.gender);
  const majorLabel = major === 1 ? words.major[0] : words.major[1];

  let result = majorWords + ' ' + majorLabel;

  if (minor > 0 && words.minor[0]) {
    const minorWords = numberToWordsMk(minor, words.gender);
    const minorLabel = minor === 1 ? words.minor[0] : words.minor[1];
    result += ' и ' + minorWords + ' ' + minorLabel;
  }

  if (value < 0) result = 'минус ' + result;

  return result.charAt(0).toUpperCase() + result.slice(1);
}
