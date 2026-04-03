/**
 * 40-zone-map-spanning-field-carryover.overlay.mjs
 *
 * Highlight the observed zone frames and the carried field actor so the
 * proof reads as one regional map being revisited across later chunks.
 */

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function textNoBreak(ctx, str, x, y, size = 5.5, color = "#334155", opacity = 0.88) {
  ctx.save();
  ctx.fillColor(color).opacity(opacity).font("Helvetica", size);
  ctx.text(str, x, y, { lineBreak: false });
  ctx.restore();
}

export default {
  overlay(page, ctx) {
    const boxes = Array.isArray(page.boxes) ? page.boxes : [];
    if (!boxes.length) return;

    const leftEdge = boxes.reduce((min, b) => (b.x > 0 && b.x < min ? b.x : min), page.width);
    const rightEdge = page.width - leftEdge;
    const headerY = Math.max(8, leftEdge / 2);

    ctx.save();
    ctx.strokeColor("#cbd5e1").lineWidth(0.35).opacity(0.75);
    ctx.moveTo(leftEdge, headerY + 4).lineTo(rightEdge, headerY + 4).stroke();
    ctx.restore();
    textNoBreak(ctx, `page ${page.index + 1} - zone carryover`, leftEdge, headerY, 6, "#94a3b8", 0.86);

    const rockBoxes = boxes.filter((box) => {
      const sourceId = String(box.meta?.sourceId || "");
      return sourceId === "zone-carryover-rock" || sourceId.endsWith(":zone-carryover-rock");
    });

    for (const rock of rockBoxes) {
      const visibleHeight = Math.max(0, Math.min(rock.h, page.height - rock.y));

      ctx.save();
      ctx.fillColor("#f59e0b").opacity(0.12);
      ctx.rect(rock.x, rock.y, rock.w, rock.h).fill();
      ctx.strokeColor("#b45309").lineWidth(1).dash(3, { space: 2 }).opacity(0.85);
      ctx.rect(rock.x, rock.y, rock.w, rock.h).stroke();
      ctx.undash();
      ctx.restore();

      const label = page.index === 0 ? "carried field begins" : "same carried field";
      textNoBreak(ctx, label, rock.x + 2, Math.max(headerY + 10, rock.y - 8), 5.4, "#92400e", 0.92);
      textNoBreak(
        ctx,
        `x ${Math.round(rock.x)} y ${Math.round(rock.y)} w ${Math.round(rock.w)} h ${Math.round(rock.h)} visH ${Math.round(visibleHeight)}`,
        rock.x + 2,
        rock.y + 4,
        5.1,
        "#92400e",
        0.88
      );
      const note = visibleHeight < rock.h - 0.5
        ? "first chunk only sees a clipped slice of this same field"
        : "later chunk revisits the same field at full local width";
      textNoBreak(ctx, note, rock.x + 2, rock.y + rock.h + 4, 5.2, "#92400e", 0.9);

      if (visibleHeight < rock.h - 0.5) {
        ctx.save();
        ctx.strokeColor("#dc2626").lineWidth(0.8).opacity(0.8);
        ctx.rect(rock.x, rock.y, rock.w, visibleHeight).stroke();
        ctx.restore();
        textNoBreak(
          ctx,
          `visible slice clipped by page to ${Math.round(visibleHeight)}pt`,
          rock.x + 2,
          Math.max(headerY + 10, rock.y - 16),
          5.2,
          "#dc2626",
          0.92
        );
      }
    }

    const bodyBoxes = boxes.filter((box) => {
      const sourceId = String(box.meta?.sourceId || "");
      return sourceId === "zone-carryover-body" || sourceId.endsWith(":zone-carryover-body");
    });
    if (bodyBoxes.length > 0) {
      const minY = Math.min(...bodyBoxes.map((box) => safeNumber(box.y)));
      textNoBreak(ctx, "same zone body continues", leftEdge + 2, Math.max(headerY + 10, minY - 8), 5.4, "#0f766e", 0.9);
    }
  }
};
