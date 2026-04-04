"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThermostatAccessory = void 0;
class ThermostatAccessory {
    constructor(log, device, accessory, hbApi) {
        this.log = log;
        this.device = device;
        this.hbApi = hbApi;
        const { Service, Characteristic } = this.hbApi.hap;
        this.Characteristic = Characteristic;
        this.service =
            accessory.getService(Service.HeaterCooler) ||
                accessory.addService(Service.HeaterCooler, `${device.name} Thermostat`);
        this.service.setCharacteristic(Characteristic.CurrentHeaterCoolerState, Characteristic.CurrentHeaterCoolerState.INACTIVE);
        this.service.setCharacteristic(Characteristic.TargetHeaterCoolerState, Characteristic.TargetHeaterCoolerState.HEAT);
        const target = this.service.getCharacteristic(Characteristic.TargetHeaterCoolerState);
        target.setProps({ validValues: [Characteristic.TargetHeaterCoolerState.HEAT] });
        this.service
            .getCharacteristic(Characteristic.Active)
            .onGet(() => (this.device.active
            ? Characteristic.Active.ACTIVE
            : Characteristic.Active.INACTIVE))
            .onSet(async (value) => {
            await this.device.setActive(value === Characteristic.Active.ACTIVE);
        });
        this.service
            .getCharacteristic(Characteristic.CurrentTemperature)
            .onGet(() => this.device.currentTemp);
        this.service
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({ minValue: 40, maxValue: 110, minStep: 1 })
            .onGet(() => this.device.targetTemp)
            .onSet(async (value) => {
            await this.device.setTargetTemperature(Number(value));
        });
        this.device.subscribe(this);
    }
    onDeviceUpdate() {
        this.service.updateCharacteristic(this.Characteristic.Active, this.device.active
            ? this.Characteristic.Active.ACTIVE
            : this.Characteristic.Active.INACTIVE);
        this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, this.device.currentTemp);
        this.service.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, this.device.active
            ? this.Characteristic.CurrentHeaterCoolerState.HEATING
            : this.Characteristic.CurrentHeaterCoolerState.INACTIVE);
        this.service.updateCharacteristic(this.Characteristic.TargetHeaterCoolerState, this.Characteristic.TargetHeaterCoolerState.HEAT);
        this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, this.device.targetTemp);
    }
}
exports.ThermostatAccessory = ThermostatAccessory;
