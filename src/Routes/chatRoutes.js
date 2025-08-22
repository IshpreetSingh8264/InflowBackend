import express from 'express';
import { initializeChat, sendMessage, getChatHistory, clearChatHistory } from '../lllm/chat.js';
// import summarizeTransactions from '../lllm/summaryTransactions.js'; // Import the summariseTransactions function
// import categorizeTransactions from '../lllm/categoriseTransaction.js';
const router=express.Router();




router.post('/initialize', initializeChat);
router.post('/message', sendMessage);
router.get('/history', getChatHistory);
router.delete('/clear', clearChatHistory);
export default router;