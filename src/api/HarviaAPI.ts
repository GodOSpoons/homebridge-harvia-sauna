import axios from 'axios';
import { HarviaAuthError, HarviaConnectionError, HarviaEntitlementError } from './errors';

const HARVIA_ENDPOINTS_URL = 'https://api.harvia.io/endpoints';

export type RestService = 'generics' | 'device' | 'data';
export type GraphQLService = 'device' | 'data';

interface EndpointGroup {
  [service: string]: { https?: string } | undefined;
}

interface Endpoints {
  RestApi?: EndpointGroup;
  GraphQL?: EndpointGroup;
}

interface TokenData {
  idToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface UserData {
  email: string;
  organizationId: string;
  username: string;
}

export interface DeviceListItem {
  deviceId: string;
  raw: Record<string, unknown>;
}

export interface StateChangePayload {
  active?: boolean;
  light?: boolean;
  fan?: boolean;
  steamEn?: boolean;
  targetTemp?: number;
  targetRh?: number;
}

export interface WebSocketInfo {
  wssUrl: string;
  host: string;
}

export class HarviaAPI {
  private endpoints: Endpoints | null = null;
  private username = '';
  private password = '';
  private tokenData: TokenData | null = null;
  private tokenExpiresAt = 0;
  private userData: UserData | null = null;

  public async authenticate(username: string, password: string): Promise<void> {
    this.username = username;
    this.password = password;
    await this.ensureValidToken();
  }

  public getIdToken(): string {
    if (!this.tokenData?.idToken) {
      throw new HarviaAuthError('Not authenticated');
    }
    return this.tokenData.idToken;
  }

  public async getUserData(): Promise<UserData> {
    if (this.userData) return this.userData;
    await this.ensureValidToken();
    const claims = decodeJwtPayload(this.getIdToken());
    this.userData = {
      email: (claims.email as string) || this.username,
      organizationId: (claims['custom:organizationId'] as string) || '',
      username: (claims['cognito:username'] as string) || '',
    };
    return this.userData;
  }

  public async getDevices(): Promise<DeviceListItem[]> {
    const devices: DeviceListItem[] = [];
    let nextToken: string | undefined;

    do {
      const params: Record<string, unknown> = { maxResults: 100 };
      if (nextToken) params.nextToken = nextToken;
      const data = await this.restRequest('device', 'GET', '/devices', params);
      for (const item of extractDeviceItems(data)) {
        const id = extractDeviceId(item);
        if (id) devices.push({ deviceId: id, raw: item });
      }
      nextToken = typeof data?.nextToken === 'string' ? data.nextToken : undefined;
    } while (nextToken);

    if (devices.length > 0) return devices;

    try {
      const gql = await this.graphqlRequest(
        'device',
        'query ListMyDevices {\n  devicesMeList(maxResults: 100) {\n    devices {\n      deviceId\n      type\n      via\n    }\n    nextToken\n  }\n}\n'
      );
      const gqlDevices: Array<Record<string, unknown>> = gql?.data?.devicesMeList?.devices ?? [];
      for (const item of gqlDevices) {
        const id = extractDeviceId(item);
        if (id) devices.push({ deviceId: id, raw: item });
      }
    } catch {
      // Best-effort fallback only; an empty device list is reported to the caller.
    }

    return devices;
  }

  public async getDeviceState(deviceId: string): Promise<Record<string, unknown>> {
    return this.restRequest('device', 'GET', '/devices/state', { deviceId, subId: 'C1' });
  }

  public async getLatestDeviceData(deviceId: string): Promise<Record<string, unknown>> {
    return this.restRequest('data', 'GET', '/data/latest-data', { deviceId, cabinId: 'C1' });
  }

