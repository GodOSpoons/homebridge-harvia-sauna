import type { HAP } from 'homebridge';

// Eve Systems' custom characteristic UUIDs — not part of the official HAP
// spec, but a de facto standard reused verbatim across the Homebridge
// plugin ecosystem. Apple's own Home app ignores characteristics it
// doesn't recognize, so this only renders (as live wattage, with a
// history graph) in the free Eve app — that's expected, not a bug.
const CURRENT_CONSUMPTION_UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

// Must extend api.hap.Characteristic from the *same* hap-nodejs instance
// Homebridge itself is running — a separately imported copy would break
// UUID/class registration, so this is built from the HAP passed in at
// runtime rather than a static import.
export function createCurrentConsumptionCharacteristic(hap: HAP) {
  const { Characteristic, Formats, Perms } = hap;

  return class CurrentConsumption extends Characteristic {
    static readonly UUID = CURRENT_CONSUMPTION_UUID;

    constructor() {
      super('Current Consumption', CurrentConsumption.UUID, {
        format: Formats.FLOAT,
        unit: 'W',
        minValue: 0,
        maxValue: 100000,
        minStep: 1,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
      });
      this.value = this.getDefaultValue();
    }
  };
}
