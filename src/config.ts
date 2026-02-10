export interface Config {
  apiKey: string;
  apiUrl: string;
}

export function loadConfig(): Config {
  const apiKey = process.env.ALTERLAB_API_KEY;
  if (!apiKey) {
    console.error(
      "Error: ALTERLAB_API_KEY environment variable is required.\n\n" +
        "Get your API key at https://alterlab.io/dashboard/api-keys\n\n" +
        "Then add it to your MCP config:\n" +
        '  "env": { "ALTERLAB_API_KEY": "sk_live_..." }'
    );
    process.exit(1);
  }

  const apiUrl =
    process.env.ALTERLAB_API_URL?.replace(/\/+$/, "") ||
    "https://api.alterlab.io";

  return { apiKey, apiUrl };
}
