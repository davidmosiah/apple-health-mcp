# Apple Health MCP Quickstart

1. Export Apple Health data from the iPhone Health app.
2. Transfer `export.zip` to this machine.
3. Run:

```bash
npx -y apple-health-mcp-unofficial setup --export-path /path/to/export.zip
npx -y apple-health-mcp-unofficial doctor
```

For the lowest-friction local import after transferring the export to this Mac:

```bash
npx -y apple-health-mcp-unofficial setup --auto-import
```

This scans `Downloads`, `Desktop` and `Documents`, copies the newest Apple Health export into `~/.apple-health-mcp/exports/`, and stores that managed path.

Then add the MCP client config from the README.
