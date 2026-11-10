import multer from 'multer';
import { env } from '../config/env.js';

// Files are held in memory (max UPLOAD_MAX_FILE_MB each) and validated by their bytes in the
// media service. Nothing user-supplied is ever written to disk under its own name.
const base = (maxFiles) => multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_FILE_MB * 1024 * 1024, files: maxFiles, fields: 10, fieldSize: 10 * 1024, parts: maxFiles + 10 },
});

/** Product photos: up to 10 files in the "images" field. */
export const uploadProductImages = base(10).array('images', 10);

/** One verification document in the "file" field. */
export const uploadDocument = base(1).single('file');
