// Same browser-global pure model is evaluated in Node, following test/_loader.js.
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../vacant-model.js',import.meta.url),'utf8');
export const {identifyVacantRows,createVacantDataset,vacantCounts,vacantAddressKey,vacantLegacyMatchKey,vacantFingerprint,groupVacantGeometry}=
  new Function(source+'\nreturn {identifyVacantRows,createVacantDataset,vacantCounts,vacantAddressKey,vacantLegacyMatchKey,vacantFingerprint,groupVacantGeometry};')();
