import { HarviaDevice, DeviceStateSubscriber } from '../HarviaDevice';
import { PlatformAccessory, Logger, API, HAP } from 'homebridge';
import type { Service } from 'homebridge';

export type SensorType = 'temperature' | 'humidity';

// For a satellite device like the SAM001W — no heater/switch controls,
// just a HomeKit Temperature or Humidity sensor reading from telemetry.
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

    if (this.type === 'temperature') {
      this.service =
        accessory.getService(Service.TemperatureSensor) ||
        accessory.addService(Service.TemperatureSensor, `${device.name} Temperature`);
      this.service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -10, maxValue: 130 })
        .onGet(() => this.device.currentTemp);
    } else {
      this.service =
        accessory.getService(Service.HumiditySensor) ||
        accessory.addService(Service.HumiditySensor, `${device.name} Humidity`);
      this.service
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .onGet(() => this.device.humidity);
    }

    this.device.subscribe(this);
  }

  public onDeviceUpdate(): void {
    if (this.type === 'temperature') {
      this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, this.device.currentTemp);
    } else {
      this.service.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, this.device.humidity);
    }
  }
}
