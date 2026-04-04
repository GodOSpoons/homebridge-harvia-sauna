import axios from 'axios';
import {
  AuthenticationDetails,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserPool,
} from 'amazon-cognito-identity-js';

export type EndpointType = 'users' | 'device' | 'events' | 'data';

export interface EndpointConfig {
  endpoint: string;
  clientId?: string;
  userPoolId?: string;
  identityPoolId?: string;
}

export interface UserData {
  email: string;
  organizationId: string;
  admin: boolean;
  __typename: string;
}

export class HarviaAPI {
  private endpoints: Record<EndpointType, EndpointConfig | null> = {
    users: null,
    device: null,
    events: null,
    data: null,
  };

  private idToken: string | null = null;
  private refreshToken: string | null = null;
  private cognitoUser: CognitoUser | null = null;
  private tokenExpiresAt = 0;
  private userData: UserData | null = null;

  public async discoverEndpoints(): Promise<void> {
    const endpointTypes: EndpointType[] = ['users', 'device', 'events', 'data'];

    for (const endpointType of endpointTypes) {
      this.endpoints[endpointType] = await this.fetchEndpoint(endpointType);
    }
  }

  private async fetchEndpoint(endpointType: EndpointType): Promise<EndpointConfig> {
    const url = `https://prod.myharvia-cloud.net/${endpointType}/endpoint`;
    const response = await axios.get<EndpointConfig>(url);
    return response.data;
  }

  public getEndpoint(endpointType: EndpointType): string {
    const endpoint = this.endpoints[endpointType];
    if (!endpoint || !endpoint.endpoint) {
      throw new Error(`Missing endpoint for ${endpointType}`);
    }
    return endpoint.endpoint;
  }

  public getIdToken(): string {
    if (!this.idToken) {
      throw new Error('Not authenticated');
    }
    return this.idToken;
  }

  public async authenticate(username: string, password: string): Promise<UserData> {
    await this.discoverEndpoints();

    const users = this.endpoints.users;
    if (!users?.endpoint || !users.clientId || !users.userPoolId) {
      throw new Error('Unable to resolve Cognito user pool configuration');
    }

    const userPool = new CognitoUserPool({
      UserPoolId: users.userPoolId,
      ClientId: users.clientId,
    });

    const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
    this.cognitoUser = cognitoUser;

    const authDetails = new AuthenticationDetails({ Username: username, Password: password });

    const session = await new Promise<any>((resolve, reject) => {
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: resolve,
        onFailure: reject,
      });
    });

    const idToken = session.getIdToken().getJwtToken();
    const refreshToken = session.getRefreshToken().getToken();

    this.idToken = idToken;
    this.refreshToken = refreshToken;
    this.tokenExpiresAt = Date.now() + 50 * 60 * 1000;

    return this.getUserData();
  }

  public async refreshSessionIfNeeded(): Promise<void> {
    if (Date.now() < this.tokenExpiresAt) return;
    await this.refreshSession();
  }

  public async refreshSession(): Promise<void> {
    if (!this.cognitoUser || !this.refreshToken) {
      throw new Error('No active Cognito session to refresh');
    }

    const refreshToken = new CognitoRefreshToken({ RefreshToken: this.refreshToken });
    const session = await new Promise<any>((resolve, reject) => {
      this.cognitoUser!.refreshSession(refreshToken, (err, newSession) => {
        if (err) return reject(err);
        resolve(newSession);
      });
    });

    if (!session) {
      throw new Error('Failed to refresh Cognito session');
    }

    this.idToken = session.getIdToken().getJwtToken();
    this.tokenExpiresAt = Date.now() + 50 * 60 * 1000;
  }

  public async appsyncRequest(endpointUrl: string, body: Record<string, unknown>): Promise<any> {
    await this.refreshSessionIfNeeded();

    const response = await axios.post(endpointUrl, body, {
      headers: {
        authorization: this.getIdToken(),
      },
    });

    return response.data;
  }

  public async getWebSocketUrl(endpointType: string): Promise<string> {
    await this.refreshSessionIfNeeded();
    const httpsUrl = this.getEndpoint(endpointType as EndpointType);

    const wsUrl = httpsUrl.replace(
      /^https:\/\/(.+)\.appsync-api\.(.+)\/graphql$/,
      'wss://$1.appsync-realtime-api.$2/graphql'
    );
    const host = httpsUrl.replace(
      /^https:\/\/(.+)\.appsync-api\.(.+)\/graphql$/,
      '$1.appsync-api.$2'
    );

    const headerJson = JSON.stringify({ Authorization: this.idToken!, host }, null, 4);
    const encodedHeader = encodeURIComponent(Buffer.from(headerJson).toString('base64'));

    return `${wsUrl}?header=${encodedHeader}&payload=e30=`;
  }

  public async getUserData(): Promise<UserData> {
    if (this.userData) return this.userData;

    const endpointUrl = this.getEndpoint('users');
    const resp = await this.appsyncRequest(endpointUrl, {
      operationName: 'Query',
      variables: {},
      query: `query Query {\n  getCurrentUserDetails {\n    email\n    organizationId\n    admin\n    __typename\n  }\n}\n`,
    });

    const user = resp.data?.getCurrentUserDetails;
    if (!user) {
      throw new Error('Unable to retrieve user details');
    }

    this.userData = user as UserData;
    return this.userData;
  }
}
