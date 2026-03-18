window.VMPrintFixtureStore = window.VMPrintFixtureStore || Object.create(null);
window.VMPrintFixtureStore["21-zone-map-explicit-regions"] = {
  "documentVersion": "1.1",
  "layout": {
    "pageSize": { "width": 540, "height": 720 },
    "margins": { "top": 48, "right": 48, "bottom": 48, "left": 48 },
    "fontFamily": "Arimo",
    "fontSize": 10,
    "lineHeight": 1.35
  },
  "fonts": {
    "regular": "Arimo",
    "bold": "Arimo"
  },
  "styles": {
    "h1": {
      "fontSize": 28,
      "fontWeight": "bold",
      "marginBottom": 10,
      "keepWithNext": true
    },
    "lead": {
      "fontSize": 13,
      "marginBottom": 16,
      "color": "#475569"
    },
    "p": {
      "marginBottom": 9,
      "allowLineSplit": true,
      "orphans": 2,
      "widows": 2
    },
    "note-title": {
      "fontSize": 10,
      "fontWeight": "bold",
      "marginBottom": 6,
      "color": "#0f172a"
    },
    "note-body": {
      "fontSize": 9,
      "lineHeight": 1.25,
      "marginBottom": 7,
      "color": "#334155"
    }
  },
  "elements": [
    {
      "type": "h1",
      "content": "Zone Map With Explicit Regions"
    },
    {
      "type": "lead",
      "content": "This example keeps `zone-map` as the public authoring tool while showing that zones can be placed as explicit rectangles rather than only as one aligned strip."
    },
    {
      "type": "zone-map",
      "zoneLayout": {
        "gap": 16,
        "frameOverflow": "move-whole",
        "worldBehavior": "expandable"
      },
      "zones": [
        {
          "id": "main",
          "region": { "x": 0, "y": 0, "width": 272 },
          "elements": [
            {
              "type": "story",
              "columns": 2,
              "gutter": 12,
              "children": [
                {
                  "type": "p",
                  "content": "The main field is a normal linked story, but it now inhabits a named world-region instead of relying only on solved strip columns. This means the region can stay conceptually stable even as pages reveal different slices of it."
                },
                {
                  "type": "p",
                  "content": "Authors still work with `zone-map`, not a raw engine-level world map. The runtime handles the world-space interpretation internally, while the authored model stays compact and readable."
                },
                {
                  "type": "p",
                  "content": "Because this region is open-ended, the main flow can keep expanding through later pages without forcing the sidebar to share the same vertical start or height."
                },
                {
                  "type": "p",
                  "content": "This is the intended public step for now: explicit rectangular regions, not every latent spatial power the engine could expose."
                }
              ]
            }
          ]
        },
        {
          "id": "notes",
          "region": { "x": 296, "y": 72, "width": 148, "height": 212 },
          "elements": [
            { "type": "note-title", "content": "FIELD NOTES" },
            {
              "type": "note-body",
              "content": "This zone is lifted downward with an explicit `y` offset, so it begins below the top of the main field."
            },
            {
              "type": "note-body",
              "content": "It is also height-bounded, making it feel more like a real room than a page column."
            },
            {
              "type": "note-body",
              "content": "The two zones do not need to be adjacent or share one strip-wide top edge."
            }
          ]
        }
      ]
    }
  ]
};
