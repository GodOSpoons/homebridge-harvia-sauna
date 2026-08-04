import { HarviaDevice, DeviceStateSubscriber } from '../HarviaDevice';
import { PlatformAccessory, Logger, API, HAP } from 'homebridge';
import type { Service } from 'homebridge';

export type SensorType = 'temperature' | 'humidity' | 'panelTemperature';

// For a satellite device like the SAM001W — no heater/switch controls,
// just a HomeKit Temperature or Humidity sensor reading from telemetry.
// Also reused on the sauna's own device for the control panel's ambient
// temperature reading ('panelTemperature'), which is separate from the
// heater's CurrentTemperature (the sensed sauna air temperature).
export class SensorAccessory implements DeviceStateSubscriber {
  private readonly service: Service;
  private readonly Characteristic: HAP['Characteristic'];

  constructor(
    private readonly log: Logger,
    private readonly device: HarviaDevice,
    accessory: PlatformAccessory,
    private readonly type: SensorType,
    private readonly hbApi: API
  ) {
    const { Service, Characteristic } = this.hbApi.hap;
    this.Characteristic = Characteristic;

    if (this.type === 'humidity') {
      this.service =
        accessory.getService(Service.HumiditySensor) ||
        accessory.addService(Service.HumiditySensor, `${device.name} Humidity`);
      this.service
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .onGet(() => this.device.humidity);
    } else {
      const label = this.type === 'panelTemperature' ? 'Panel Temperature' : 'Temperature';
      this.service =
        accessory.getService(Service.TemperatureSensor) ||
        accessory.addService(Service.TemperatureSensor, `${device.name} ${label}`);
      this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -10, maxValue: 130 })
        .onGet(() => this.currentValue());
    }

    this.device.subscribe(this);
  }

  private currentValue(): number {
    return this.type === 'panelTemperature' ? this.device.panelTemp : this.device.currentTemp;
  }

  public onDeviceUpdate(): void {
    if (this.type === 'humidity') {
      this.service.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, this.device.humidity);
    } else {
      this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, this.currentValue());
    }
  }
}
