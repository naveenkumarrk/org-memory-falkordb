import fs from 'node:fs';
fs.mkdirSync('web/vendor', { recursive: true });
fs.copyFileSync('node_modules/cytoscape/dist/cytoscape.min.js', 'web/vendor/cytoscape.min.js');
fs.copyFileSync('node_modules/cytoscape/LICENSE', 'web/vendor/cytoscape.LICENSE');