  public async requestStateChange(deviceId: string, payload: StateChangePayload): Promise<void> {
    const commandKeys: Array<[keyof StateChangePayload, string]> = [
      ['active', 'SAUNA'],
      ['light', 'LIGHTS'],
      ['fan', 'FAN'],
      ['steamEn', 'STEAMER'],
    ];

    for (const [key, command] of commandKeys) {
      if (payload[key] === undefined) continue;
      await this.restRequest('device', 'POST', '/devices/command', undefined, {
        deviceId,
        cabin: { id: 'C1' },
        command: { type: command, state: payload[key] ? 'on' : 'off' },
      });
    }

    const targetPatch: Record<string, unknown> = { deviceId, cabin: { id: 'C1' } };
    if (payload.targetTemp !== undefined) targetPatch.temperature = payload.targetTemp;
    if (payload.targetRh !== undefined) targetPatch.humidity = payload.targetRh;
    if (Object.keys(targetPatch).length > 2) {
      await this.restRequest('device', 'PATCH', '/devices/target', undefined, targetPatch);
    }
  }

  public async getWebSocketInfo(service: GraphQLService): Promise<WebSocketInfo> {
    const graphqlUrl = await this.getGraphqlUrl(service);
    if (!graphqlUrl.endsWith('/graphql')) {
      throw new HarviaConnectionError(`Unexpected GraphQL endpoint format for ${service}: ${graphqlUrl}`);
    }
    const wssUrl = graphqlUrl.replace('https://', 'wss://').replace('appsync-api', 'appsync-realtime-api');
    const host = graphqlUrl.replace('https://', '').replace('/graphql', '');
    return { wssUrl, host };
  }

  public async getWebSocketUrl(service: GraphQLService): Promise<string> {
    const { wssUrl, host } = await this.getWebSocketInfo(service);
    await this.ensureValidToken();
    const headerJson = JSON.stringify({ Authorization: `Bearer ${this.getIdToken()}`, host });
    const encodedHeader = encodeURIComponent(Buffer.from(headerJson).toString('base64'));
    return `${wssUrl}?header=${encodedHeader}&payload=e30=`;
  }

  private async ensureValidToken(): Promise<void> {
    if (this.tokenData?.idToken && Date.now() < this.tokenExpiresAt) return;

    if (this.tokenData?.refreshToken) {
      try {
        await this.refreshTokens();
        return;
      } catch {
        this.tokenData = null;
      }
    }

    await this.login();
  }

  private async login(): Promise<void> {
    const baseUrl = await this.getRestBaseUrl('generics');
    const data = await this.rawRequest(
      'POST',
      `${baseUrl}/auth/token`,
      { username: this.username, password: this.password },
      false
    );
    this.setTokenData(data);
  }

  private async refreshTokens(): Promise<void> {
    if (!this.tokenData?.refreshToken) {
      throw new HarviaAuthError('Missing refresh token');
    }
    const baseUrl = await this.getRestBaseUrl('generics');
    const data = await this.rawRequest(
      'POST',
      `${baseUrl}/auth/refresh`,
      { refreshToken: this.tokenData.refreshToken, email: this.username },
      false
    );
    if (!data.refreshToken && this.tokenData.refreshToken) {
      data.refreshToken = this.tokenData.refreshToken;
    }
    this.setTokenData(data);
  }

  private setTokenData(data: Record<string, unknown>): void {
    this.tokenData = {
      idToken: data.idToken as string,
      refreshToken: data.refreshToken as string | undefined,
      expiresIn: data.expiresIn as number | undefined,
    };
    const expiresIn = Number(data.expiresIn ?? 3600);
    this.tokenExpiresAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
  }

  private async fetchEndpoints(): Promise<Endpoints> {
    if (this.endpoints) return this.endpoints;
    try {
      const response = await axios.get(HARVIA_ENDPOINTS_URL);
      this.endpoints = response.data?.endpoints ?? {};
    } catch (err: any) {
      throw new HarviaConnectionError(`Endpoints discovery failed: ${err?.message ?? err}`);
    }
    return this.endpoints!;
  }

