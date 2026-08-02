import { HarviaAPI } from './api/HarviaAPI';

export interface DeviceStateSubscriber {
  onDeviceUpdate(device: HarviaDevice): void;
}

// 'sensor' identifies a satellite device like the SAM001W: no heater
// controls, just temperature/humidity telemetry. Set once at discovery
// time by HarviaPlatform (see normalize.isHeaterStatePayload).
export type DeviceKind = 'heater' | 'sensor';

export class HarviaDevice {
  public kind: DeviceKind = 'heater';
  public active = false;
  public heatOn = false;
  public lightsOn = false;
  public fanOn = false;
  public steamOn = false;
  public targetTemp = 40;
  public targetRh = 0;
  public currentTemp = 0;
  public humidity = 0;
  public remainingTime = 0;
  public doorOpen: boolean | null = null;

  public lastUpdate: Date | null = null;

  private subscribers = new Set<DeviceStateSubscriber>();

  constructor(
    private readonly api: HarviaAPI,
    public readonly id: string,
    public name: string
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

  // Expects an already-normalized payload (see api/normalize.ts) — not raw
  // API JSON — so field names are consistent regardless of whether the
  // update came from a REST poll or a state/telemetry websocket feed.
  public updateData(data: Record<string, unknown> | null | undefined): void {
    if (!data || typeof data !== 'object') return;
    if ('displayName' in data && typeof data.displayName === 'string' && data.displayName) {
      this.name = data.displayName;
    }
    if ('active' in data) this.active = Boolean(data.active);
    if ('heatOn' in data) this.heatOn = Boolean(data.heatOn);
    if ('light' in data) this.lightsOn = Boolean(data.light);
    if ('fan' in data) this.fanOn = Boolean(data.fan);
    if ('steamEn' in data) this.steamOn = Boolean(data.steamEn);
    if ('steamOn' in data) this.steamOn = Boolean(data.steamOn);
    if ('targetTemp' in data) this.targetTemp = Number(data.targetTemp);
    if ('targetRh' in data) this.targetRh = Number(data.targetRh);
    if ('temperature' in data) this.currentTemp = Number(data.temperature);
    if ('humidity' in data) this.humidity = Number(data.humidity);
    if ('remainingTime' in data) this.remainingTime = Number(data.remainingTime);
    if ('doorOpen' in data) this.doorOpen = Boolean(data.doorOpen);
    this.lastUpdate = new Date();
    this.notifySubscribers();
  }

  private async requestStateChange(payload: Parameters<HarviaAPI['requestStateChange']>[1]): Promise<void> {
    await this.api.requestStateChange(this.id, payload);
  }

  public async setActive(value: boolean): Promise<void> {
    await this.requestStateChange({ active: value });
  }

  public async setLight(value: boolean): Promise<void> {
    await this.requestStateChange({ light: value });
  }

  public async setFan(value: boolean): Promise<void> {
    await this.requestStateChange({ fan: value });
  }

  public async setSteamer(value: boolean): Promise<void> {
    await this.requestStateChange({ steamEn: value });
  }

  public async setTargetTemperature(value: number): Promise<void> {
    await this.requestStateChange({ targetTemp: value });
  }

  public async setTargetHumidity(value: number): Promise<void> {
    await this.requestStateChange({ targetRh: value });
  }
}
