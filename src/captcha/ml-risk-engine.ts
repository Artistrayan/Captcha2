import fs from 'node:fs';
import path from 'node:path';

export const ML_FEATURE_NAMES = [
  'automationUserAgent',
  'missingUserAgent',
  'missingLanguage',
  'elapsedMs',
  'attemptsCount',
  'sameIpRecentCount',
  'sameIpRecentFailureCount',
] as const;

export interface MLFeatureInput {
  userAgent?: string;
  acceptLanguage?: string;
  elapsedMs?: number;
  attemptsCount?: number;
  sameIpRecentCount?: number;
  sameIpRecentFailureCount?: number;
}

interface PortableNode {
  feature: number;
  threshold: number;
  left: number;
  right: number;
  botProbability: number;
}
interface PortableTree { nodes: PortableNode[]; }
interface PortableModel {
  schemaVersion: number;
  modelType: 'random-forest';
  modelVersion: string;
  featureNames: string[];
  treeCount: number;
  trees: PortableTree[];
}
export interface MLShadowPrediction {
  available: boolean;
  botProbability?: number;
  humanScore?: number;
  modelVersion?: string;
  error?: string;
}

let cachedModelPath = '';
let cachedMtime = -1;
let cachedModel: PortableModel | null = null;

function loadModel(): PortableModel | null {
  const configured = process.env.SHIELDCAPTCHA_ML_MODEL_PATH;
  if (!configured) return null;
  const resolved = path.resolve(configured);
  try {
    const stat = fs.statSync(resolved);
    if (resolved !== cachedModelPath || stat.mtimeMs !== cachedMtime) {
      const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8')) as PortableModel;
      if (parsed.schemaVersion !== 1 || parsed.modelType !== 'random-forest' ||
          !Array.isArray(parsed.trees) || parsed.trees.length < 1 ||
          parsed.treeCount !== parsed.trees.length ||
          JSON.stringify(parsed.featureNames) !== JSON.stringify(ML_FEATURE_NAMES)) {
        throw new Error('Unsupported or invalid ML model schema');
      }
      for (const tree of parsed.trees) {
        if (!Array.isArray(tree.nodes) || tree.nodes.length < 1) throw new Error('Invalid tree');
        for (const node of tree.nodes) {
          if (!Number.isFinite(node.botProbability) || node.botProbability < 0 || node.botProbability > 1) {
            throw new Error('Invalid tree probability');
          }
          if (node.feature >= ML_FEATURE_NAMES.length) throw new Error('Invalid tree feature index');
        }
      }
      cachedModelPath = resolved;
      cachedMtime = stat.mtimeMs;
      cachedModel = parsed;
    }
    return cachedModel;
  } catch (error) {
    // Model absence is expected before labeled data is ready; malformed configured models are surfaced.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function features(input: MLFeatureInput): number[] {
  const ua = (input.userAgent || '').slice(0, 512).toLowerCase();
  const automationUserAgent = /headlesschrome|headlessfirefox|playwright|puppeteer|selenium|phantomjs|python-requests|python-urllib|aiohttp|httpx\/|(?:^|\s)(?:curl|wget)\/|scrapy|go-http-client|java\/\d/.test(ua);
  return [
    automationUserAgent ? 1 : 0,
    input.userAgent ? 0 : 1,
    input.acceptLanguage ? 0 : 1,
    Math.max(0, Math.min(120_000, Number(input.elapsedMs) || 0)),
    Math.max(0, Math.min(10, Math.floor(Number(input.attemptsCount) || 0))),
    Math.max(0, Math.min(1000, Math.floor(Number(input.sameIpRecentCount) || 0))),
    Math.max(0, Math.min(1000, Math.floor(Number(input.sameIpRecentFailureCount) || 0))),
  ];
}

function predictTree(tree: PortableTree, row: number[]): number {
  let index = 0;
  for (let steps = 0; steps < tree.nodes.length; steps++) {
    const node = tree.nodes[index];
    if (!node) throw new Error('Malformed ML tree traversal');
    if (node.feature < 0) return node.botProbability;
    index = row[node.feature] <= node.threshold ? node.left : node.right;
  }
  throw new Error('ML tree traversal exceeded node limit');
}

/** Returns a prediction only; callers must keep it shadow-only until separately approved. */
export function predictCaptchaMLShadow(input: MLFeatureInput): MLShadowPrediction {
  let model: PortableModel | null;
  try {
    model = loadModel();
  } catch {
    return { available: false, error: 'invalid-model-artifact' };
  }
  if (!model) return { available: false };
  try {
    const row = features(input);
    const probability = model.trees.reduce((sum, tree) => sum + predictTree(tree, row), 0) / model.trees.length;
    const bounded = Math.max(0, Math.min(1, probability));
    return {
      available: true,
      botProbability: Number(bounded.toFixed(5)),
      humanScore: Math.round((1 - bounded) * 100),
      modelVersion: model.modelVersion,
    };
  } catch {
    return { available: false, error: 'prediction-failed' };
  }
}
