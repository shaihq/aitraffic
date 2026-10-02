import { DISTRICT_PLACES, PROVIDER_PLACE } from '../bangalore';

// Normalization layer between the navigation labels and OpenRouter author ids.
// Author ids are matched tolerantly (see `matchesProvider`) and validated against the live catalog.

export interface ProviderDef {
  key: string;
  label: string;
  /** OpenRouter author prefixes (the part before "/" in a model id). */
  authors: string[];
  /** Bangalore neighbourhood hosting this provider's traffic. A label, not a claim about the place. */
  corridor: string;
  /**
   * Only used when no usage data exists to pick between several "Latest" aliases.
   * Lower index = preferred family. Usage data always wins when available.
   */
  familyHints?: string[];
}

const RAW_PROVIDERS: Omit<ProviderDef, 'corridor'>[] = [
  { key: 'deepseek', label: 'DeepSeek', authors: ['deepseek'], familyHints: ['pro'] },
  { key: 'openai', label: 'OpenAI', authors: ['openai'] },
  { key: 'zai', label: 'Z.ai', authors: ['z-ai', 'zai', 'zhipu'], familyHints: ['glm-latest'] },
  { key: 'xiaomi', label: 'Xiaomi', authors: ['xiaomi'] },
  { key: 'tencent', label: 'Tencent', authors: ['tencent'] },
  { key: 'nvidia', label: 'NVIDIA', authors: ['nvidia'] },
  { key: 'google', label: 'Gemini', authors: ['google'], familyHints: ['pro', 'flash'] },
  { key: 'anthropic', label: 'Claude', authors: ['anthropic'], familyHints: ['sonnet', 'opus'] },
  { key: 'qwen', label: 'Qwen', authors: ['qwen'] },
  { key: 'meta', label: 'Meta', authors: ['meta-llama', 'meta'] },
  { key: 'moonshotai', label: 'Kimi', authors: ['moonshotai', 'moonshot'] },
  { key: 'minimax', label: 'MiniMax', authors: ['minimax'] },
  { key: 'x-ai', label: 'Grok', authors: ['x-ai', 'xai'] },
  { key: 'mistral', label: 'Mistral', authors: ['mistralai', 'mistral'] },
];

export const PROVIDERS: ProviderDef[] = RAW_PROVIDERS.map((p) => ({
  ...p,
  corridor: DISTRICT_PLACES.find((pl) => pl.id === PROVIDER_PLACE[p.key])?.name ?? p.label,
}));

/** Author segment of an OpenRouter id, without the "~" alias marker. */
export function authorOf(id: string): string {
  return id.replace(/^~/, '').split('/')[0].toLowerCase();
}

export function matchesProvider(id: string, provider: ProviderDef): boolean {
  const author = authorOf(id);
  return provider.authors.some((a) => author === a);
}

/** "Anthropic: Claude Sonnet 5.5" → "Claude Sonnet 5.5" */
export function stripProviderPrefix(name: string): string {
  const i = name.indexOf(': ');
  return i >= 0 ? name.slice(i + 2) : name;
}
