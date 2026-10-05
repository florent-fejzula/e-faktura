import {
  PRINT_TITLES,
  SIGNATORY_LABEL,
  SIGNATORY_MAX_LENGTH,
  defaultCompanyDefaults,
  defaultNumbering,
  printSettings,
  snapshotCompany,
  type Company,
  type PrintSettings,
} from './company.model';

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 'co-1',
    name: 'Р.С.М-КОПИ ДООЕЛ',
    taxNumber: '4030002463700',
    vatNumber: '',
    isVatRegistered: true,
    registrationNumber: '',
    address: {
      streetAddress: 'Дрезденска',
      streetNumber: '15',
      postalCode: '1000',
      city: 'Скопје',
      countryCode: 'MK',
      countryName: 'Северна Македонија',
    },
    email: '',
    phone: '',
    contactPerson: '',
    bankAccounts: [],
    numbering: defaultNumbering(),
    defaults: defaultCompanyDefaults(),
    ujp: { eujpId: '', certificateSerialNumber: '', verifiedAt: null },
    ownerUid: 'u',
    memberUids: ['u'],
    isActive: true,
    createdAt: 0,
    updatedAt: 0,
    createdByUid: 'u',
    updatedByUid: 'u',
    ...overrides,
  };
}

describe('print settings', () => {
  it('print exactly as before for a company that never set them', () => {
    expect(printSettings(company())).toEqual({
      title: 'faktura',
      logoPosition: 'left',
      signatory: '',
      fileName: 'seller',
    });
    expect(printSettings(undefined).title).toBe('faktura');
  });

  it('keep what the company chose', () => {
    const chosen: PrintSettings = {
      title: 'faktura-ispratnica',
      logoPosition: 'center',
      signatory: 'Петар Петровски',
      fileName: 'buyer',
    };
    expect(printSettings(company({ print: chosen }))).toEqual(chosen);
  });

  it('fall back field by field on a value this version does not know', () => {
    const unknown = { title: 'profaktura', logoPosition: 'right', signatory: 7, fileName: 'buyer' };
    expect(printSettings({ print: unknown as unknown as PrintSettings })).toEqual({
      title: 'faktura',
      logoPosition: 'left',
      signatory: '',
      fileName: 'buyer',
    });
  });

  it('tidy the signatory and keep it within the field length', () => {
    const padded = { signatory: '  Петар Петровски  ' } as PrintSettings;
    expect(printSettings({ print: padded }).signatory).toBe('Петар Петровски');
    const long = { signatory: 'А'.repeat(SIGNATORY_MAX_LENGTH + 20) } as PrintSettings;
    expect(printSettings({ print: long }).signatory.length).toBe(SIGNATORY_MAX_LENGTH);
  });

  it('caption the signature line in the words of the VAT law', () => {
    expect(SIGNATORY_LABEL).toBe('Лице овластено за потпишување на фактури');
  });

  it('are not fooled by a property every object has', () => {
    const sneaky = { title: 'toString' } as unknown as PrintSettings;
    expect(printSettings({ print: sneaky }).title).toBe('faktura');
  });

  it('offer only the two headings that are both invoices', () => {
    expect(Object.values(PRINT_TITLES)).toEqual(['Фактура', 'Фактура - испратница']);
  });
});

describe('what an invoice keeps of its seller', () => {
  it('keeps the logo by id, not the image', () => {
    const seller = snapshotCompany(company({ logoId: 'logo-7' }));
    expect(seller.logoId).toBe('logo-7');
    expect(JSON.stringify(seller)).not.toContain('data:image');
  });

  it('freezes the heading, logo placement and signatory, which are part of the document', () => {
    const seller = snapshotCompany(
      company({
        print: {
          title: 'faktura-ispratnica',
          logoPosition: 'center',
          signatory: 'Петар Петровски',
          fileName: 'buyer',
        },
      }),
    );
    expect(seller.print).toEqual({
      title: 'faktura-ispratnica',
      logoPosition: 'center',
      signatory: 'Петар Петровски',
    });
  });

  it('leaves out the file-name preference, which is not', () => {
    const seller = snapshotCompany(
      company({ print: { title: 'faktura', logoPosition: 'left', signatory: '', fileName: 'buyer' } }),
    );
    expect(Object.keys(seller.print ?? {})).not.toContain('fileName');
  });

  it('reads an invoice issued before logos existed as having none', () => {
    const legacy = { ...snapshotCompany(company()), logoId: undefined, print: undefined };
    expect(legacy.logoId ?? null).toBeNull();
    expect(printSettings(legacy).title).toBe('faktura');
  });
});
