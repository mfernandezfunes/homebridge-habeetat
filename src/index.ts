import { API } from 'homebridge';
import { HabeetatPlatform } from './platform';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

/**
 * Register the platform with Homebridge
 */
export = (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HabeetatPlatform);
};
