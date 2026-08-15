import { HarviaDevice, DeviceStateSubscriber } from '../HarviaDevice';
import { PlatformAccessory, Logger, CharacteristicValue, API, HAP } from 'homebridge';
import type { Service } from 'homebridge';
import { runHarviaCommand } from './commandError';

export class ThermostatAccessory implements DeviceStateSubscriber {
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
      accessory.getService(Service.HeaterCooler) ||
      accessory.addService(Service.HeaterCooler, `${device.name} Thermostat`);
    this.service.setCharacteristic(
      Characteristic.CurrentHeaterCoolerState,
      Characteristic.CurrentHeaterCoolerState.INACTIVE
    );
    this.service.setCharacteristic(
      Characteristic.TargetHeaterCoolerState,
      Characteristic.TargetHeaterCoolerState.HEAT
    );
    const target = this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState);
    target.setProps({ validValues: [Characteristic.TargetHeaterCoolerState.HEAT] });
    this.service
      .getCharacteristic(Characteristic.Active)
      .onGet(() => (this.device.active
        ? Characteristic.Active.ACTIVE
        : Characteristic.Active.INACTIVE))
      .onSet(async (value: CharacteristicValue) => {
        await runHarviaCommand(this.log, this.hbApi.hap, `${device.name} power set`, () =>
          this.device.setActive(value === Characteristic.Active.ACTIVE));
      });
    this.service
      .getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.device.currentTemp);
    this.service
      .getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .setProps({ minValue: 40, maxValue: 110, minStep: 1 })
      .onGet(() => this.device.targetTemp)
      .onSet(async (value: CharacteristicValue) => {
        await runHarviaCommand(this.log, this.hbApi.hap, `${device.name} target temperature set`, () =>
          this.device.setTargetTemperature(Number(value)));
      });
    this.device.subscribe(this);
  }

  public onDeviceUpdate(): void {
    this.service.updateCharacteristic(
      this.Characteristic.Active,
      this.device.active
        ? this.Characteristic.Active.ACTIVE
        : this.Characteristic.Active.INACTIVE
    );
    this.service.updateCharacteristic(
      this.Characteristic.CurrentTemperature,
      this.device.currentTemp
    );
    this.service.updateCharacteristic(
      this.Characteristic.CurrentHeaterCoolerState,
      !this.device.active
        ? this.Characteristic.CurrentHeaterCoolerState.INACTIVE
        : this.device.heatOn
          ? this.Characteristic.CurrentHeaterCoolerState.HEATING
          : this.Characteristic.CurrentHeaterCoolerState.IDLE
    );
    this.service.updateCharacteristic(
      this.Characteristic.TargetHeaterCoolerState,
      this.Characteristic.TargetHeaterCoolerState.HEAT
    );
    this.service.updateCharacteristic(
      this.Characteristic.HeatingThresholdTemperature,
      this.device.targetTemp
    );
  }
}
