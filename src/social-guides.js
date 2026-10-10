import { PRESETS, editPage, id } from './model.js';

const MAX_PAGE_GUIDES = 40;

/** Published text areas are offered only at their original canvas dimensions. */
export function availableSocialTextGuides(page) {
  return PRESETS.filter(preset => preset.safeGuide && page?.width === preset.width && page?.height === preset.height);
}

/** Add ordinary editable guides; leave all existing guides and artwork intact. */
export function addSocialTextGuides(document, pageId, presetKey) {
  const preset = PRESETS.find(item => item.key === presetKey);
  if (!preset) throw new Error('This canvas size is not available. Choose another size.');
  if (!preset.safeGuide) throw new Error('This canvas size has no published text-area guide.');

  return editPage(document, pageId, page => {
    if (page.width !== preset.width || page.height !== preset.height) {
      throw new Error(`This text-area guide needs a ${preset.width} × ${preset.height} canvas.`);
    }
    const { x, y, width, height } = preset.safeGuide;
    const boundaries = [
      { axis: 'x', position: x }, { axis: 'x', position: x + width },
      { axis: 'y', position: y }, { axis: 'y', position: y + height }
    ];
    const missing = boundaries.filter(boundary => !page.guides.some(guide => guide.axis === boundary.axis && guide.position === boundary.position));
    if (page.guides.length + missing.length > MAX_PAGE_GUIDES) {
      throw new Error('This page can hold up to 40 guides. Remove some guides before adding this text area.');
    }
    page.guides.push(...missing.map(boundary => ({ id: id(), ...boundary })));
    Object.assign(page.guideSettings, { visible: true, rulers: true, snapToGuides: true });
  });
}
