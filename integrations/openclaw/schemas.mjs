/** Discoverable authoring inputs; native Stencil validators check document semantics. */
import { readFileSync } from 'node:fs';

const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const design = { type: 'string', pattern: '^[a-f0-9-]{36}\\.stencil\\.json$' };
const incoming = {
  type: 'string', minLength: 1, maxLength: 180,
  pattern: '^(?!.*\\.\\.)[A-Za-z0-9][A-Za-z0-9._-]{0,179}$',
  description: 'An owned file basename in the configured incoming folder; folders and traversal are refused.',
};

// Keep the portable authoring schema as the source of truth. Its local refs
// must resolve from the tool parameter root, rather than the nested request.
const portable = JSON.parse(readFileSync(new URL('./design-request.schema.json', import.meta.url), 'utf8'));
const { $schema: _portableDialect, $id: _portableId, $defs: definitions, ...request } = portable;
definitions.asset.properties.file = { ...incoming };
definitions.asset.properties.prediction = { ...incoming, description: 'An owned JSON prediction file basename in the configured incoming folder. Remote outputs require allowRemote: true.' };
// Express the portable schema's 2020-12 dependency keyword using draft-compatible
// conditions; tool validators choose their own dialect.
for (const [key, required] of Object.entries(definitions.page.dependentRequired ?? {})) {
  definitions.page.allOf ??= [];
  definitions.page.allOf.push({ if: { required: [key] }, then: { required } });
}
delete definitions.page.dependentRequired;
const remoteAsset = { anyOf: [{ required: ['url'] }, { required: ['prediction'] }] };
const remotePermission = { required: ['allowRemote'], properties: { allowRemote: { const: true } } };
const createParameters = {
  ...object({ request, allowRemote: { type: 'boolean' } }, ['request']),
  $defs: definitions,
  allOf: [{
    if: { required: ['request'], properties: { request: { required: ['assets'], properties: { assets: { contains: remoteAsset } } } } },
    then: remotePermission,
  }],
};

const sourceFields = ['file', 'dataUrl', 'url', 'prediction'];
const source = {
  ...object({
    file: { ...incoming },
    dataUrl: {
      type: 'string', maxLength: 8388658,
      pattern: '^data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$',
      description: 'Canonical base64 raster data up to 6 MiB; native validation checks its bytes and declared type.',
    },
    url: { type: 'string', format: 'uri', pattern: '^https://', maxLength: 4000, description: 'An existing public HTTPS image output; requires allowRemote: true.' },
    prediction: {
      type: 'object',
      properties: {
        status: { const: 'succeeded' },
        output: { description: 'Existing image output URL, output record with a url, or array of outputs; the native importer checks the selected HTTPS output.' },
      },
      description: 'An existing prediction response object with image output data. A supplied status must be succeeded; remote import requires allowRemote: true.',
    },
    outputIndex: { type: 'integer', minimum: 0, maximum: 99, description: 'The prediction output to import, starting at 0; prediction sources only.' },
  }),
  oneOf: sourceFields.map(key => ({ required: [key], not: { anyOf: sourceFields.filter(other => other !== key).map(other => ({ required: [other] })) } })),
  allOf: [{ if: { required: ['outputIndex'] }, then: { required: ['prediction'] } }],
};
const importParameters = {
  ...object({
    design, source, allowRemote: { type: 'boolean' },
    page: { type: 'integer', minimum: 1, maximum: 30 },
    x: { type: 'number', minimum: -8192, maximum: 8192 },
    y: { type: 'number', minimum: -8192, maximum: 8192 },
    width: { type: 'number', minimum: 1, maximum: 8192 },
    height: { type: 'number', minimum: 1, maximum: 8192 },
    credit: { $ref: '#/$defs/credit' },
  }, ['design', 'source']),
  $defs: { credit: definitions.credit },
  allOf: [{
    if: { required: ['source'], properties: { source: remoteAsset } },
    then: remotePermission,
  }],
};

export const TOOL_SPECS = [
  { name: 'stencil_presets', label: 'Stencil sizes and templates', description: 'List Stencil social sizes and editable templates. No files are changed.', parameters: object({}) },
  { name: 'stencil_create_design', label: 'Create a Stencil design', description: 'Build an editable Stencil design from a stencil-design-request version 1 object. Use stencil_presets for current preset and template keys. Local asset filenames come from the configured incoming folder. Existing public HTTPS image outputs require allowRemote: true; no image generator is called.', parameters: createParameters },
  { name: 'stencil_validate_design', label: 'Check a Stencil design', description: 'Validate a design filename returned by a Stencil tool and report its pages and editable layers.', parameters: object({ design }, ['design']) },
  { name: 'stencil_import_image', label: 'Add an image to a Stencil design', description: 'Add exactly one local incoming image, embedded image data, existing public HTTPS image output, or succeeded Replicate response object. Remote downloads require allowRemote: true. Creates a new editable design and keeps the original.', parameters: importParameters },
  { name: 'stencil_export_svg', label: 'Export Stencil SVG artwork', description: 'Export a Stencil design as SVG pages with embedded images, bundled fonts and credit metadata in a new artwork folder. Open the editable design in Stencil Studio for PNG or JPEG export.', parameters: object({ design }, ['design']) },
];
