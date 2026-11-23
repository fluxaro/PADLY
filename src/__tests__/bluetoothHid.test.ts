import { convertStateToHidReport, bluetoothHidService } from '../net/BluetoothHidService';
import { ControllerState } from '../input/stateAggregator';
import { BUTTON_BITS } from '../protocol/buttons';

describe('Bluetooth HID Gamepad Report Conversion', () => {
  const neutralState: ControllerState = {
    buttons: 0,
    lx: 0,
    ly: 0,
    rx: 0,
    ry: 0,
    lt: 0,
    rt: 0,
    flags: 0,
  };

  test('Neutral state produces all-zero buttons and neutral hat (0)', () => {
    const report = convertStateToHidReport(neutralState);
    expect(report.buttons).toBe(0);
    expect(report.hat).toBe(0);
    expect(report.lx).toBe(0);
    expect(report.ly).toBe(0);
    expect(report.rx).toBe(0);
    expect(report.ry).toBe(0);
    expect(report.lt).toBe(0);
    expect(report.rt).toBe(0);
  });

  test('Maps standard 14 buttons properly', () => {
    // Test A, B, X, Y
    let state: ControllerState = {
      ...neutralState,
      buttons: BUTTON_BITS.A | BUTTON_BITS.B | BUTTON_BITS.X | BUTTON_BITS.Y,
    };
    let report = convertStateToHidReport(state);
    // Button 1 (bit 0), Button 2 (bit 1), Button 3 (bit 2), Button 4 (bit 3) = 0b1111 = 15
    expect(report.buttons & 0x0f).toBe(0x0f);

    // Test LB, RB, BACK, START, HOME, L3, R3, SHARE
    state = {
      ...neutralState,
      buttons:
        BUTTON_BITS.LB |
        BUTTON_BITS.RB |
        BUTTON_BITS.BACK |
        BUTTON_BITS.START |
        BUTTON_BITS.HOME |
        BUTTON_BITS.L3 |
        BUTTON_BITS.R3 |
        BUTTON_BITS.SHARE,
    };
    report = convertStateToHidReport(state);
    // LB=bit 4, RB=bit 5, BACK=bit 6, START=bit 7, HOME=bit 8, L3=bit 9, R3=bit 10, SHARE=bit 11
    const expected =
      (1 << 4) |
      (1 << 5) |
      (1 << 6) |
      (1 << 7) |
      (1 << 8) |
      (1 << 9) |
      (1 << 10) |
      (1 << 11);
    expect(report.buttons).toBe(expected);
  });

  test('Maps 8-way Hat Switch directions accurately', () => {
    // 1: Up (North)
    let report = convertStateToHidReport({ ...neutralState, buttons: BUTTON_BITS.UP });
    expect(report.hat).toBe(1);

    // 2: Up + Right (North-East)
    report = convertStateToHidReport({
      ...neutralState,
      buttons: BUTTON_BITS.UP | BUTTON_BITS.RIGHT,
    });
    expect(report.hat).toBe(2);

    // 3: Right (East)
    report = convertStateToHidReport({ ...neutralState, buttons: BUTTON_BITS.RIGHT });
    expect(report.hat).toBe(3);

    // 4: Down + Right (South-East)
    report = convertStateToHidReport({
      ...neutralState,
      buttons: BUTTON_BITS.DOWN | BUTTON_BITS.RIGHT,
    });
    expect(report.hat).toBe(4);

    // 5: Down (South)
    report = convertStateToHidReport({ ...neutralState, buttons: BUTTON_BITS.DOWN });
    expect(report.hat).toBe(5);

    // 6: Down + Left (South-West)
    report = convertStateToHidReport({
      ...neutralState,
      buttons: BUTTON_BITS.DOWN | BUTTON_BITS.LEFT,
    });
    expect(report.hat).toBe(6);

    // 7: Left (West)
    report = convertStateToHidReport({ ...neutralState, buttons: BUTTON_BITS.LEFT });
    expect(report.hat).toBe(7);

    // 8: Up + Left (North-West)
    report = convertStateToHidReport({
      ...neutralState,
      buttons: BUTTON_BITS.UP | BUTTON_BITS.LEFT,
    });
    expect(report.hat).toBe(8);

    // Neutral when opposite directions are pressed
    report = convertStateToHidReport({
      ...neutralState,
      buttons: BUTTON_BITS.UP | BUTTON_BITS.DOWN,
    });
    expect(report.hat).toBe(0);
  });

  test('Transfers full range analog sticks and triggers', () => {
    const activeState: ControllerState = {
      buttons: 0,
      lx: -32768, // full left
      ly: -32768, // full up (negative evdev convention)
      rx: 32767, // full right
      ry: 32767, // full down
      lt: 255, // fully depressed left trigger
      rt: 128, // half depressed right trigger
      flags: 0,
    };

    const report = convertStateToHidReport(activeState);
    expect(report.lx).toBe(-32768);
    expect(report.ly).toBe(-32768);
    expect(report.rx).toBe(32767);
    expect(report.ry).toBe(32767);
    expect(report.lt).toBe(255);
    expect(report.rt).toBe(128);
  });

  test('Service subscription lifecycle', () => {
    let notified = false;
    const unsub = bluetoothHidService.subscribe((state) => {
      notified = true;
      expect(state).toBeDefined();
    });
    expect(notified).toBe(true);
    unsub();
  });
});
