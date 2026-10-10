/** Discover original native layouts by their practical use and editable content. */
export const TEMPLATE_CATEGORIES = Object.freeze([
  { key: 'all', name: 'All templates' }, { key: 'posts', name: 'Posts & carousels' },
  { key: 'stories', name: 'Stories' }, { key: 'covers', name: 'Thumbnails & covers' }, { key: 'other', name: 'Print & slides' }
].map(Object.freeze));
export function templateCategory(template) {
  if (['story', 'social-event-story'].includes(template.key)) return 'stories';
  if (['banner', 'social-thumbnail', 'social-cover'].includes(template.key)) return 'covers';
  if (template.group === 'social' || ['social', 'launch', 'collage', 'quote'].includes(template.key)) return 'posts';
  return 'other';
}
const searchable = value => value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
export function filterTemplates(templates, { query = '', category = 'all' } = {}) {
  if (typeof query !== 'string' || query.length > 120 || !TEMPLATE_CATEGORIES.some(item => item.key === category)) throw new Error('Choose a template type or a shorter search.');
  const words = searchable(query).trim().split(/\s+/).filter(Boolean);
  return templates.filter(template => {
    if (category !== 'all' && templateCategory(template) !== category) return false;
    const content = searchable([template.name, template.category, template.key, ...(template.tags ?? [])].join(' '));
    return words.every(word => content.includes(word));
  });
}
