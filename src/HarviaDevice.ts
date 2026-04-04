import { HarviaAPI } from './api/HarviaAPI';

export interface DeviceStateSubscriber {
  onDeviceUpdate(device: HarviaDevice): void;
}

export class HarviaDevice {
  public active = false;
  public lightsOn = false;
  public fanOn = false;
  public steamOn = false;
  public targetTemp = 40;
  public targetRh = 0;
  public currentTemp = 0;
  public humidity = 0;
  public heatUpTime = 0;
  public remainingTime = 0;
  public statusCodes: string | number = '';

  public get isDoorOpen(): boolean {
    return String(this.statusCodes).length > 1
      && String(this.statusCodes)[1] === '9';
  }

  public lastUpdate: Date | null = null;

  private subscribers = new Set<DeviceStateSubscriber>();

  constructor(
    private readonly api: HarviaAPI,
    public readonly id: string,
    public readonly name: string
  ) {}

  public subscribe(subscriber: DeviceStateSubscriber): void {
    this.subscribers.add(subscriber);
    subscriber.onDeviceUpdate(this);
  }

  private notifySubscribers(): void {
    for (const subscriber of this.subscribers) {
      subscriber.onDeviceUpdate(this);
    }
  }

  public updateData(data: any): void {
    if (!data || typeof data !== 'object') return;
    if ('active' in data) this.active = Boolean(data.active);
    if ('heatOn' in data) this.active = Boolean(data.heatOn);
    if ('light' in data) this.lightsOn = Boolean(data.light);
    if ('fan' in data) this.fanOn = Boolean(data.fan);
    if ('steamEn' in data) this.steamOn = Boolean(data.steamEn);
    if ('steamOn' in data) this.steamOn = Boolean(data.steamOn);
    if ('targetTemp' in data) this.targetTemp = Number(data.targetTemp);
    if ('targetRh' in data) this.targetRh = Number(data.targetRh);
    if ('temperature' in data) this.currentTemp = Number(data.temperature);
    if ('humidity' in data) this.humidity = Number(data.humidity);
    if ('heatUpTime' in data) this.heatUpTime = Number(data.heatUpTime);
    if ('remainingTime' in data) this.remainingTime = Number(data.remainingTime);
    if ('statusCodes' in data) this.statusCodes = data.statusCodes;
    this.lastUpdate = new Date();
    this.notifySubscribers();
  }

  private getEndpoint(): string {
    return this.api.getEndpoint('device');
  }

  private async requestStateChange(payload: Record<string, unknown>): Promise<void> {
    const body = {
      operationName: 'Mutation',
      variables: {
        deviceId: this.id,
        state: JSON.stringify(payload),
        getFullState: false,
      },
      query: `mutation Mutation($deviceId: ID!, $state: AWSJSON!, $getFullState: Boolean) {\n  requestStateChange(deviceId: $deviceId, state: $state, getFullState: $getFullState)\n}\n`,
    };
    await this.api.appsyncRequest(this.getEndpoint(), body);
  }

  public async setActive(value: boolean): Promise<void> {
    await this.requestStateChange({ active: value ? 1 : 0 });
  }

  public async setLight(value: boolean): Promise<void> {
    await this.requestStateChange({ light: value ? 1 : 0 });
  }

  public async setFan(value: boolean): Promise<void> {
    await this.requestStateChange({ fan: value ? 1 : 0 });
  }

  public async setSteamer(value: boolean): Promise<void> {
    await this.requestStateChange({ steamEn: value ? 1 : 0 });
  }

  public async setTargetTemperature(value: number): Promise<void> {
    await this.requestStateChange({ targetTemp: value });
  }

  public async setTargetHumidity(value: number): Promise<void> {
    await this.requestStateChange({ targetRh: value });
  }
}
