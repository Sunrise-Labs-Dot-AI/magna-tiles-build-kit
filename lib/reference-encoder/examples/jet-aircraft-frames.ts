export interface JetAircraftReferenceFrame {
  id: string;
  label: string;
  timestamp: string;
  src: string;
  role: "bom" | "body" | "nose" | "wing" | "tail" | "fin" | "final";
  note: string;
}

export const JET_AIRCRAFT_REFERENCE_FRAMES: JetAircraftReferenceFrame[] = [
  {
    id: "jet-bom",
    label: "BOM",
    timestamp: "00:11",
    src: "/reference-frames/jet-aircraft/bom.jpg",
    role: "bom",
    note: "Pinned inventory: 16 squares, 9 equilateral, 10 right, 5 isosceles."
  },
  {
    id: "jet-body-balance",
    label: "Body balance",
    timestamp: "00:40",
    src: "/reference-frames/jet-aircraft/body-balance.jpg",
    role: "body",
    note: "Upright fuselage is squared before the detail modules go on."
  },
  {
    id: "jet-nose",
    label: "Nose attach",
    timestamp: "01:40",
    src: "/reference-frames/jet-aircraft/nose-attach.jpg",
    role: "nose",
    note: "Pointed blue nose module attaches as a grouped section."
  },
  {
    id: "jet-wings",
    label: "Wing attach",
    timestamp: "03:20",
    src: "/reference-frames/jet-aircraft/wing-attach.jpg",
    role: "wing",
    note: "Mirrored wing groups are leveled against the side body edges."
  },
  {
    id: "jet-tail-tip",
    label: "Tail order",
    timestamp: "04:20",
    src: "/reference-frames/jet-aircraft/tail-ordering-tip.jpg",
    role: "tail",
    note: "Overlay says horizontal tail first, then vertical tail on top."
  },
  {
    id: "jet-top-fin",
    label: "Top fin",
    timestamp: "05:20",
    src: "/reference-frames/jet-aircraft/top-fin.jpg",
    role: "fin",
    note: "Green top fin is handled as a separate subassembly."
  },
  {
    id: "jet-final-front",
    label: "Final front",
    timestamp: "06:00",
    src: "/reference-frames/jet-aircraft/final-front.jpg",
    role: "final",
    note: "Finished aircraft from the front shows wing symmetry and tail height."
  },
  {
    id: "jet-final-side",
    label: "Final side",
    timestamp: "06:20",
    src: "/reference-frames/jet-aircraft/final-side.jpg",
    role: "final",
    note: "Side pose is the main silhouette target for reconstruction."
  },
  {
    id: "jet-final-rear",
    label: "Final rear",
    timestamp: "06:40",
    src: "/reference-frames/jet-aircraft/final-rear.jpg",
    role: "final",
    note: "Rear pose confirms horizontal tail before vertical tail."
  }
];

export const JET_AIRCRAFT_CONTACT_SHEET = "/reference-frames/jet-aircraft/contact-sheet.jpg";