  private async getRestBaseUrl(service: RestService): Promise<string> {
    const endpoints = await this.fetchEndpoints();
    const url = endpoints.RestApi?.[service]?.https;
    if (!url) {
      throw new HarviaConnectionError(`Missing endpoints.RestApi.${service}.https`);
    }
    return url;
  }

  private async getGraphqlUrl(service: GraphQLService): Promise<string> {
    const endpoints = await this.fetchEndpoints();
    const url = endpoints.GraphQL?.[service]?.https;
    if (!url) {
      throw new HarviaConnectionError(`Missing endpoints.GraphQL.${service}.https`);
    }
    return url;
  }

  private async restRequest(
    service: RestService,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    params?: Record<string, unknown>,
    body?: unknown
  ): Promise<any> {
    const baseUrl = await this.getRestBaseUrl(service);
    let url = `${baseUrl}${path}`;
    if (params) {
      const query = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString();
      url = `${url}?${query}`;
    }
    return this.rawRequest(method, url, body, true);
  }

  private async graphqlRequest(
    service: GraphQLService,
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<any> {
    const url = await this.getGraphqlUrl(service);
    await this.ensureValidToken();
    let response;
    try {
      response = await axios.post(
        url,
        { query, variables },
        {
          headers: { authorization: `Bearer ${this.getIdToken()}`, 'content-type': 'application/json' },
          validateStatus: () => true,
        }
      );
    } catch (err: any) {
      throw new HarviaConnectionError(`GraphQL request failed: ${err?.message ?? err}`);
    }
    if (response.status === 401 || response.status === 403) {
      this.tokenData = null;
      throw new HarviaAuthError(`GraphQL HTTP ${response.status}`);
    }
    if (response.status >= 400) {
      throw new HarviaConnectionError(`GraphQL HTTP ${response.status}`);
    }
    if (response.data?.errors) {
      throw new HarviaConnectionError(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
    }
    return response.data;
  }

  private async rawRequest(
    method: string,
    url: string,
    body?: unknown,
    includeAuth = true
  ): Promise<any> {
    const headers: Record<string, string> = {};
    if (includeAuth) {
      await this.ensureValidToken();
      headers.authorization = `Bearer ${this.getIdToken()}`;
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    let response;
    try {
      response = await axios.request({ method, url, data: body, headers, validateStatus: () => true });
    } catch (err: any) {
      throw new HarviaConnectionError(`HTTP request failed: ${err?.message ?? err}`);
    }

    if (response.status === 401 || response.status === 403) {
      this.tokenData = null;
      throw new HarviaAuthError(`HTTP ${response.status}`);
    }
    if (response.status === 402) {
      throw new HarviaEntitlementError(
        'Remote control requires the MyHarvia Control license — this account is on the free Core tier, ' +
        'which only allows monitoring. Upgrade in the MyHarvia 2 app.'
      );
    }
    if (response.status >= 400) {
      throw new HarviaConnectionError(
        `HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 300)}`
      );
    }
    return response.data ?? {};
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function extractDeviceItems(payload: any): Array<Record<string, unknown>> {
  if (Array.isArray(payload?.devices)) {
    return payload.devices.filter((item: unknown) => item && typeof item === 'object');
  }
  if (Array.isArray(payload?.items)) {
    return payload.items.filter((item: unknown) => item && typeof item === 'object');
  }
  if (Array.isArray(payload?.results)) {
    return payload.results.filter((item: unknown) => item && typeof item === 'object');
  }

  const found: Array<Record<string, unknown>> = [];
  const idKeys = ['deviceId', 'name'];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const nested of value) walk(nested);
      return;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (idKeys.some((key) => typeof record[key] === 'string' && record[key])) {
        found.push(record);
      }
      for (const nested of Object.values(record)) walk(nested);
    }
  };
  walk(payload);
  return found;
}

function extractDeviceId(item: Record<string, unknown>): string | null {
  if (typeof item.deviceId === 'string' && item.deviceId) return item.deviceId;
  if (typeof item.name === 'string' && item.name) return item.name;
  return null;
}
