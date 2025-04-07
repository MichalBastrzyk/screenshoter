# Screenshoter

A powerful command-line tool for automated website section screenshots with support for animations, multiple devices, and flexible configuration options.

## Features

- 📱 Multi-device support (desktop, mobile, or both)
- ⚡ Animation trigger support for dynamic content
- 🎯 Capture specific sections using CSS selectors
- 🌳 Capture all children of a parent element
- ⚙️ Configurable wait conditions and timeouts
- 📁 JSON configuration file support
- 🎨 Smart viewport handling and element centering

## Installation

```bash
# Install dependencies
bun install

# Or if using npm
npm install
```

## Usage

Basic usage:

```bash
bun run index.ts --url https://example.com --selectors ".header" ".main-content"
```

Install as a command:

**NOTE:** Have a look at the `install.sh` script before running it. (You might want to change the installation path.)

```bash
bun run build

./install.sh
```

After that open a new terminal and you can use the `screenshoter` command.

```bash
screenshoter --url https://example.com --selectors ".header" ".main-content"
```

### Command Line Options

| Option                             | Description                                  | Default          |
| ---------------------------------- | -------------------------------------------- | ---------------- |
| `-u, --url <url>`                  | Website URL to screenshot (required)         | -                |
| `-s, --selectors <selectors...>`   | CSS selectors for sections to capture        | -                |
| `-p, --parent-selector <selector>` | Parent selector to capture all children      | -                |
| `-c, --config <path>`              | Path to config file                          | -                |
| `-w, --wait <ms>`                  | Wait time for animations in ms               | 1000             |
| `-a, --animation-trigger`          | Trigger scroll animations before capture     | false            |
| `-o, --output <directory>`         | Output directory                             | ./screenshots    |
| `-t, --navigation-timeout <ms>`    | Navigation timeout in ms                     | 60000            |
| `--wait-condition <condition>`     | Page load wait condition                     | domcontentloaded |
| `-d, --device <type>`              | Device type to capture (desktop/mobile/both) | both             |

### Examples

Capture specific sections:

```bash
bun run index.ts --url https://example.com --selectors ".header" ".hero" ".footer"
```

Capture with animation trigger:

```bash
bun run index.ts --url https://example.com --selectors ".animated-section" --animation-trigger --wait 2000
```

Capture all children of a parent:

```bash
bun run index.ts --url https://example.com --parent-selector "#main-container"
```

Using a config file:

```bash
bun run index.ts --url https://example.com --config screenshot-config.json
```

### Configuration File

You can specify selectors in a JSON configuration file:

```json
{
  "selectors": [".header", ".main-content", ".footer"]
}
```

## Device Configurations

### Desktop

- Width: 1500px
- Height: 1095px
- Scale Factor: 1x

### Mobile

- Width: 430px
- Height: 932px
- Scale Factor: 2x
- Mobile User Agent Enabled

## Output

Screenshots are saved to the specified output directory (default: `./screenshots`) with filenames formatted as:

```
{selector_name}__{device_type}.png
```

## Requirements

- [Bun](https://bun.sh)
- Playwright
- TypeScript

## License

MIT
