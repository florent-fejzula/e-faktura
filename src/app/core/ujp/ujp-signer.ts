import { InjectionToken } from '@angular/core';
import type { UjpSendRequest, UjpSendResponse } from '../models/ujp.model';

/**
 * The seam between the app and the УЈП signing/transport stack.
 *
 * A browser tab cannot do either job itself:
 *
 *  - **Signing** needs a qualified certificate (KIBS, Македонски Телеком,
 *    Halcom), which normally lives on a smart card or USB token behind a PIN.
 *    UJP's own answer is a Windows *Native App* plus a browser extension that
 *    talks to it over native messaging; a page has no other route to the key.
 *  - **Transport** is blocked by CORS — `efakturatest.ujp.gov.mk` does not
 *    serve the headers a cross-origin browser request needs.
 *
 * So both are expressed as interfaces here and provided from outside. Three
 * implementations are realistic, and the rest of the app is indifferent to
 * which one is installed:
 *
 *  1. **Extension bridge** — UJP's native app signs, the page talks to it.
 *  2. **Cloud Function** — a server holds a soft (PFX) certificate, signs and
 *     forwards. Only viable when the certificate is exportable.
 *  3. **Desktop shell** — the app runs in Electron and signs via CryptoAPI.
 */

export interface UjpSigningContext {
  /** `X-EDB` — tax number of the trading company. */
  taxNumber: string;
  /** `X-EUJP-ID` — the registered signer's e-УЈП identifier. */
  eujpId: string;
  /** `X-SERIAL-NUMBER` — serial of the signing certificate. */
  certificateSerialNumber: string;
}

export interface SignerStatus {
  available: boolean;
  /** Shown in settings so the user knows what is (or is not) wired up. */
  name: string;
  /** Why signing is unavailable, in Macedonian, for the UI. */
  reason?: string;
}

/** Produces a compact-serialisation JWS over the payload JSON. */
export abstract class UjpSigner {
  abstract status(): SignerStatus;
  abstract sign(payloadJson: string, context: UjpSigningContext): Promise<string>;
}

export interface UjpRequestHeaders {
  'X-EDB': string;
  'X-EUJP-ID': string;
  'X-SERIAL-NUMBER'?: string;
  'X-DOC-TYPE-CODE'?: string;
}

/** Moves a signed request to UJP and returns its answer. */
export abstract class UjpTransport {
  abstract status(): SignerStatus;
  abstract send(
    request: UjpSendRequest,
    headers: UjpRequestHeaders,
  ): Promise<UjpSendResponse>;
  /** GET/POST against the code-list services, used by codebook sync. */
  abstract call<T>(
    path: string,
    headers: UjpRequestHeaders,
    body?: unknown,
  ): Promise<T>;
}

/** Thrown when an operation needs a signer or transport that is not installed. */
export class UjpUnavailableError extends Error {
  constructor(readonly status: SignerStatus) {
    super(status.reason ?? 'Врската со УЈП не е конфигурирана.');
    this.name = 'UjpUnavailableError';
  }
}

const NOT_CONFIGURED: SignerStatus = {
  available: false,
  name: 'Не е поврзано',
  reason:
    'Потпишувањето бара квалификуван сертификат (КИБС, Македонски Телеком или Halcom) ' +
    'и инсталирана Native апликација на УЈП. Поврзете го потписникот во Поставки → УЈП.',
};

/**
 * Default implementation: refuses politely.
 *
 * Everything up to the signature — building the document, validating it,
 * previewing the exact JSON — works without a signer, so an invoice can be
 * prepared and checked today and submitted the moment a certificate is wired in.
 */
export class UnavailableUjpSigner extends UjpSigner {
  status(): SignerStatus {
    return NOT_CONFIGURED;
  }
  async sign(): Promise<string> {
    throw new UjpUnavailableError(NOT_CONFIGURED);
  }
}

export class UnavailableUjpTransport extends UjpTransport {
  status(): SignerStatus {
    return NOT_CONFIGURED;
  }
  async send(): Promise<UjpSendResponse> {
    throw new UjpUnavailableError(NOT_CONFIGURED);
  }
  async call<T>(): Promise<T> {
    throw new UjpUnavailableError(NOT_CONFIGURED);
  }
}

/**
 * Set to `true` once a signer is provided, so the UI can offer submission
 * instead of only export. Kept as a token rather than read off the signer so
 * tests can flip it without a full implementation.
 */
export const UJP_SUBMISSION_ENABLED = new InjectionToken<boolean>(
  'UJP_SUBMISSION_ENABLED',
  { providedIn: 'root', factory: () => false },
);
