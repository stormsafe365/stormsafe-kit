import { describe, expect, it } from 'vitest';
import { cciCenterClearanceFt } from '../clearance';

// Owner's CCI "Center Clearance" chart (inches above the leg height).
describe('CCI center clearance (Spacing overlay)', () => {
  it('Regular style matches the chart', () => {
    const rows: Array<[number, number]> = [[12, 27], [18, 33], [20, 32], [22, 32], [24, 37], [26, 29], [28, 28], [30, 28]];
    for (const [w, inch] of rows) expect(cciCenterClearanceFt('CCI', 'Regular', w, 10)).toBeCloseTo(10 + inch / 12, 6);
  });
  it('Boxed Eave and Vertical use the Boxed Eave/Vertical column', () => {
    const rows: Array<[number, number]> = [[12, 19], [18, 32], [20, 30], [22, 29], [24, 31], [26, 15], [28, 14], [30, 14]];
    for (const [w, inch] of rows) {
      expect(cciCenterClearanceFt('CCI', 'Boxed Eave', w, 12)).toBeCloseTo(12 + inch / 12, 6);
      expect(cciCenterClearanceFt('CCI', 'Vertical', w, 12)).toBeCloseTo(12 + inch / 12, 6);
    }
  });
  it('nothing for CA, uncharted widths (14, 16) or wide spans', () => {
    expect(cciCenterClearanceFt('CA', 'Regular', 24, 10)).toBeNull();
    expect(cciCenterClearanceFt(undefined, 'Regular', 24, 10)).toBeNull();
    expect(cciCenterClearanceFt('CCI', 'Vertical', 14, 10)).toBeNull();
    expect(cciCenterClearanceFt('CCI', 'Vertical', 16, 10)).toBeNull();
    expect(cciCenterClearanceFt('CCI', 'Vertical', 40, 14)).toBeNull();
  });
});
