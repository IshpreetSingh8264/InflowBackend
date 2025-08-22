import express from 'express';
import { searchDocuments } from '../n8n/n8nController.js';

const router = express.Router();

// Document search endpoint
router.post('/search', searchDocuments);

export default router;