import { pageSVG } from './model.js';

// These are limits for the optional search layer, not limits on artwork rendering.
export const PDF_TEXT_LIMITS = Object.freeze({ runsPerPage: 5000, charactersPerRun: 10000, charactersPerPage: 100000, charactersPerDocument: 500000, glyphsPerDocument: 30000 });
const fail = message => { throw new Error(message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const badText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Validate plain positioned text; coordinates and advances are canvas pixels. */
export function validatePDFTextRuns(runs) {
  if (runs === undefined) return [];
  if (!Array.isArray(runs) || runs.length > PDF_TEXT_LIMITS.runsPerPage) fail('This page has too much PDF text. Split the design into smaller pages.');
  for (let index = 0; index < runs.length; index++) if (!Object.hasOwn(runs, index)) fail('PDF text needs valid positioned text runs.');
  let characters = 0;
  return runs.map((run, index) => {
    if (!Object.hasOwn(runs, index) || !plain(run) || Object.keys(run).some(key => !['text', 'fontSize', 'matrix', 'width', 'advances'].includes(key))) fail('PDF text needs valid positioned text runs.');
    if (typeof run.text !== 'string' || !run.text.length || run.text.length > PDF_TEXT_LIMITS.charactersPerRun || badText.test(run.text) || /[\r\n\t]/.test(run.text)) fail('Each PDF text run must contain one valid line of text.');
    const points = [...run.text]; characters += points.length;
    if (characters > PDF_TEXT_LIMITS.charactersPerPage) fail('This page has too much PDF text. Split the design into smaller pages.');
    if (!finite(run.fontSize, 1, 1000) || !finite(run.width, .001, 32768) || !Array.isArray(run.matrix) || run.matrix.length !== 6 || Array.from({ length: 6 }, (_, i) => !Object.hasOwn(run.matrix, i) || !finite(run.matrix[i], i < 4 ? -16 : -65536, i < 4 ? 16 : 65536)).some(Boolean) || Math.abs(run.matrix[0] * run.matrix[3] - run.matrix[1] * run.matrix[2]) < .000001) fail('PDF text needs finite dimensions and a valid transform.');
    let advances;
    if (run.advances !== undefined) {
      if (!Array.isArray(run.advances) || run.advances.length !== points.length || Array.from({ length: points.length }, (_, i) => !Object.hasOwn(run.advances, i) || !finite(run.advances[i], 0, 32768)).some(Boolean)) fail('PDF text character positions are invalid.');
      advances = [...run.advances];
      if (Math.abs(advances.reduce((sum, value) => sum + value, 0) - run.width) > Math.max(.1, run.width * .001)) fail('PDF text character positions do not match the line width.');
    } else advances = points.map(() => run.width / points.length);
    return { text: run.text, fontSize: run.fontSize, width: run.width, matrix: [...run.matrix], advances };
  });
}

const point = (matrix, x, y) => ({ x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f });
function intersectsRect(box, matrix, rect) {
  const corners = [point(matrix, box.x, box.y), point(matrix, box.x + box.width, box.y), point(matrix, box.x, box.y + box.height), point(matrix, box.x + box.width, box.y + box.height)];
  return Math.max(...corners.map(p => p.x)) > rect.x && Math.min(...corners.map(p => p.x)) < rect.x + rect.width && Math.max(...corners.map(p => p.y)) > rect.y && Math.min(...corners.map(p => p.y)) < rect.y + rect.height;
}
function painted(node, svg, ownerDocument) {
  for (let current = node; current && current !== svg; current = current.parentElement) {
    if (current.getAttribute('aria-hidden') === 'true') return false;
    const style = ownerDocument.defaultView.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  }
  return true;
}

/**
 * Measure the validated page's actual SVG after its fonts have loaded. The artwork
 * remains a JPEG; this adds a Unicode search/selection layer for native text.
 * It excludes hidden/zero-opacity/outside-page text and honours rectangular SVG
 * clips. Partially clipped glyphs/paint occlusion are not pixel-level analysis.
 * Call synchronously in a browser, after awaiting document.fonts.ready.
 */
export function collectPDFTextRuns(page, { document: ownerDocument = globalThis.document } = {}) {
  const markup = pageSVG(page); // The model's export validation runs before DOM insertion.
  if (!markup.includes('<text')) return [];
  if (!ownerDocument?.body || !ownerDocument.defaultView?.getComputedStyle) fail('Searchable PDF text needs a browser. Open this design in Stencil Studio to export it.');
  const host = ownerDocument.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${page.width}px;height:${page.height}px;opacity:0;pointer-events:none;contain:layout style paint`;
  host.innerHTML = markup;
  ownerDocument.body.append(host);
  try {
    const svg = host.querySelector('svg'), rootMatrix = svg.getScreenCTM();
    if (!rootMatrix) fail('The browser could not measure PDF text. Try exporting again.');
    const rootInverse = rootMatrix.inverse(), runs = [];
    const measurement = ownerDocument.createElement('canvas').getContext('2d');
    if (!measurement) fail('The browser could not measure PDF text. Try exporting again.');
    let characters = 0;
    for (const text of svg.querySelectorAll('text')) {
      if (text.closest('defs') || !painted(text, svg, ownerDocument)) continue;
      const leaves = text.querySelectorAll('tspan').length ? [...text.querySelectorAll('tspan')].filter(span => !span.querySelector('tspan')) : [text];
      for (const node of leaves) {
        if (!painted(node, svg, ownerDocument)) continue;
        // The renderer uses normal SVG white-space handling. Match its visible
        // collapsed spaces before using SVG's UTF-16 character position APIs.
        const content = node.textContent.replace(/[ \t\r\n]+/g, ' ').trim();
        if (!content || !content.trim()) continue;
        const style = ownerDocument.defaultView.getComputedStyle(node);
        const fontSize = Number.parseFloat(style.fontSize);
        const screenMatrix = node.getScreenCTM();
        if (!screenMatrix) fail('The browser could not measure PDF text. Try exporting again.');
        const transform = rootInverse.multiply(screenMatrix);
        const pageRect = { x: 0, y: 0, width: page.width, height: page.height };
        if (!intersectsRect(node.getBBox(), transform, pageRect)) continue;
        const clips = [];
        for (let ancestor = node.parentElement; ancestor && ancestor !== svg; ancestor = ancestor.parentElement) {
          const reference = ancestor.getAttribute('clip-path')?.match(/^url\(#([\w-]+)\)$/)?.[1];
          if (!reference) continue;
          const clip = [...svg.querySelectorAll('clipPath')].find(item => item.id === reference);
          const rect = clip?.children.length === 1 && clip.firstElementChild.tagName === 'rect' ? clip.firstElementChild : null;
          if (!rect) continue; // Current text renderer uses rectangular clips only.
          const matrix = rootInverse.multiply(ancestor.getScreenCTM());
          const ownTransform = rect.transform.baseVal.consolidate()?.matrix;
          const inverse = (ownTransform ? matrix.multiply(ownTransform) : matrix).inverse();
          clips.push({ matrix: inverse.multiply(transform), rect: { x: rect.x.baseVal.value, y: rect.y.baseVal.value, width: rect.width.baseVal.value, height: rect.height.baseVal.value } });
        }
        measurement.font = style.font;
        const metrics = measurement.measureText(content);
        // SVG's hanging anchor is not the alphabetic baseline PDF expects.
        // Canvas exposes the same loaded font's baseline; older browsers use
        // the font ascent approximation used by the SVG hanging baseline.
        const baselineOffset = style.dominantBaseline === 'hanging' ? (metrics.hangingBaseline ?? (metrics.fontBoundingBoxAscent ?? fontSize) * .8) : 0;
        const points = [...content];
        let segment = null;
        const finish = () => {
          if (!segment?.text.trim()) { segment = null; return; }
          const width = segment.advances.reduce((sum, value) => sum + value, 0);
          if (width <= 0) { segment = null; return; }
          characters += [...segment.text].length;
          if (characters > PDF_TEXT_LIMITS.charactersPerPage || runs.length >= PDF_TEXT_LIMITS.runsPerPage) fail('This page has too much PDF text. Split the design into smaller pages.');
          runs.push({ ...segment, fontSize, width }); segment = null;
        };
        let offset = 0;
        for (const character of points) {
          // SVG character indices are UTF-16 code units, including surrogate pairs.
          const from = node.getStartPositionOfChar(offset), to = node.getEndPositionOfChar(offset + character.length - 1);
          const box = node.getExtentOfChar(offset);
          const visible = intersectsRect(box, transform, pageRect) && clips.every(clip => intersectsRect(box, clip.matrix, clip.rect));
          if (visible) {
            if (!segment) {
              const origin = point(transform, from.x, from.y + baselineOffset);
              segment = { text: '', matrix: [transform.a, transform.b, transform.c, transform.d, origin.x, origin.y], advances: [] };
            }
            segment.text += character;
            segment.advances.push(Math.max(0, Math.hypot(to.x - from.x, to.y - from.y)));
          } else finish();
          offset += character.length;
        }
        finish();
      }
    }
    return validatePDFTextRuns(runs);
  } finally { host.remove(); }
}
