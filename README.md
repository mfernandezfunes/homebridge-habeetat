# homebridge-habeetat

Homebridge plugin for Solidmation Habeetat smart home devices via MQTT.

This plugin connects to the same MQTT broker used by [habeetat-bridge](https://github.com/mfernandezfunes/habeetat-bridge) to expose your Habeetat devices to Apple HomeKit.

## Supported Devices

| Device | Model | HomeKit Service |
|--------|-------|-----------------|
| Switch | HPA-4133 | Switch |
| Dimmer | HPA-4153, HPA-2140 | Lightbulb |
| RGB Light | HPA-2160 | Lightbulb (with color) |
| Cover/Curtain | HPA-4202 | WindowCovering |
| Climate/HVAC | BGH-7012 | Thermostat |
| Temperature Sensor | HPA-2411 | TemperatureSensor |

## Prerequisites

- [Homebridge](https://homebridge.io/) v1.6.0 or later
- [habeetat-bridge](https://github.com/mfernandezfunes/habeetat-bridge) running and connected to MQTT
- MQTT broker (e.g., Mosquitto)

## Installation

### Via Homebridge Config UI X (Recommended)

1. Search for `homebridge-habeetat` in the Plugins tab
2. Click Install
3. Configure the plugin in the Settings tab

### Via npm

```bash
npm install -g homebridge-habeetat
```

### Local Installation (Development)

#### Option 1: Using npm link

```bash
# Clone and build
git clone https://github.com/mfernandezfunes/homebridge-habeetat.git
cd homebridge-habeetat
npm install
npm run build

# Create global symlink
npm link

# Link to Homebridge (run in Homebridge directory, e.g. ~/.homebridge)
cd ~/.homebridge
npm link homebridge-habeetat
```

#### Option 2: Install directly from local directory

```bash
# Clone and build
git clone https://github.com/mfernandezfunes/homebridge-habeetat.git
cd homebridge-habeetat
npm install
npm run build

# Install globally from local directory
npm install -g /path/to/homebridge-habeetat
```

### Publishing to npm (for production)

```bash
# Build and publish
npm run build
npm publish
```

Then install from npm:

```bash
npm install -g homebridge-habeetat
```

After installation, restart Homebridge to load the plugin.

## Configuration

Add the following to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "Habeetat",
      "name": "Habeetat",
      "mqtt": {
        "broker": "localhost",
        "port": 1883,
        "username": "",
        "password": ""
      },
      "baseTopic": "habeetat"
    }
  ]
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | - | Must be `"Habeetat"` |
| `name` | Yes | `"Habeetat"` | Platform name |
| `mqtt.broker` | Yes | - | MQTT broker hostname or IP |
| `mqtt.port` | No | `1883` | MQTT broker port |
| `mqtt.username` | No | - | MQTT username |
| `mqtt.password` | No | - | MQTT password |
| `baseTopic` | No | `"habeetat"` | Base MQTT topic |

## How It Works

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────────┐     ┌─────────┐
│   Habeetat  │────▶│ habeetat-bridge │────▶│     MQTT Broker      │────▶│HomeKit  │
│   Devices   │◀────│                 │◀────│                      │◀────│(via HB) │
└─────────────┘     └─────────────────┘     └──────────────────────┘     └─────────┘
                                                      ▲
                                                      │
                                            ┌─────────┴─────────┐
                                            │homebridge-habeetat│
                                            └───────────────────┘
```

1. **habeetat-bridge** communicates with your Habeetat devices (ZigBee/WiFi)
2. Device states and commands are published to **MQTT**
3. **homebridge-habeetat** subscribes to MQTT and creates HomeKit accessories
4. You control devices via **Apple Home** app or Siri

## Device Discovery

Devices are automatically discovered via MQTT when habeetat-bridge publishes Home Assistant discovery messages. No manual configuration is required for most setups.

### Manual Device Configuration

If auto-discovery doesn't work, you can manually configure devices:

```json
{
  "platforms": [
    {
      "platform": "Habeetat",
      "mqtt": { "broker": "localhost" },
      "devices": [
        {
          "uniqueId": "ACCF23961A64_1",
          "name": "Living Room Light",
          "type": "dimmer",
          "stateTopic": "habeetat/ACCF23961A64_1/state",
          "commandTopic": "habeetat/ACCF23961A64_1/set"
        }
      ]
    }
  ]
}
```

## Development

```bash
# Clone the repository
git clone https://github.com/mfernandezfunes/homebridge-habeetat.git
cd homebridge-habeetat

# Install dependencies
npm install

# Build
npm run build

# Link for local development
npm link

# Watch mode
npm run watch
```

## Troubleshooting

### Devices not appearing

1. Ensure habeetat-bridge is running and connected to MQTT
2. Check that the MQTT broker address is correct
3. Verify the `baseTopic` matches habeetat-bridge configuration
4. Check Homebridge logs for connection errors

### Devices not responding

1. Verify habeetat-bridge can control the device directly
2. Check MQTT broker logs for message delivery
3. Ensure the device is online in habeetat-bridge

### Enable Debug Logging

Add to your Homebridge config:

```json
{
  "bridge": {
    "name": "Homebridge",
    "debug": true
  }
}
```

## License

MIT

## Credits

- [Homebridge](https://homebridge.io/)
- [habeetat-bridge](https://github.com/mfernandezfunes/habeetat-bridge)
- [Solidmation](http://www.solidmation.com/) - Habeetat device manufacturer
