const {distributionDomain} = require('./distribution.cjs');
const labels = {cad: 'CAD', chip: 'Chip', pcb: 'PCB', godot: 'Godot'};
const emojis = {cad: '📐', chip: '💠', pcb: '🔌', godot: '🎮'};

function listDomains(capabilities) {
  return [...new Set(distributionDomain ? [distributionDomain] : [...capabilities.map(item => item.domain).filter(Boolean), 'godot'])]
    .sort((a, b) => a.localeCompare(b))
    .map(id => ({id, label: labels[id] || id.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '), emoji: emojis[id] || '⚙️'}));
}

module.exports = {listDomains};
