import { Context } from '@vmprint/contracts';
import { Box } from '../types';

type DebugStyle = {
    color: string;
    labelColor: string;
    lineWidth: number;
    fillOpacity: number;
    strokeOpacity: number;
    dash: [number, number];
};

const getDebugStyle = (type: string): DebugStyle => {
    const seed = Array.from(type || 'box').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const hue = seed % 360;
    const stroke = `hsl(${hue}, 55%, 45%)`;
    const label = `hsl(${hue}, 45%, 25%)`;
    const dashA = 3 + (seed % 4);
    const dashB = 2 + ((seed >> 3) % 3);

    return {
        color: stroke,
        labelColor: label,
        lineWidth: 0.7,
        fillOpacity: 0.04,
        strokeOpacity: 0.55,
        dash: [dashA, dashB],
    };
};

export const drawDebugBoxOverlay = (context: Context, box: Box, labelFontId: string): void => {
    const debugStyle = getDebugStyle(box.type);

    context.save();
    context
        .opacity(debugStyle.strokeOpacity)
        .lineWidth(debugStyle.lineWidth)
        .strokeColor(debugStyle.color)
        .dash(debugStyle.dash[0], { space: debugStyle.dash[1] })
        .rect(box.x, box.y, box.w, box.h)
        .stroke()
        .undash();

    const label = `${box.type} (${box.x.toFixed(1)},${box.y.toFixed(1)} ${box.w.toFixed(1)}x${box.h.toFixed(1)})`;
    const labelFontSize = 5.5;
    const labelLineHeight = 6.5;
    const labelHeight = labelLineHeight;
    const labelY = Math.max(2, box.y - labelHeight - 2);
    const labelX = Math.max(2, box.x + box.w + 2);
    context.font(labelFontId).fontSize(labelFontSize);
    context.opacity(0.85).fillColor(debugStyle.labelColor);
    context.text(label, labelX, labelY + 1);
    context.restore();
};

export const drawDebugBaseline = (context: Context, x1: number, x2: number, y: number): void => {
    context.save();
    context
        .opacity(0.3)
        .strokeColor('#38bdf8')
        .lineWidth(0.35)
        .dash(2, { space: 2 })
        .moveTo(x1, y)
        .lineTo(x2, y)
        .stroke()
        .undash();
    context.restore();
};

export const drawDebugPageMargins = (
    context: Context,
    pageWidth: number,
    pageHeight: number,
    margins: { top: number; right: number; bottom: number; left: number },
    labelFontId: string,
): void => {
    const stroke = '#94a3b8';
    const label = '#334155';
    const dashA = 2;
    const dashB = 3;

    context.save();
    context.opacity(0.35).strokeColor(stroke).lineWidth(0.6).dash(dashA, { space: dashB });

    const left = margins.left;
    const right = Math.max(0, pageWidth - margins.right);
    const top = margins.top;
    const bottom = Math.max(0, pageHeight - margins.bottom);

    context
        .rect(left, top, Math.max(0, right - left), Math.max(0, bottom - top))
        .stroke()
        .undash();

    context.font(labelFontId).fontSize(6.5);
    context.opacity(0.7).fillColor(label);
    context.text(`margin top: ${top.toFixed(1)}`, left + 2, Math.max(2, top - 10));
    context.text(`margin left: ${left.toFixed(1)}`, 2, top + 2);
    const rightLabelX = Math.min(Math.max(2, right + 2), Math.max(2, pageWidth - 70));
    context.text(`margin right: ${margins.right.toFixed(1)}`, rightLabelX, top + 2);
    context.text(`margin bottom: ${margins.bottom.toFixed(1)}`, left + 2, Math.max(2, bottom + 2));

    context.restore();
};
