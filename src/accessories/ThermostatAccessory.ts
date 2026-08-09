import { HarviaDevice, DeviceStateSubscriber } from '../HarviaDevice';
import { PlatformAccessory, Logger, CharacteristicValue, API, HAP } from 'homebridge';
import type { Service, Characteristic as CharacteristicBase } from 'homebridge';
import { runHarviaCommand } from './commandError';
import { createCurrentConsumptionCharacteristic } from './eveCharacteristics';

export class ThermostatAccessory implements DeviceStateSubscriber {
  private readonly service: Service;
  private readonly Characteristic: HAP['Characteristic'];
  private readonly currentConsumption: CharacteristicBase;

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
    // RemainingDuration isn't a standard HeaterCooler characteristic (HAP
    // will log a harmless "not in required or optional section" warning
    // when it's first added) — it's the closest HomeKit-native fit for a
    // session countdown, and shows as an extra row in the detail sheet.
    // The API's remainingTime unit isn't confirmed (sibling fields like
    // maxOnTime/profile duration are minutes) — passed through raw here;
    // if the displayed value looks off by 60x, this needs a conversion.
    this.service
      .getCharacteristic(Characteristic.RemainingDuration)
      .setProps({ minValue: 0, maxValue: 7200 })
      .onGet(() => this.device.remainingTime);

    // Real-time heater wattage. Classic HAP has no watts characteristic at
    // all (Apple's Home Energy tab reads Matter, not HAP, so there's no
    // native path there either) — this is Eve Systems' de facto custom
    // characteristic, widely reused across Homebridge plugins. Apple's own
    // Home app won't show it (it ignores characteristics it doesn't
    // recognize); the free Eve app will, as live wattage with a history
    // graph.
    const CurrentConsumption = createCurrentConsumptionCharacteristic(this.hbApi.hap);
    this.currentConsumption = this.service.getCharacteristic(CurrentConsumption);
    this.currentConsumption.onGet(() => this.device.heaterPower);

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
    this.service.updateCharacteristic(
      this.Characteristic.RemainingDuration,
      this.device.remainingTime
    );
    this.currentConsumption.updateValue(this.device.heaterPower);
  }
}
