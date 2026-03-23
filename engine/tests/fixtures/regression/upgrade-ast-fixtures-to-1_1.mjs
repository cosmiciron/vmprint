#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function maybeDeleteEmptyProperties(element) {
    if (!isObject(element.properties)) return;
    if (Object.keys(element.properties).length === 0) {
        delete element.properties;
    }
}

function upgradeElement(element) {
    if (!isObject(element)) return element;

    const next = clone(element);
    const properties = isObject(next.properties) ? { ...next.properties } : undefined;

    if (properties?.image !== undefined && next.image === undefined) {
        next.image = properties.image;
        delete properties.image;
    }
    if (properties?.table !== undefined && next.table === undefined) {
        next.table = properties.table;
        delete properties.table;
    }
    if (properties?.zones !== undefined && next.zoneLayout === undefined) {
        next.zoneLayout = properties.zones;
        delete properties.zones;
    }
    if (properties?.strip !== undefined && next.stripLayout === undefined) {
        next.stripLayout = properties.strip;
        delete properties.strip;
    }
    if (properties?.dropCap !== undefined && next.dropCap === undefined) {
        next.dropCap = properties.dropCap;
        delete properties.dropCap;
    }
    if (properties?.columnSpan !== undefined && next.columnSpan === undefined) {
        next.columnSpan = properties.columnSpan;
        delete properties.columnSpan;
    }
    if (properties?.layout !== undefined && next.placement === undefined) {
        next.placement = properties.layout;
        delete properties.layout;
    }

    if (isObject(properties?.pageOverrides)) {
        properties.pageOverrides = {
            ...properties.pageOverrides,
            header: upgradeRegion(properties.pageOverrides.header),
            footer: upgradeRegion(properties.pageOverrides.footer)
        };
    }

    if (properties) {
        next.properties = properties;
        maybeDeleteEmptyProperties(next);
    }

    if (Array.isArray(next.children)) {
        next.children = next.children.map(upgradeElement);
    }
    if (Array.isArray(next.zones)) {
        next.zones = next.zones.map((zone) => ({
            ...zone,
            elements: Array.isArray(zone?.elements) ? zone.elements.map(upgradeElement) : []
        }));
    }
    if (Array.isArray(next.slots)) {
        next.slots = next.slots.map((slot) => ({
            ...slot,
            elements: Array.isArray(slot?.elements) ? slot.elements.map(upgradeElement) : []
        }));
    }

    return next;
}

function upgradeRegion(region) {
    if (!isObject(region) || !Array.isArray(region.elements)) return region;
    return {
        ...region,
        elements: region.elements.map(upgradeElement)
    };
}

function upgradeDocument(document) {
    return {
        ...document,
        documentVersion: '1.1',
        elements: Array.isArray(document.elements) ? document.elements.map(upgradeElement) : [],
        header: isObject(document.header)
            ? {
                ...document.header,
                default: upgradeRegion(document.header.default),
                firstPage: upgradeRegion(document.header.firstPage),
                odd: upgradeRegion(document.header.odd),
                even: upgradeRegion(document.header.even)
            }
            : document.header,
        footer: isObject(document.footer)
            ? {
                ...document.footer,
                default: upgradeRegion(document.footer.default),
                firstPage: upgradeRegion(document.footer.firstPage),
                odd: upgradeRegion(document.footer.odd),
                even: upgradeRegion(document.footer.even)
            }
            : document.footer
    };
}

const fixtures = fs.readdirSync(__dirname)
    .filter((file) => file.endsWith('.json'))
    .filter((file) => !file.endsWith('.snapshot.layout.json'))
    .sort((a, b) => a.localeCompare(b));

for (const fixture of fixtures) {
    const fixturePath = path.join(__dirname, fixture);
    const original = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const upgraded = upgradeDocument(original);
    fs.writeFileSync(fixturePath, `${JSON.stringify(upgraded, null, 2)}\n`, 'utf8');
    console.log(`[upgrade-ast-fixtures-to-1_1] upgraded ${fixture}`);
}
