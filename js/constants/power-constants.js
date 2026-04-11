/**
 * Power constants - 電源按鈕狀態常數
 *
 * 統一電源相關按鈕的 UI 狀態對照表。
 */

export const POWER_BUTTON_STATES = {
  powering: {
    powerOn: true,
    quickPowerOn: false,
    powerOff: true,
    emergencyStop: false,
  },
  on: {
    powerOn: true,
    quickPowerOn: true,
    powerOff: false,
    emergencyStop: false,
  },
  off: {
    powerOn: false,
    quickPowerOn: false,
    powerOff: true,
    emergencyStop: true,
  },
};
