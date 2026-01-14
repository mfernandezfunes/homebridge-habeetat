/**
 * Plugin settings and constants
 */

export const PLUGIN_NAME = 'homebridge-habeetat';
export const PLATFORM_NAME = 'Habeetat';

/**
 * MQTT Topics used by habeetat-bridge
 */
export const MQTT_TOPICS = {
  STATE_SUFFIX: '/state',
  COMMAND_SUFFIX: '/set',
  AVAILABILITY_SUFFIX: '/availability',
  DISCOVERY_PREFIX: 'homeassistant',
};

/**
 * Device types supported by the plugin
 */
export enum DeviceType {
  SWITCH = 'switch',
  LIGHT = 'light',
  DIMMER = 'dimmer',
  RGB = 'rgb',
  RGB_LIGHT = 'rgb_light',
  COVER = 'cover',
  CURTAIN = 'curtain',
  CLIMATE = 'climate',
  TEMPERATURE_SENSOR = 'temperature_sensor',
  LIGHT_SENSOR = 'light_sensor',
}
