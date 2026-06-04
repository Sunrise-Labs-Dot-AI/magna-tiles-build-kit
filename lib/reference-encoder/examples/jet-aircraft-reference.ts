import type { ReferenceBuildEncoding } from "../types";

export const JET_AIRCRAFT_REFERENCE_ENCODING: ReferenceBuildEncoding = {
  source: {
    url: "sample-videos/YTDown_YouTube_Magna-Tiles-Idea-Jet-Aircraft_Media_WDtC_9se3ds_001_1080p.mp4",
    videoId: "WDtC_9se3ds-local",
    embedUrl: "",
    title: "Magnetic Tile Idea: Jet Aircraft",
    authorName: "JD's Curious Company",
    authorUrl: "https://www.youtube.com/@JDsCuriousCompany",
    thumbnailUrl: "",
    providerName: "Local file"
  },
  status: "reviewed",
  buildLabel: "Jet Aircraft",
  billOfMaterials: {
    "small-square": 16,
    "large-square": 0,
    "equilateral-triangle": 9,
    "right-triangle": 10,
    "isosceles-triangle": 5
  },
  observedTechniques: [
    "skip intro/product preview",
    "read bill of materials from text frame",
    "make a subassembly",
    "build upright and tune balance",
    "use mirrored assemblies",
    "adjust angle for magnet alignment",
    "follow overlay tips"
  ],
  encoderLessons: [
    "The opening product shot is useful as a target pose but should not be encoded as an assembly step.",
    "The 00:11 text frame is the authoritative bill of materials and should be pinned before motion analysis.",
    "Instructional text overlays are higher-signal than generic frame-change scores.",
    "Several steps are manipulation-only: the builder adjusts angles and magnet seating without adding pieces.",
    "Subassemblies are often built off to the side, then attached as a group."
  ],
  steps: [
    {
      id: "jet-bom",
      timestamp: "00:11",
      action: "place",
      title: "Read the bill of materials",
      notes:
        "Use the text card as the source of truth for total pieces before estimating any construction step counts.",
      subassemblyId: "inventory",
      tileCounts: {
        "small-square": 16,
        "large-square": 0,
        "equilateral-triangle": 9,
        "right-triangle": 10,
        "isosceles-triangle": 5
      },
      pieceEstimateConfidence: "high",
      learnedTechnique: "read bill of materials from text frame",
      evidence: {
        timestamps: ["00:11"],
        overlayText:
          "Square x 16; Isosceles Triangle x 5; Equilateral Triangle x 9; Right Triangle x 10",
        visualCues: ["large white inventory text", "all required shapes displayed in piles"]
      }
    },
    {
      id: "jet-body-column",
      timestamp: "00:22",
      action: "build-subassembly",
      title: "Build the upright body column",
      notes:
        "Start with square tiles and build the central fuselage as a vertical stack. The body is not just placed flat; it must stand and hold shape before later attachments.",
      subassemblyId: "body",
      pieceEstimateConfidence: "medium",
      learnedTechnique: "make a subassembly",
      evidence: {
        timestamps: ["00:22", "00:34", "00:46"],
        visualCues: [
          "square tiles are stacked into a standing body",
          "body remains centered while extra pieces wait off to the side"
        ]
      },
      physicalNotes: [
        "Track the body as an upright group, not independent loose tiles.",
        "Balance depends on vertical square alignment before the nose and wings are added."
      ]
    },
    {
      id: "jet-body-balance",
      timestamp: "01:04",
      action: "adjust",
      title: "Tune the body until it stands",
      notes:
        "The builder explicitly adjusts the body until it stands by itself. This is a real assembly operation even though no new tile is added.",
      subassemblyId: "body",
      pieceEstimateConfidence: "high",
      learnedTechnique: "adjust angle for magnet alignment",
      dependsOn: ["jet-body-column"],
      evidence: {
        timestamps: ["01:04"],
        overlayText: "Tip: Adjust the tiles until the body stands by itself",
        visualCues: ["hands press and square the body", "body is checked unsupported"]
      },
      physicalNotes: [
        "Represent this as a stability checkpoint with no added inventory.",
        "The encoder should preserve adjustment steps because they explain why the build is physically plausible."
      ]
    },
    {
      id: "jet-nose",
      timestamp: "01:18",
      action: "connect",
      title: "Attach the pointed nose section",
      notes:
        "A blue pointed triangular group is attached to the front/lower body, shifting the aircraft from a plain body column into an airframe.",
      subassemblyId: "nose",
      pieceEstimateConfidence: "medium",
      learnedTechnique: "make a subassembly",
      dependsOn: ["jet-body-balance"],
      evidence: {
        timestamps: ["01:18"],
        visualCues: ["builder seats a blue pointed section against the body", "hands hold the joint while magnets catch"]
      },
      physicalNotes: ["The nose changes the support footprint and should trigger another stability check."]
    },
    {
      id: "jet-left-wing",
      timestamp: "02:02",
      action: "build-subassembly",
      title: "Build and attach the first wing module",
      notes:
        "The wing is assembled off-body from a square with triangular pieces, then attached as a block to one side of the body.",
      subassemblyId: "left-wing",
      pieceEstimateConfidence: "medium",
      learnedTechnique: "make a subassembly",
      dependsOn: ["jet-nose"],
      evidence: {
        timestamps: ["01:44", "02:02", "02:31"],
        visualCues: [
          "builder creates a purple square/triangle wing module off to the side",
          "completed module is brought to the body side"
        ]
      },
      physicalNotes: ["The encoder needs a subassembly operation before the attach operation."]
    },
    {
      id: "jet-right-wing",
      timestamp: "02:31",
      action: "build-subassembly",
      title: "Mirror the wing module on the other side",
      notes:
        "The second wing repeats the first wing pattern in mirrored orientation, then attaches to the opposite body edge.",
      subassemblyId: "right-wing",
      pieceEstimateConfidence: "medium",
      learnedTechnique: "use symmetry",
      dependsOn: ["jet-left-wing"],
      evidence: {
        timestamps: ["02:31", "02:45"],
        visualCues: ["matching wing module is placed on the opposite side", "left and right wings align horizontally"]
      },
      physicalNotes: ["The encoder should detect mirrored assemblies to reduce duplicated instruction text."]
    },
    {
      id: "jet-wing-alignment",
      timestamp: "03:05",
      action: "adjust",
      title: "Align both wings neatly to the body",
      notes:
        "The text overlay calls out a magnet-alignment adjustment after both wings are attached.",
      subassemblyId: "wings",
      pieceEstimateConfidence: "high",
      learnedTechnique: "adjust angle for magnet alignment",
      dependsOn: ["jet-left-wing", "jet-right-wing"],
      evidence: {
        timestamps: ["03:05"],
        overlayText: "Tip: Adjust the tiles until both wings are neatly attached to the body",
        visualCues: ["hands press the side joints", "wings are leveled against the body"]
      },
      physicalNotes: ["This is a manipulation-only step and should not consume inventory."]
    },
    {
      id: "jet-tail-end",
      timestamp: "03:50",
      action: "connect",
      title: "Attach the rear tail piece",
      notes:
        "The rear tail begins as an end attachment at the back of the body, partly obscured by the camera angle.",
      subassemblyId: "tail",
      pieceEstimateConfidence: "medium",
      learnedTechnique: "temporary hand support",
      dependsOn: ["jet-wing-alignment"],
      evidence: {
        timestamps: ["03:50"],
        overlayText: "Attach the tail piece at the end of the body. Sorry about the poor angle!",
        visualCues: ["rear body area is handled", "tail pieces are selected from the side pile"]
      },
      physicalNotes: ["The encoder should preserve camera-quality notes and request human review when the contact edge is hidden."]
    },
    {
      id: "jet-tail-horizontal-vertical",
      timestamp: "04:10",
      action: "connect",
      title: "Add horizontal tail first, then vertical tail",
      notes:
        "The overlay provides the ordering constraint: attach the horizontal tail before stacking the vertical tail on top.",
      subassemblyId: "tail",
      pieceEstimateConfidence: "high",
      learnedTechnique: "follow overlay tips",
      dependsOn: ["jet-tail-end"],
      evidence: {
        timestamps: ["04:10"],
        overlayText:
          "Tip: Attach the horizontal tail piece first. Then put on the vertical tail piece on top of horizontal piece.",
        visualCues: ["horizontal tail lies across the rear", "vertical pieces are added above it"]
      },
      physicalNotes: ["Ordering matters because the vertical tail depends on a horizontal magnetic base."]
    },
    {
      id: "jet-top-fin",
      timestamp: "05:25",
      action: "connect",
      title: "Build and attach the top front fin",
      notes:
        "A green triangular front fin is built as its own small group and mounted to the upper/front body.",
      subassemblyId: "top-fin",
      pieceEstimateConfidence: "medium",
      learnedTechnique: "make a subassembly",
      dependsOn: ["jet-tail-horizontal-vertical"],
      evidence: {
        timestamps: ["04:52", "05:25"],
        visualCues: [
          "green triangular group is built from the side pile",
          "group is pressed onto the top/front of the aircraft"
        ]
      },
      physicalNotes: ["Large visible subassembly rotations should be represented as group transforms."]
    },
    {
      id: "jet-final-check",
      timestamp: "06:15",
      action: "balance-check",
      title: "Rotate and inspect the finished aircraft",
      notes:
        "The builder rotates the aircraft through front, side, and rear views to show the final geometry and stability.",
      subassemblyId: "aircraft",
      pieceEstimateConfidence: "high",
      learnedTechnique: "widen base for balance",
      dependsOn: ["jet-top-fin"],
      evidence: {
        timestamps: ["05:50", "06:15", "06:35"],
        visualCues: ["aircraft is handled as one complete rigid group", "front/side/rear views reveal final target pose"]
      },
      physicalNotes: [
        "Final glamor frames should be linked to validation/pose reconstruction, not treated as construction steps.",
        "The final build has multiple angled subassemblies, so a plain tile-placement timeline is insufficient."
      ]
    }
  ]
};
