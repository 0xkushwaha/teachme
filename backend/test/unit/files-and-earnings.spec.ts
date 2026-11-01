import { looksLikeMarkup, safeFileName, sniffFileType } from '../../src/utils/file-signature';
import { calculatePrice, teacherEarningMinor } from '../../src/utils/money';
import { csvCell } from '../../src/modules/earnings/earnings.service';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF');

describe('file signature sniffing', () => {
  it('recognises allowed formats from their bytes', () => {
    expect(sniffFileType(PDF)).toBe('application/pdf');
    expect(sniffFileType(PNG)).toBe('image/png');
    expect(sniffFileType(JPEG)).toBe('image/jpeg');
    expect(sniffFileType(WEBP)).toBe('image/webp');
  });

  it('rejects content that merely claims to be a document', () => {
    expect(sniffFileType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(sniffFileType(Buffer.from('MZ\x90\x00 executable'))).toBeNull();
    expect(sniffFileType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });

  it('flags image/markup polyglots', () => {
    expect(looksLikeMarkup(Buffer.concat([PNG, Buffer.from('<script>alert(1)</script>')]))).toBe(true);
    expect(looksLikeMarkup(Buffer.concat([JPEG, Buffer.from('<svg onload=x>')]))).toBe(true);
    expect(looksLikeMarkup(PNG)).toBe(false);
  });

  it('produces display-safe file names with the sniffed extension', () => {
    expect(safeFileName('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf');
    expect(safeFileName('C:\\Users\\me\\Degree "final".exe', 'image/png')).toBe('Degree final.png');
    expect(safeFileName('a\u0000b\r\nc.pdf', 'application/pdf')).toBe('abc.pdf');
    expect(safeFileName(undefined, 'image/jpeg')).toBe('document.jpg');
    expect(safeFileName('x'.repeat(300), 'application/pdf').length).toBeLessThanOrEqual(84);
  });
});

describe('teacher earning calculation', () => {
  const policy = { platformFeeBps: 500, taxBps: 1800, taxBase: 'PLATFORM_FEE' as const };

  it('pays the session price (not fees or tax) for a fully paid session', () => {
    const p = calculatePrice(100_000, 60, policy); // ₹1,000/hr
    expect(p).toEqual({ priceMinor: 100_000, platformFeeMinor: 5_000, taxMinor: 900, totalMinor: 105_900 });
    expect(teacherEarningMinor(p.priceMinor, p.totalMinor, p.totalMinor)).toBe(100_000);
  });

  it('reduces the earning pro rata for partial refunds, rounding down', () => {
    expect(teacherEarningMinor(100_000, 105_900, 52_950)).toBe(50_000);
    expect(teacherEarningMinor(100_001, 105_900, 52_950)).toBe(50_000); // 50000.47 → 50000
  });

  it('earns nothing for unpaid or fully refunded sessions', () => {
    expect(teacherEarningMinor(100_000, 105_900, 0)).toBe(0);
    expect(teacherEarningMinor(100_000, 105_900, -5)).toBe(0);
  });

  it('never exceeds the session price, even if more was collected', () => {
    expect(teacherEarningMinor(100_000, 105_900, 200_000)).toBe(100_000);
  });

  it('rejects non-integer money', () => {
    expect(() => teacherEarningMinor(100.5, 105_900, 105_900)).toThrow(RangeError);
  });
});

describe('CSV export cells', () => {
  it('quotes separators and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1-555')).toBe("'+1-555");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-12.50')).toBe('-12.50'); // numbers stay numbers
  });
});
