import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authorisedAgent, createManager } from './core.mjs';
import { TOOL_SPECS } from './schemas.mjs';

const manifest = JSON.parse(readFileSync(new URL('./openclaw.plugin.json', import.meta.url), 'utf8'));
const runtimeRoot = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const managers = new Map();

export function toolFactory(spec, config, context) {
  if (!authorisedAgent(config, context)) return null;
  const key = JSON.stringify([runtimeRoot, config.releaseSha, config.manifestSha256, config.outputDirectory]);
  let manager = managers.get(key);
  if (!manager) {
    if (managers.size >= 8) return null;
    manager = createManager(runtimeRoot, config); managers.set(key, manager);
  }
  return {
    ...spec,
    async execute(_toolCallId, parameters, signal) {
      const value = await manager.execute(spec.name, parameters, signal);
      return { content: [{ type: 'text', text: JSON.stringify(value) }], details: value, isError: value.ok !== true };
    },
  };
}

export default defineToolPlugin({
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  configSchema: manifest.configSchema,
  tools: tool => TOOL_SPECS.map(spec => tool({ ...spec, optional: true, factory: ({ config, toolContext }) => toolFactory(spec, config, toolContext) })),
});
