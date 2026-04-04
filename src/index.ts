import { API } from 'homebridge';
import { HarviaPlatform } from './HarviaPlatform';

export = (api: API) => {
  api.registerPlatform('homebridge-harvia', 'HarviaSauna', HarviaPlatform);
};
