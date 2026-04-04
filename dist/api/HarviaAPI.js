"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HarviaAPI = void 0;
const axios_1 = __importDefault(require("axios"));
const amazon_cognito_identity_js_1 = require("amazon-cognito-identity-js");
class HarviaAPI {
    constructor() {
        this.endpoints = {
            users: null,
            device: null,
            events: null,
            data: null,
        };
        this.idToken = null;
        this.refreshToken = null;
        this.cognitoUser = null;
        this.tokenExpiresAt = 0;
        this.userData = null;
    }
    async discoverEndpoints() {
        const endpointTypes = ['users', 'device', 'events', 'data'];
        for (const endpointType of endpointTypes) {
            this.endpoints[endpointType] = await this.fetchEndpoint(endpointType);
        }
    }
    async fetchEndpoint(endpointType) {
        const url = `https://prod.myharvia-cloud.net/${endpointType}/endpoint`;
        const response = await axios_1.default.get(url);
        return response.data;
    }
    getEndpoint(endpointType) {
        const endpoint = this.endpoints[endpointType];
        if (!endpoint || !endpoint.endpoint) {
            throw new Error(`Missing endpoint for ${endpointType}`);
        }
        return endpoint.endpoint;
    }
    getIdToken() {
        if (!this.idToken) {
            throw new Error('Not authenticated');
        }
        return this.idToken;
    }
    async authenticate(username, password) {
        await this.discoverEndpoints();
        const users = this.endpoints.users;
        if (!users?.endpoint || !users.clientId || !users.userPoolId) {
            throw new Error('Unable to resolve Cognito user pool configuration');
        }
        const userPool = new amazon_cognito_identity_js_1.CognitoUserPool({
            UserPoolId: users.userPoolId,
            ClientId: users.clientId,
        });
        const cognitoUser = new amazon_cognito_identity_js_1.CognitoUser({ Username: username, Pool: userPool });
        this.cognitoUser = cognitoUser;
        const authDetails = new amazon_cognito_identity_js_1.AuthenticationDetails({ Username: username, Password: password });
        const session = await new Promise((resolve, reject) => {
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
    async refreshSessionIfNeeded() {
        if (Date.now() < this.tokenExpiresAt)
            return;
        await this.refreshSession();
    }
    async refreshSession() {
        if (!this.cognitoUser || !this.refreshToken) {
            throw new Error('No active Cognito session to refresh');
        }
        const refreshToken = new amazon_cognito_identity_js_1.CognitoRefreshToken({ RefreshToken: this.refreshToken });
        const session = await new Promise((resolve, reject) => {
            this.cognitoUser.refreshSession(refreshToken, (err, newSession) => {
                if (err)
                    return reject(err);
                resolve(newSession);
            });
        });
        if (!session) {
            throw new Error('Failed to refresh Cognito session');
        }
        this.idToken = session.getIdToken().getJwtToken();
        this.tokenExpiresAt = Date.now() + 50 * 60 * 1000;
    }
    async appsyncRequest(endpointUrl, body) {
        await this.refreshSessionIfNeeded();
        const response = await axios_1.default.post(endpointUrl, body, {
            headers: {
                authorization: this.getIdToken(),
            },
        });
        return response.data;
    }
    async getWebSocketUrl(endpointType) {
        await this.refreshSessionIfNeeded();
        const httpsUrl = this.getEndpoint(endpointType);
        const wsUrl = httpsUrl.replace(/^https:\/\/(.+)\.appsync-api\.(.+)\/graphql$/, 'wss://$1.appsync-realtime-api.$2/graphql');
        const host = httpsUrl.replace(/^https:\/\/(.+)\.appsync-api\.(.+)\/graphql$/, '$1.appsync-api.$2');
        const headerJson = JSON.stringify({ Authorization: this.idToken, host }, null, 4);
        const encodedHeader = encodeURIComponent(Buffer.from(headerJson).toString('base64'));
        return `${wsUrl}?header=${encodedHeader}&payload=e30=`;
    }
    async getUserData() {
        if (this.userData)
            return this.userData;
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
        this.userData = user;
        return this.userData;
    }
}
exports.HarviaAPI = HarviaAPI;
