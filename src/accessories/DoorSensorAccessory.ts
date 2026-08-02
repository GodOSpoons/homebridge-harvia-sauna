import { HarviaDevice, DeviceStateSubscriber } from '../HarviaDevice';
import { PlatformAccessory, Logger, API, HAP } from 'homebridge';
import type { Service } from 'homebridge';

export class DoorSensorAccessory implements DeviceStateSubscriber {
  private readonly service: Service;
  private readonly Characteristic: HAP['Characteristic'];

  constructor(
    private readonly log: Logger,
    private readonly device: HarviaDevice,
    accessory: PlatformAccessory,
    private readonly hbApi: API
  ) {
    const { Service, Characteristic } = this.hbApi.hap;
    this.Characteristic = Characteristic;
    this.service =
      accessory.getService(Service.ContactSensor) ||
      accessory.addService(Service.ContactSensor, `${device.name} Door`);
    this.service
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() =>
        this.device.doorOpen
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED
      );
    this.device.subscribe(this);
  }

  public onDeviceUpdate(): void {
    const doorOpen = Boolean(this.device.doorOpen);
    this.service.updateCharacteristic(
      this.Characteristic.ContactSensorState,
      doorOpen
        ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
        : this.Characteristic.ContactSensorState.CONTACT_DETECTED
    );
  }
}
