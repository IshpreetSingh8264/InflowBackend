import pool from '../database/db.js';
import { StatusCodes } from 'http-status-codes';

/**
 * Create a new financial goal
 * @route POST /api/goals
 */
export const createGoal = async (req, res) => {
  try {
    const { name, description, timeLimit, is_completed } = req.body;
    const uuid = req.user.uuid; // From auth middleware
    
    // Validate required fields
    if (!name || !timeLimit) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Please provide name and timeLimit'
      });
    }
    
    const query = `
      INSERT INTO goals (uuid, name, description, timeLimit, is_completed)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    // Use default false for is_completed if not provided
    const completedStatus = is_completed !== undefined ? is_completed : false;
    
    const values = [uuid, name, description, timeLimit, completedStatus];
    const { rows } = await pool.query(query, values);
    
    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: 'Financial goal created successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error creating goal:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to create financial goal'
    });
  }
};

/**
 * Update a financial goal
 * @route PUT /api/goals/:id
 */
export const updateGoal = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, timeLimit, is_completed } = req.body;
    const uuid = req.user.uuid; // From auth middleware
    
    // Verify goal belongs to user
    const verifyQuery = 'SELECT * FROM goals WHERE id = $1 AND uuid = $2';
    const verifyResult = await pool.query(verifyQuery, [id, uuid]);
    
    if (verifyResult.rows.length === 0) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: 'Goal not found or not authorized to update'
      });
    }
    
    // Update the goal
    const query = `
      UPDATE goals
      SET name = $1, description = $2, timeLimit = $3, is_completed = $4
      WHERE id = $5 AND uuid = $6
      RETURNING *
    `;
    
    const values = [
      name || verifyResult.rows[0].name,
      description !== undefined ? description : verifyResult.rows[0].description,
      timeLimit || verifyResult.rows[0].timelimit,
      is_completed !== undefined ? is_completed : verifyResult.rows[0].is_completed,
      id,
      uuid
    ];
    
    const { rows } = await pool.query(query, values);
    
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Goal updated successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error updating goal:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to update goal'
    });
  }
};

/**
 * Delete a financial goal
 * @route DELETE /api/goals/:id
 */
export const deleteGoal = async (req, res) => {
  try {
    const { id } = req.params;
    const uuid = req.user.uuid; // From auth middleware
    
    const query = 'DELETE FROM goals WHERE id = $1 AND uuid = $2 RETURNING *';
    const { rows } = await pool.query(query, [id, uuid]);
    
    if (rows.length === 0) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: 'Goal not found or not authorized to delete'
      });
    }
    
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Goal deleted successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error deleting goal:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to delete goal'
    });
  }
};

/**
 * Get all financial goals for a user
 * @route GET /api/goals
 */
export const getGoals = async (req, res) => {
  try {
    const uuid = req.user.uuid; // From auth middleware
    const currentDate = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
    
    // First, retrieve all goals
    const query = 'SELECT * FROM goals WHERE uuid = $1 ORDER BY timeLimit ASC';
    const { rows } = await pool.query(query, [uuid]);
    
    // Check for expired goals and update them if needed
    for (let i = 0; i < rows.length; i++) {
      const goal = rows[i];
      // If the goal's timeLimit has passed and it's not completed, mark it as failed
      if (goal.timelimit < currentDate && !goal.is_completed) {
        const updateQuery = `
          UPDATE goals 
          SET is_completed = false 
          WHERE id = $1 AND uuid = $2
          RETURNING *
        `;
        const updateResult = await pool.query(updateQuery, [goal.id, uuid]);
        rows[i] = updateResult.rows[0]; // Update the row in our results
      }
    }
    
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Goals retrieved successfully',
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error retrieving goals:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to retrieve goals'
    });
  }
};