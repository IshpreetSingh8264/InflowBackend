import express from 'express';
import { 
  createTransaction, 
  updateTransaction, 
  deleteTransaction, 
  getTransactions,
  bulkCreateTransactions 
} from '../Controllers/transactionController.js';
import { authenticateUser } from '../middleware/auth.js'; // Assuming this middleware exists

const router = express.Router();

// Apply authentication to all transaction routes
// This middleware will verify the JWT and set req.user with the user info including uuid
router.use(authenticateUser);

// GET /api/transactions - Get all user transactions
router.get('/', getTransactions);

// POST /api/transactions - Create new transaction
router.post('/', createTransaction);

// PUT /api/transactions/:id - Update transaction by id
router.put('/:id', updateTransaction);

// DELETE /api/transactions/:id - Delete transaction by id
router.delete('/:id', deleteTransaction);

// Add this to your transactionRoutes.js file
router.post('/bulk', bulkCreateTransactions);

export default router;