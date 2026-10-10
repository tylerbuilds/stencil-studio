/** Preserve supplied licence facts. Missing facts stay blank, never inferred. */
export function creditFromUpload(upload) {
  if (!upload.licence) return null;
  return { name: upload.name, creator: upload.licence.creator ?? '', sourceUrl: upload.licence.sourceUrl ?? '', licenceUrl: upload.licence.licenceUrl ?? '', licence: upload.licence.name ?? '', ...(upload.licence.attribution ? { attribution: upload.licence.attribution } : {}) };
}
export function uploadLicenceFromCredit(credit) {
  if (!credit) return null;
  return Object.fromEntries(Object.entries({ name: credit.licence, creator: credit.creator, sourceUrl: credit.sourceUrl, licenceUrl: credit.licenceUrl, attribution: credit.attribution }).filter(([, value]) => Boolean(value)));
}

export function mediaCreditText(elements) {
  const credits = new Map();
  for (const element of elements) if (element.credit) credits.set(JSON.stringify(element.credit), element.credit);
  return [...credits.values()].map(credit => [credit.name, credit.creator, credit.sourceUrl, credit.licence, credit.licenceUrl, credit.attribution].filter(Boolean).join('\n')).join('\n\n');
}
