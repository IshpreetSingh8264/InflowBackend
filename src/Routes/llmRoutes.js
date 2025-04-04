import express from 'express';
import summarizeTransactions from '../lllm/summaryTransactions.js'; // Import the summariseTransactions function
import categorizeTransactions from '../lllm/categoriseTransaction.js';
const router=express.Router();
// Add this route after your existing routes
router.get('/categorise', categorizeTransactions);
// This route will handle GET requests to /api/llm/categories
// and will use the categorizeTransactions function to process the request. 
router.get('/summarise',summarizeTransactions);
export default router;