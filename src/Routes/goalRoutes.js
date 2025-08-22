import express from 'express';
import { 
  createGoal,
  updateGoal,
  deleteGoal,
  getGoals
} from '../Controllers/goalController.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// Apply authentication to all goal routes
router.use(authenticateUser);

// GET /api/goals - Get all user financial goals
router.get('/', getGoals);

// POST /api/goals - Create new financial goal
router.post('/', createGoal);

// PUT /api/goals/:id - Update goal by id
router.put('/:id', updateGoal);

// DELETE /api/goals/:id - Delete goal by id
router.delete('/:id', deleteGoal);



export default router;