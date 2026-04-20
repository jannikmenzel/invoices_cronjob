const {parseInvoiceDate, isDateWithinUtcRange} = require('./date-utils');

/**
 * @typedef {{ name?: string, value?: string }} DvelopDisplayProperty
 * @typedef {{ href?: string }} DvelopLink
 * @typedef {{ file?: DvelopLink, content?: DvelopLink, download?: DvelopLink, self?: DvelopLink }} DvelopLinks
 * @typedef {{
 *   displayProperties?: DvelopDisplayProperty[],
 *   _links?: DvelopLinks,
 *   documentUri?: string,
 *   uri?: string,
 *   caption?: string
 * }} DvelopDocument
 */

function toAbsoluteUrl(href, baseUrl) {
    const raw = String(href || '').trim();
    if (!raw) return null;

    if (typeof URL.canParse !== 'function') return null;

    if (URL.canParse(raw)) {
        return new URL(raw).toString();
    }

    if (!baseUrl || !URL.canParse(raw, baseUrl)) return null;

    return new URL(raw, baseUrl).toString();
}


function parseRepoAndObjectId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const normalized = raw.startsWith('dmsObject:///') ? raw.replace('dmsObject:///', '/') : raw;
    const match = /\/dms\/r\/([^/]+)\/o2\/([^/?#]+)/i.exec(normalized);
    if (!match) return null;

    return {
        repoId: match[1],
        objectId: match[2]
    };
}

function parseObjectId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const normalized = raw.startsWith('dmsObject:///') ? raw.replace('dmsObject:///', '/') : raw;
    const fromPath = /\/o2\/([^/?#]+)/i.exec(normalized);
    if (fromPath) return fromPath[1];

    if (!normalized.includes('/')) {
        return normalized;
    }

    return null;
}

function addCandidate(candidates, value, baseUrl) {
    const absoluteUrl = toAbsoluteUrl(value, baseUrl);
    if (!absoluteUrl || candidates.includes(absoluteUrl)) return;
    candidates.push(absoluteUrl);
}

function addContentVariants(candidates, value, baseUrl) {
    const absoluteUrl = toAbsoluteUrl(value, baseUrl);
    if (!absoluteUrl) return;

    addCandidate(candidates, absoluteUrl, baseUrl);

    if (absoluteUrl.endsWith('/content')) {
        addCandidate(candidates, absoluteUrl.replace(/\/content$/, ''), baseUrl);
        return;
    }

    addCandidate(candidates, `${absoluteUrl.replace(/\/$/, '')}/content`, baseUrl);
}

function buildBinaryContentPath(repoId, objectId) {
    return `/dms/r/${repoId}/o2/${objectId}/v/current/b/main/c`;
}

function authHeaders(apiKey) {
    return {
        'Content-Type': 'application/json',
        authorization: `Bearer ${apiKey}`
    };
}

/**
 * @param {DvelopDocument} doc
 * @returns {Date|null}
 */
function extractInvoiceDate(doc) {
    const raw = doc?.displayProperties
        ?.find((prop) => prop?.name === 'Rechnungsdatum')
        ?.value;
    return parseInvoiceDate(raw);
}

/**
 * @param {DvelopDocument} doc
 * @returns {string|null}
 */
function extractDownloadUrl(doc) {
    return (
        doc?._links?.file?.href ||
        doc?._links?.content?.href ||
        doc?._links?.download?.href ||
        null
    );
}

/**
 * @param {DvelopDocument} doc
 * @param {string} apiKey
 * @param {string} baseUrl
 * @param {string|null|undefined} fallbackRepoId
 * @returns {Promise<string[]>}
 */
async function resolveDownloadCandidates(doc, apiKey, baseUrl, fallbackRepoId) {
    const candidates = [];
    const selfUrl = toAbsoluteUrl(doc?._links?.self?.href, baseUrl);
    const direct = extractDownloadUrl(doc);

    const uriSources = [doc?.documentUri, doc?.uri, doc?._links?.self?.href, direct];
    let hasBinaryCandidate = false;
    for (const source of uriSources) {
        const ids = parseRepoAndObjectId(source);
        if (!ids) continue;
        addCandidate(candidates, buildBinaryContentPath(ids.repoId, ids.objectId), selfUrl || baseUrl);
        hasBinaryCandidate = true;
        break;
    }

    if (!hasBinaryCandidate && fallbackRepoId) {
        for (const source of uriSources) {
            const objectId = parseObjectId(source);
            if (!objectId) continue;
            addCandidate(candidates, buildBinaryContentPath(fallbackRepoId, objectId), selfUrl || baseUrl);
            break;
        }
    }

    addContentVariants(candidates, direct, selfUrl || baseUrl);

    if (!selfUrl) return candidates;

    addContentVariants(candidates, selfUrl, selfUrl);

    const detailsResponse = await fetch(selfUrl, {
        method: 'GET',
        headers: {
            authorization: `Bearer ${apiKey}`
        }
    });

    if (!detailsResponse.ok) {
        return candidates;
    }

    const details = await detailsResponse.json();

    const detailDirect = extractDownloadUrl(details);
    addContentVariants(candidates, detailDirect, selfUrl);

    const detailIds = parseRepoAndObjectId(details?.documentUri || details?.uri || details?._links?.self?.href || detailDirect);
    if (detailIds) {
        addCandidate(candidates, buildBinaryContentPath(detailIds.repoId, detailIds.objectId), selfUrl);
    } else if (fallbackRepoId) {
        const detailObjectId = parseObjectId(details?.documentUri || details?.uri || details?._links?.self?.href || detailDirect);
        if (detailObjectId) {
            addCandidate(candidates, buildBinaryContentPath(fallbackRepoId, detailObjectId), selfUrl);
        }
    }

    return candidates;
}

async function searchInvoicesByObjectNumber({scriptUrl, apiKey, objectNumber}) {
    const searchParams = {
        mode: 'searchdoks',
        searchcats: ['Eingangsrechnung'],
        searchprops: {
            Objektnummer: objectNumber
        }
    };

    const response = await fetch(scriptUrl, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify(searchParams)
    });

    if (!response.ok) {
        throw new Error(`d.velop Suche fehlgeschlagen (${objectNumber}): HTTP ${response.status}`);
    }

    const result = await response.json();
    return Array.isArray(result) ? result : [];
}

/**
 * @param {DvelopDocument[]} documents
 * @param {{ start: Date, end: Date }} range
 * @returns {DvelopDocument[]}
 */
function filterInvoicesForRange(documents, range) {
    return documents.filter((doc) => {
        const invoiceDate = extractInvoiceDate(doc);
        if (!invoiceDate) return false;
        return isDateWithinUtcRange(invoiceDate, range);
    });
}

/**
 * @param {DvelopDocument} doc
 * @param {string} apiKey
 * @param {string} baseUrl
 * @param {string|null} [fallbackRepoId]
 * @returns {Promise<Buffer>}
 */
async function downloadPdf(doc, apiKey, baseUrl, fallbackRepoId = null) {
    const urls = await resolveDownloadCandidates(doc, apiKey, baseUrl, fallbackRepoId);
    if (urls.length === 0) {
        throw new Error('Keine gültige Download-URL im Dokument gefunden.');
    }

    let lastStatus = null;
    for (const url of urls) {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                authorization: `Bearer ${apiKey}`
            }
        });

        if (!response.ok) {
            lastStatus = response.status;
            if (response.status === 404) {
                continue;
            }
            throw new Error(`Download fehlgeschlagen: HTTP ${response.status} (${url})`);
        }

        const contentType = response.headers.get('content-type');
        const normalizedContentType = contentType ? contentType.toLowerCase() : '';
        if (normalizedContentType && !normalizedContentType.includes('pdf') && !normalizedContentType.includes('octet-stream')) {
            throw new Error(`Unerwarteter Content-Type beim Download: ${contentType}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    throw new Error(`Download fehlgeschlagen: HTTP ${lastStatus || 'unbekannt'} (keiner der Kandidaten erreichbar: ${urls.join(', ')})`);
}

module.exports = {
    searchInvoicesByObjectNumber,
    filterInvoicesForRange,
    downloadPdf
};

