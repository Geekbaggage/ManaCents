// Land cycle gallery data — derived from catalog seed v0.4.2.
// Each cycle lists member land names exactly as in the catalog.
export const LAND_CYCLES = [
  {
    id: "basic", name: "Basic Lands", trait: "Always untapped. The baseline.",
    members: ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"],
  },
  {
    id: "pain", name: "Pain Lands", trait: "Untapped colors for 1 damage.",
    members: ["Adarkar Wastes", "Underground River", "Sulfurous Springs",
              "Karplusan Forest", "Brushland", "Battlefield Forge"],
  },
  {
    id: "check", name: "Check Lands", trait: "Untapped if you control a land with a matching basic land type — typed nonbasics count.",
    members: ["Glacial Fortress", "Drowned Catacomb", "Dragonskull Summit"],
  },
  {
    id: "shock", name: "Shock Lands", trait: "Pay 2 life to enter untapped, or enter tapped. Your choice.",
    members: ["Hallowed Fountain", "Watery Grave", "Blood Crypt"],
  },
  {
    id: "bond", name: "Bond Lands", trait: "Untapped with 2+ opponents.",
    members: ["Sea of Clouds", "Morphic Pool", "Luxury Suite"],
  },
  {
    id: "fast", name: "Fast Lands", trait: "Untapped if you control two or fewer other lands.",
    members: ["Seachrome Coast", "Darkslick Shores"],
  },
  {
    id: "slow", name: "Slow Lands", trait: "Untapped if you control two or more other lands.",
    members: ["Deserted Beach", "Shipwreck Marsh"],
  },
  {
    id: "filter", name: "Filter Lands", trait: "Turn one color into two.",
    members: ["Mystic Gate", "Sunken Ruins"],
  },
  {
    id: "tango", name: "Tango Lands", trait: "Untapped with 2+ basics.",
    members: ["Prairie Stream", "Sunken Hollow"],
  },
  {
    id: "bounce", name: "Bounce Lands", trait: "Two mana, enters tapped, bounces a land.",
    members: ["Azorius Chancery", "Dimir Aqueduct"],
  },
  {
    id: "verge", name: "Verge Lands", trait: "Enters untapped. The second color is conditional on a basic land type — see each card.",
    members: ["Floodfarm Verge", "Gloomlake Verge"],
  },
  {
    id: "surveil", name: "Surveil Lands", trait: "Surveil 1 on entry.",
    members: ["Undercity Sewers", "Shadowy Backstreet"],
  },
  {
    id: "triome", name: "Triomes", trait: "Three colors + cycling.",
    members: ["Raugrin Triome", "Zagoth Triome"],
  },
  {
    id: "horizon", name: "Horizon Lands", trait: "Untapped colors for 1 life; sac to draw.",
    members: ["Horizon Canopy", "Waterlogged Grove"],
  },
  {
    id: "rainbow", name: "Rainbow Lands", trait: "Any color for 1 life.",
    members: ["Mana Confluence", "City of Brass"],
  },
  {
    id: "fetch", name: "Fetch Lands", trait: "Tutor the perfect dual. Premium price.",
    members: ["Flooded Strand", "Polluted Delta"],
  },
  {
    id: "utility", name: "Utility", trait: "Format staples that go anywhere.",
    members: ["Command Tower", "Exotic Orchard"],
  },
];
