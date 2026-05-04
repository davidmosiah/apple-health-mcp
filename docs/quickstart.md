# Apple Health MCP Quickstart

1. Export Apple Health data from the iPhone Health app.
2. Transfer `export.zip` to this machine.
3. Run:

```bash
npx -y apple-health-mcp-unofficial setup --export-path /path/to/export.zip
npx -y apple-health-mcp-unofficial doctor
```

Then add the MCP client config from the README.
