# Security Policy

## Sensitive Data

Apple Health exports can include highly sensitive health data. Do not share:

- `export.xml`
- `export.zip`
- Apple Health export directories
- Raw health records
- Local MCP config files that reveal personal filesystem paths

The connector is designed to read local files and return bounded summaries or filtered records. It does not need Apple ID credentials and does not provide live HealthKit access.

## Reporting Issues

Open a GitHub issue for security-relevant behavior without attaching private health exports. Use synthetic fixtures when possible.
