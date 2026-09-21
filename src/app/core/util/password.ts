/**
 * Passwords the operator generates and reads out to a customer over the phone.
 *
 * The alphabet deliberately drops the characters that get misheard or mistyped
 * when a password is dictated or copied off a printout: `0`/`O`, `1`/`l`/`I`,
 * `5`/`S`, `2`/`Z`. A shorter alphabet costs a little entropy, which the length
 * more than pays back — 16 characters of this set is still ~82 bits.
 *
 * Latin only, even though the rest of the app is Cyrillic: a password with `ш`
 * in it cannot be typed on a keyboard set to English, which is how most people
 * here start their day.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYabcdefghijkmnopqrstuvwxyz346789';

const DEFAULT_LENGTH = 16;

export function generatePassword(length = DEFAULT_LENGTH): string {
  const size = ALPHABET.length;
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);

  // Rejection sampling rather than `% size`: the modulo of a uniform 32-bit
  // value is very slightly biased towards the first few letters, and there is
  // no reason to accept that when redrawing is free.
  const limit = Math.floor(0xffffffff / size) * size;
  let out = '';
  for (let i = 0; i < length; i++) {
    let value = bytes[i];
    while (value >= limit) {
      const redraw = new Uint32Array(1);
      crypto.getRandomValues(redraw);
      value = redraw[0];
    }
    out += ALPHABET[value % size];
  }
  return out;
}

/**
 * Groups a password into fours (`Kq7f-Wmx3-...`) for reading aloud or copying
 * off a screen. The hyphens are display only — never send the grouped form.
 */
export function groupForReading(password: string): string {
  return (password.match(/.{1,4}/g) ?? []).join('-');
}
