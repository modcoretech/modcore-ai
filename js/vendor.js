/**
 * Vendor bridge. Both libs are ES modules and must be imported here
 * exactly once; nothing else touches them directly.
 */
import * as smd from '../lib/smd.js';
import * as shj from '../lib/speed-highlight.js';

export { smd, shj };