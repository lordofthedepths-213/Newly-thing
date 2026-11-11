// Colour code requested for the app (matches the APWA uniform colour code
// used for utility mark-outs, with white for proposed work).
export const UTILITIES = [
  { id: 'water', label: 'Water', color: '#1e6bff' },
  { id: 'gas', label: 'Gas', color: '#ffd400' },
  { id: 'power', label: 'Power', color: '#e3202b' },
  { id: 'sewer', label: 'Sewer', color: '#1faa3c' },
  { id: 'comm', label: 'Communications', color: '#ff8a00' },
  { id: 'proposed', label: 'Proposed / New', color: '#ffffff' },
];

export const LOCATE_METHODS = [
  'Electromagnetic locator',
  'Ground-penetrating radar',
  'Pothole / vacuum excavation',
  'Utility mark-out (811)',
  'As-built / record drawing',
  'Visual (valve, manhole, meter)',
  'Design (proposed)',
  'Other',
];

export function utilityById(id) {
  return UTILITIES.find((u) => u.id === id) || UTILITIES[0];
}
