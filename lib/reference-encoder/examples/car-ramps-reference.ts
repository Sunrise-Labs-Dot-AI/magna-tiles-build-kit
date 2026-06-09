import type { ReferenceBuildCollection } from "../types";

export const CAR_RAMPS_REFERENCE_COLLECTION: ReferenceBuildCollection = {
  source: {
    url: "sample-videos/YTDown_YouTube_Build-Car-Ramps-with-Henry-the-MAGNA-TIL_Media_vxwBYubszZ8_001_1080p.mp4",
    videoId: "vxwBYubszZ8-local",
    embedUrl: "",
    title: "Build Car Ramps with Henry the Engineer: Small, Medium and Large Ramp",
    authorName: "MAGNA-TILES",
    authorUrl: "https://www.youtube.com/@magnatiles",
    thumbnailUrl: "",
    providerName: "Local file"
  },
  status: "reviewed",
  collectionLabel: "Car Ramps: Small, Medium, and Large",
  encoderLessons: [
    "This video contains three separate builds, so the encoder must create segments before drafting assembly steps.",
    "Each segment has its own bill of materials and should not share inventory with prior completed builds unless explicitly marked as reused.",
    "BOM title cards are the best chapter boundaries: small at about 00:17, medium at about 00:45, and large at about 01:55.",
    "The large ramp uses XL squares, which are outside the current Classic-100 shape vocabulary and need an additional-materials escape hatch.",
    "The same design motif scales up: wedge or wall supports plus flat ramp planes, but the construction strategy changes by size."
  ],
  segments: [
    {
      id: "small-car-ramp",
      buildLabel: "Small Car Ramp",
      startTimestamp: "00:17",
      endTimestamp: "00:42",
      summary:
        "A compact ramp made from a sloped triangular ramp face and a small side support/landing block for a toy car.",
      billOfMaterials: {
        "small-square": 5,
        "large-square": 0,
        "equilateral-triangle": 0,
        "right-triangle": 2,
        "isosceles-triangle": 2
      },
      observedTechniques: [
        "read bill of materials from text frame",
        "build a wedge from paired right triangles",
        "add a side support",
        "test with a toy car"
      ],
      steps: [
        {
          id: "small-ramp-bom",
          timestamp: "00:17",
          action: "place",
          title: "Read the small ramp bill of materials",
          notes: "Use the title card as authoritative inventory for this segment.",
          subassemblyId: "small-inventory",
          tileCounts: {
            "small-square": 5,
            "large-square": 0,
            "equilateral-triangle": 0,
            "right-triangle": 2,
            "isosceles-triangle": 2
          },
          pieceEstimateConfidence: "high",
          evidence: {
            timestamps: ["00:17", "00:20"],
            overlayText: "Small Car Ramp: 5 Classic Squares; 2 Right Triangles; 2 Isosceles Triangles",
            visualCues: ["blue title card lists the segment materials"]
          }
        },
        {
          id: "small-ramp-wedge",
          timestamp: "00:24",
          action: "build-subassembly",
          title: "Build the sloped wedge",
          notes:
            "Pair the right triangles and square faces into a long triangular ramp body. The sloped surface is assembled as a stable prism-like group.",
          subassemblyId: "small-wedge",
          pieceEstimateConfidence: "medium",
          dependsOn: ["small-ramp-bom"],
          evidence: {
            timestamps: ["00:24"],
            visualCues: ["hands join yellow triangular pieces", "orange square surface forms the ramp face"]
          },
          physicalNotes: [
            "The slope is not a freestanding flat panel; it is supported by triangular side faces."
          ]
        },
        {
          id: "small-ramp-support",
          timestamp: "00:30",
          action: "connect",
          title: "Attach the small landing/support",
          notes:
            "Build a small red square support with green isosceles side pieces and attach it to the top of the sloped ramp.",
          subassemblyId: "small-landing",
          pieceEstimateConfidence: "medium",
          dependsOn: ["small-ramp-wedge"],
          evidence: {
            timestamps: ["00:30"],
            visualCues: ["red square sits at ramp top", "green triangular side support is attached"]
          },
          physicalNotes: ["This creates a short flat landing and keeps the top from collapsing."]
        },
        {
          id: "small-ramp-test",
          timestamp: "00:36",
          action: "balance-check",
          title: "Test the small ramp with a toy car",
          notes:
            "A toy car is placed on the ramp, confirming the slope is aligned and the landing is strong enough.",
          subassemblyId: "small-ramp",
          pieceEstimateConfidence: "high",
          dependsOn: ["small-ramp-support"],
          evidence: {
            timestamps: ["00:36"],
            visualCues: ["yellow toy car is placed on the ramp", "ramp remains standing"]
          },
          physicalNotes: ["The encoder should treat object testing as a validation event, not a tile-placement step."]
        }
      ]
    },
    {
      id: "medium-car-ramp",
      buildLabel: "Medium Car Ramp",
      startTimestamp: "00:45",
      endTimestamp: "01:46",
      summary:
        "A taller ramp with a lower approach, a vertical rear support, side triangular bracing, and decorative/structural top pieces.",
      billOfMaterials: {
        "small-square": 15,
        "large-square": 0,
        "equilateral-triangle": 18,
        "right-triangle": 0,
        "isosceles-triangle": 4
      },
      observedTechniques: [
        "read bill of materials from text frame",
        "scale a ramp by stacking square supports",
        "brace slopes with equilateral triangles",
        "use repeated triangular side panels"
      ],
      steps: [
        {
          id: "medium-ramp-bom",
          timestamp: "00:45",
          action: "place",
          title: "Read the medium ramp bill of materials",
          notes: "Use the title card as the segment inventory before counting visible pieces.",
          subassemblyId: "medium-inventory",
          tileCounts: {
            "small-square": 15,
            "large-square": 0,
            "equilateral-triangle": 18,
            "right-triangle": 0,
            "isosceles-triangle": 4
          },
          pieceEstimateConfidence: "high",
          evidence: {
            timestamps: ["00:45"],
            overlayText:
              "Medium Car Ramp: 18 Equilateral Triangles; 15 Classic Squares; 4 Isosceles Triangles",
            visualCues: ["blue title card lists medium ramp materials"]
          }
        },
        {
          id: "medium-rear-support",
          timestamp: "00:50",
          action: "build-subassembly",
          title: "Build the rear upright support",
          notes:
            "Start with a block of square tiles behind the existing small-ramp style slope, creating the taller back support for the medium ramp.",
          subassemblyId: "medium-rear-support",
          pieceEstimateConfidence: "medium",
          dependsOn: ["medium-ramp-bom"],
          evidence: {
            timestamps: ["00:50", "00:58"],
            visualCues: ["green square panel stands upright", "orange ramp face leans against rear support"]
          },
          physicalNotes: ["The rear support is a vertical wall-like group that carries the top of the ramp."]
        },
        {
          id: "medium-ramp-face",
          timestamp: "01:06",
          action: "connect",
          title: "Connect and brace the sloped face",
          notes:
            "Attach the long orange ramp face to the rear support and add triangular side bracing along the slope.",
          subassemblyId: "medium-slope",
          pieceEstimateConfidence: "medium",
          dependsOn: ["medium-rear-support"],
          evidence: {
            timestamps: ["01:06", "01:14"],
            visualCues: ["orange slope connects to vertical support", "red/yellow triangles are added to side edges"]
          },
          physicalNotes: [
            "This segment relies on angle stability between the ramp plane and upright support."
          ]
        },
        {
          id: "medium-top-braces",
          timestamp: "01:24",
          action: "brace",
          title: "Add top and side triangle braces",
          notes:
            "Add repeated triangular pieces to strengthen the upper slope and side walls.",
          subassemblyId: "medium-braces",
          pieceEstimateConfidence: "medium",
          dependsOn: ["medium-ramp-face"],
          evidence: {
            timestamps: ["01:24", "01:34"],
            visualCues: ["additional red and purple triangular panels are attached", "top edge becomes more enclosed"]
          },
          physicalNotes: ["Repeated triangles should be encoded as patterned bracing, not isolated decorative steps."]
        },
        {
          id: "medium-final-check",
          timestamp: "01:42",
          action: "balance-check",
          title: "Check the completed medium ramp",
          notes:
            "The final medium ramp stands as a taller structure with a lower approach and rear support.",
          subassemblyId: "medium-ramp",
          pieceEstimateConfidence: "high",
          dependsOn: ["medium-top-braces"],
          evidence: {
            timestamps: ["01:42"],
            visualCues: ["medium ramp is shown fully assembled", "slope, rear support, and side braces are visible"]
          },
          physicalNotes: ["Final pose frames should reconcile geometry for the segment before the next segment begins."]
        }
      ]
    },
    {
      id: "large-car-ramp",
      buildLabel: "Large Car Ramp",
      startTimestamp: "01:55",
      endTimestamp: "03:08",
      summary:
        "A large ramp system with a tall square wall, a box platform, an XL-square ramp face, and triangle side markers/braces.",
      billOfMaterials: {
        "small-square": 42,
        "large-square": 0,
        "equilateral-triangle": 6,
        "right-triangle": 0,
        "isosceles-triangle": 0
      },
      additionalMaterials: [
        {
          label: "XL square",
          count: 3,
          notes: "The current Classic-100-compatible catalog does not model this shape yet."
        }
      ],
      observedTechniques: [
        "read bill of materials from text frame",
        "handle multiple builds in one video",
        "build wall panels as grids",
        "create a box platform",
        "use larger unsupported catalog shapes"
      ],
      steps: [
        {
          id: "large-ramp-bom",
          timestamp: "01:55",
          action: "place",
          title: "Read the large ramp bill of materials",
          notes:
            "This segment introduces XL squares, which must be represented outside the current standard magnetic tile inventory.",
          subassemblyId: "large-inventory",
          tileCounts: {
            "small-square": 42,
            "large-square": 0,
            "equilateral-triangle": 6,
            "right-triangle": 0,
            "isosceles-triangle": 0
          },
          pieceEstimateConfidence: "high",
          evidence: {
            timestamps: ["01:55"],
            overlayText:
              "Large Car Ramp: 42 Classic Squares; 6 Equilateral Triangles; 3 XL Squares",
            visualCues: ["blue title card lists large ramp materials"]
          },
          physicalNotes: ["The encoder should flag unsupported catalog pieces instead of silently dropping them."]
        },
        {
          id: "large-wall",
          timestamp: "02:06",
          action: "build-subassembly",
          title: "Build the tall rear wall",
          notes:
            "Assemble square tiles into a large vertical grid panel that will become the high end of the ramp.",
          subassemblyId: "large-rear-wall",
          pieceEstimateConfidence: "medium",
          dependsOn: ["large-ramp-bom"],
          evidence: {
            timestamps: ["02:06", "02:16"],
            visualCues: ["blue/green square grid panel grows into a standing wall"]
          },
          physicalNotes: ["Grid panels should be tracked as rigid subassemblies with rows and columns."]
        },
        {
          id: "large-platform-box",
          timestamp: "02:26",
          action: "build-subassembly",
          title: "Build the lower box platform",
          notes:
            "Build a rectangular red/yellow/orange box that acts as the lower support and landing for the ramp face.",
          subassemblyId: "large-platform",
          pieceEstimateConfidence: "medium",
          dependsOn: ["large-wall"],
          evidence: {
            timestamps: ["02:26", "02:36"],
            visualCues: ["red square walls form a box", "yellow/orange square pieces fill the top/front"]
          },
          physicalNotes: ["The box platform is a separate rigid group that later connects to the rear wall and ramp plane."]
        },
        {
          id: "large-ramp-plane",
          timestamp: "02:46",
          action: "connect",
          title: "Attach the XL square ramp plane",
          notes:
            "Attach a large blue square panel as the main sloped driving surface between the wall/platform assembly and the lower end.",
          subassemblyId: "large-ramp-plane",
          pieceEstimateConfidence: "high",
          dependsOn: ["large-platform-box"],
          evidence: {
            timestamps: ["02:46"],
            visualCues: ["large blue panel bridges the support blocks", "panel is much larger than classic squares"]
          },
          physicalNotes: [
            "This step depends on catalog support for XL square dimensions and magnet positions.",
            "A better encoder should ask for calibration when an unseen shape appears."
          ]
        },
        {
          id: "large-triangle-markers",
          timestamp: "02:58",
          action: "brace",
          title: "Add triangular side pieces",
          notes:
            "Add equilateral triangles around the ramp as side markers, braces, or decorative guards.",
          subassemblyId: "large-side-triangles",
          pieceEstimateConfidence: "medium",
          dependsOn: ["large-ramp-plane"],
          evidence: {
            timestamps: ["02:58", "03:08"],
            visualCues: ["yellow and green triangles are placed near ramp sides", "finished ramp remains stable"]
          },
          physicalNotes: ["Triangles may be visual guardrails or side braces; mark as human-review geometry."]
        }
      ]
    }
  ]
};
