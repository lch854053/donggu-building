import {readFileSync} from 'node:fs';
const scope={};
new Function('globalThis',readFileSync(new URL('../../stats-metadata.js',import.meta.url),'utf8'))(scope);
export const {metadata:statsMetadata}=scope.StatsMetadata;
