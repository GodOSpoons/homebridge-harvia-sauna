import { HarviaDevice, DeviceStateSubscriber } from '../HarviaDevice';
import { PlatformAccessory, Logger, CharacteristicValue, API, HAP } from 'homebridge';
import type { Service } from 'homebridge';

export type SwitchType = 'power' | 'light' | 'fan' | 'steamer';

export class SwitchAccessory implements DeviceStateSubscriber {
  private readonly service: Service;
  private readonly Characteristic: HAP['Characteristic'];
  private readonly displayName: string;

  constructor(
    private readonly log: Logger,
    private readonly device: HarviaDevice,
    accessory: PlatformAccessory,
    private readonly type: SwitchType,
    private readonly hbApi: API
  ) {
    const { Service, Characteristic } = this.hbApi.hap;
    this.Characteristic = Characteristic;
    this.displayName = `${device.name} ${type}`;
    this.service = accessory.getService(Service.Switch) || accessory.addService(Service.Switch, this.displayName);
    accessory.getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Harvia')
      .setCharacteristic(Characteristic.Model, 'Fenix')
      .setCharacteristic(Characteristic.SerialNumber, `${device.id}-${type}`);
    this.service
      .getCharacteristic(Characteristic.On)
      .onGet(() => this.getCurrentState())
      .onSet(async (value: CharacteristicValue) => {
        await this.setState(value === true || value === 1);
      });
    this.device.subscribe(this);
  }

  public onDeviceUpdate(): void {
    this.service.updateCharacteristic(this.Characteristic.On, this.getCurrentState());
  }

  private getCurrentState(): boolean {
    switch (this.type) {
      case 'power': return this.device.active;
      case 'light': return this.device.lightsOn;
      case 'fan': return this.device.fanOn;
      case 'steamer': return this.device.steamOn;
    }
  }

  private async setState(value: boolean): Promise<void> {
    switch (this.type) {
      case 'power': await this.device.setActive(value); break;
      case 'light': await this.device.setLight(value); break;
      case 'fan': await this.device.setFan(value); break;
      case 'steamer': await this.device.setSteamer(value); break;
    }
  }
}
