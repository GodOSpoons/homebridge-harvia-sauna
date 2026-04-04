import { HarviaDevice, DeviceStateSubscriber } from '../HarviaDevice';
import { PlatformAccessory, Logger, API } from 'homebridge';
import type { Service, Characteristic } from 'homebridge';

export class DoorSensorAccessory implements DeviceStateSubscriber {
  private readonly service: Service;
  private readonly Characteristic: typeof Characteristic;

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
        this.device.isDoorOpen
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED
      );

    this.device.subscribe(this);
  }

  public onDeviceUpdate(): void {
    const doorOpen = this.device.isDoorOpen;
    this.service.updateCharacteristic(
      this.Characteristic.ContactSensorState,
      doorOpen ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : this.Characteristic.ContactSensorState.CONTACT_DETECTED
    );
  }
}
