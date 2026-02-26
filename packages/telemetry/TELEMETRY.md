# Twick Telemetry

Telemetry is disabled by default.

## Enable telemetry

Set all required variables:

- `TWICK_TELEMETRY_ENABLED=true`
- `TWICK_TELEMETRY_API_KEY=<your_posthog_key>`
- Optional: `TWICK_TELEMETRY_HOST=https://eu.posthog.com`

## Disable telemetry

Any of the following disables telemetry:

- `DISABLE_TELEMETRY=true`
- Omit `TWICK_TELEMETRY_ENABLED=true`
- Omit `TWICK_TELEMETRY_API_KEY`

## Local install identifier

When telemetry is enabled, postinstall may create `~/.twick/id.txt`.

Disable id file creation with:

- `TWICK_TELEMETRY_NO_ID_FILE=true`

## Events

Current event names:

- `twick-render-started`
- `twick-server-started`
- `twick-cli-command`
- `twick-create-command`
- `twick-error`
