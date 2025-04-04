import  pool  from '../database/db.js';
import { StatusCodes } from 'http-status-codes';

/**
 * Create a new transaction
 * @route POST /api/transactions
 */
export const createTransaction = async (req, res) => {
  try {
    const { title, description, amount, type, created_at } = req.body;
    const uuid = req.user.uuid; // Assuming user UUID comes from auth middleware
    
    // Basic validation for required fields
    if (!title || !amount || !type) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: 'Please provide title, amount, and type'
      });
    }
    
    let query;
    let values;
    
    // Handle optional created_at date parameter
    if (created_at) {
      query = `
        INSERT INTO transactions (uuid, title, description, amount, type, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      values = [uuid, title, description, amount, type, created_at];
    } else {
      query = `
        INSERT INTO transactions (uuid, title, description, amount, type)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      values = [uuid, title, description, amount, type];
    }
    
    const { rows } = await pool.query(query, values);

    
    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: 'Transaction created successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error creating transaction:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to create transaction'
    });
  }
};

/**
 * Update an existing transaction
 * @route PUT /api/transactions/:id
 */
export const updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, amount, type, created_at } = req.body;
    const uuid = req.user.uuid; // From auth middleware
    
    // Verify transaction belongs to user
    const verifyQuery = 'SELECT * FROM transactions WHERE id = $1 AND uuid = $2';
    const verifyResult = await pool.query(verifyQuery, [id, uuid]);
    
    if (verifyResult.rows.length === 0) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: 'Transaction not found or not authorized to update'
      });
    }
    
    // Update the transaction
    const query = `
      UPDATE transactions
      SET title = $1, description = $2, amount = $3, type = $4, created_at = $5
      WHERE id = $6 AND uuid = $7
      RETURNING *
    `;
    
    const values = [
      title || verifyResult.rows[0].title,
      description !== undefined ? description : verifyResult.rows[0].description,
      amount || verifyResult.rows[0].amount,
      type || verifyResult.rows[0].type,
      created_at || verifyResult.rows[0].created_at,
      id,
      uuid
    ];
    
    const { rows } = await pool.query(query, values);
    
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Transaction updated successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to update transaction'
    });
  }
};

/**
 * Delete a transaction
 * @route DELETE /api/transactions/:id
 */
export const deleteTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const uuid = req.user.uuid; // From auth middleware
    
    const query = 'DELETE FROM transactions WHERE id = $1 AND uuid = $2 RETURNING *';
    const { rows } = await pool.query(query, [id, uuid]);
    
    if (rows.length === 0) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: 'Transaction not found or not authorized to delete'
      });
    }
    
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Transaction deleted successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to delete transaction'
    });
  }
};

/**
 * Get all transactions for a user
 * @route GET /api/transactions
 */
export const getTransactions = async (req, res) => {
  try {
    const uuid = req.user.uuid; // From auth middleware
    
    const query = 'SELECT * FROM transactions WHERE uuid = $1 ORDER BY created_at DESC';
    const { rows } = await pool.query(query, [uuid]);
    
    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Transactions retrieved successfully',
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Error retrieving transactions:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to retrieve transactions'
    });
  }
};

/**
 * Bulk create multiple transactions
 * @route POST /api/transactions/bulk
 */
export const bulkCreateTransactions = async (req, res) => {
    try {
      const { transactions } = req.body;
      const uuid = req.user.uuid; // From auth middleware
      
      // Check if transactions array exists and is not empty
      if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Please provide an array of transactions'
        });
      }
      
      // Validate and prepare transactions for bulk insertion
      const validTransactions = [];
      const invalidTransactions = [];
      
      transactions.forEach((transaction, index) => {
        const { title, description, amount, type, created_at } = transaction;
        
        // Basic validation
        if (!title || !amount || !type) {
          invalidTransactions.push({
            index,
            transaction,
            reason: 'Missing required fields (title, amount, or type)'
          });
          return;
        }
        
        // Check type validity
        if (type !== 'Income' && type !== 'Expense') {
          invalidTransactions.push({
            index,
            transaction,
            reason: 'Type must be either "Income" or "Expense"'
          });
          return;
        }
        
        // Add to valid transactions with user UUID
        validTransactions.push({
          ...transaction,
          uuid
        });
      });
      
      // If no valid transactions, return error
      if (validTransactions.length === 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'No valid transactions to insert',
          invalidTransactions
        });
      }
      
      // Prepare arrays for bulk insert using unnest
      const titles = [];
      const descriptions = [];
      const amounts = [];
      const types = [];
      const createdAts = [];
      const uuids = [];
      
      validTransactions.forEach(transaction => {
        titles.push(transaction.title);
        descriptions.push(transaction.description || null);
        amounts.push(transaction.amount);
        types.push(transaction.type);
        createdAts.push(transaction.created_at || null);
        uuids.push(uuid);
      });
      
      // Build query based on whether we have created_at values
      let query;
      let queryParams;
      
      if (createdAts.some(date => date !== null)) {
        // If any transactions have created_at, include it in the query
        query = `
          INSERT INTO transactions (uuid, title, description, amount, type, created_at)
          SELECT u, t, d, a, ty, c
          FROM UNNEST($1::uuid[], $2::varchar[], $3::text[], $4::numeric[], $5::varchar[], $6::timestamp[]) AS t(u, t, d, a, ty, c)
          RETURNING *
        `;
        queryParams = [uuids, titles, descriptions, amounts, types, createdAts];
      } else {
        // Otherwise, use default timestamp
        query = `
          INSERT INTO transactions (uuid, title, description, amount, type)
          SELECT u, t, d, a, ty
          FROM UNNEST($1::uuid[], $2::varchar[], $3::text[], $4::numeric[], $5::varchar[]) AS t(u, t, d, a, ty)
          RETURNING *
        `;
        queryParams = [uuids, titles, descriptions, amounts, types];
      }
      
      // Execute bulk insert
      const { rows } = await pool.query(query, queryParams);
      
      return res.status(StatusCodes.CREATED).json({
        success: true,
        message: `Successfully inserted ${rows.length} transactions`,
        successCount: rows.length,
        failedCount: invalidTransactions.length,
        invalidTransactions: invalidTransactions.length > 0 ? invalidTransactions : undefined
      });
    } catch (error) {
      console.error('Error bulk creating transactions:', error);
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to bulk create transactions'
      });
    }
  };