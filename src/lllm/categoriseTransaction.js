import { Ollama } from 'ollama';
import { StatusCodes } from 'http-status-codes';
import pool from '../database/db.js';

// Initialize Ollama
const ollama = new Ollama({ host: 'http://localhost:11434' }); // Default Ollama port

// Required minimum number of categories
const MIN_CATEGORIES = 6;

// Required specific categories (must have at least these)
const REQUIRED_SPECIFIC_CATEGORIES = [
    'Personal', 
    'Home expenses', 
    'Education', 
    'Leisure_Entertainment', 
    'Investments_Assets', 
    'Miscellaneous'
  ];

/**
 * Process transactions through LLM to categorize them
 * @param {Array} transactions - Array of transaction objects
 * @returns {Object} Categorized transaction data
 */
async function processTransactionsWithLLM(transactions) {
  try {
    // Format transactions for the prompt with more emphasis on descriptions
    const transactionText = transactions.map(t => 
      `ID: ${t.id}, Title: "${t.title}", Description: "${t.description || 'None'}", Amount: $${t.amount}, Type: ${t.type}`
    ).join('\n');
    
    // Enhanced prompt with very explicit instructions and forced categorization
        // Enhanced prompt with very explicit instructions and forced categorization
        const prompt = `
You are a financial analysis AI. I need you to categorize these financial transactions into EXACTLY the following 6 categories:
1. Personal (e.g., clothing, personal care items, health expenses, groceries, dining out for individual needs)
2. Home expenses (e.g., rent, mortgage, utilities, repairs, furniture, household supplies)
3. Education (e.g., tuition fees, books, courses, tutoring, educational software, school supplies)
4. Leisure & Entertainment (e.g., movies, games, subscriptions, hobbies, travel, vacations)
5. Investments & Assets (e.g., stocks, mutual funds, real estate investments, business investments, savings)
6. Miscellaneous (e.g., any transactions that don't clearly fit the above categories, gifts, donations)

CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE EXACTLY:
1. Carefully analyze each transaction's title and description
2. Sort EVERY transaction into one of the above 6 categories - NO OTHER CATEGORIES
3. For EACH category, calculate the TOTAL AMOUNT in dollars of all transactions in that category
4. For EACH category, calculate the PERCENTAGE of total spending it represents
5. Format your response as valid JSON with amounts and percentages as numbers, not strings

Here are the transactions to categorize:
${transactionText}

Respond with ONLY this exact JSON structure:
{
  "categories": [
    {
      "name": "Personal",
      "amount": 1234.56,
      "percentage": 25.5
    },
    {
      "name": "Home expenses",
      "amount": 2000.00,
      "percentage": 30.5
    },
    {
      "name": "Education", 
      "amount": 500.00,
      "percentage": 10.0
    },
    {
      "name": "Leisure & Entertainment",
      "amount": 800.00,
      "percentage": 15.0
    },
    {
      "name": "Investments & Assets",
      "amount": 900.00,
      "percentage": 16.5
    },
    {
      "name": "Miscellaneous",
      "amount": 200.00,
      "percentage": 3.0
    }
  ]
}

Include all 6 categories even if some have 0 amount. Always include both amount and percentage as numbers.
`;
    // Call local Llama model with lower temperature for more consistent categorization
    const response = await ollama.chat({
      model: 'llama3:latest',
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.1,
        num_ctx:8192
    }  // Lower temperature for more consistent results
      }
);

    // Extract response content
    let responseContent = response.message.content.trim();
    
    // Handle various ways the LLM might format the JSON
    if (responseContent.startsWith('```json')) {
      responseContent = responseContent.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (responseContent.startsWith('```')) {
      responseContent = responseContent.replace(/^```\n/, '').replace(/\n```$/, '');
    }

    // Extract JSON part if there's additional text
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      responseContent = jsonMatch[0];
    }

    // Parse and validate the response
    const categorizedData = JSON.parse(responseContent);
    
    // Validate that we have categories
    if (!categorizedData.categories || categorizedData.categories.length === 0) {
      throw new Error('LLM did not return any categories');
    }
    
    // Verify we have all required categories
    const returnedCategories = new Set(categorizedData.categories.map(c => c.name));
    const missingCategories = REQUIRED_SPECIFIC_CATEGORIES.filter(c => !returnedCategories.has(c));
    
    if (missingCategories.length > 0) {
      // Add missing categories with zero values
      missingCategories.forEach(categoryName => {
        categorizedData.categories.push({
          name: categoryName,
          amount: 0,
          percentage: 0
        });
      });
    }
    
    return categorizedData;
  } catch (error) {
    console.error('Error processing transactions with LLM:', error);
    
    // Fall back to using our required categories
    const totalAmount = transactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    
    return {
      categories: REQUIRED_SPECIFIC_CATEGORIES.map(name => ({
        name,
        amount: name === 'Uncategorized' ? totalAmount : 0,
        percentage: name === 'Uncategorized' ? 100 : 0
      }))
    };
  }
}

/**
 * Categorize transactions for a user
 * @route GET /api/transactions/categories
 */
export const categorizeTransactions = async (req, res) => {
  try {
    const uuid = req.user.uuid; // From auth middleware
    
    // Get all user transactions with type information
    const query = 'SELECT id, title, description, amount, type FROM transactions WHERE uuid = $1';
    const { rows } = await pool.query(query, [uuid]);
    
    if (rows.length === 0) {
      return res.status(StatusCodes.OK).json({
        success: true,
        message: 'No transactions to categorize',
        data: {
          categories: REQUIRED_SPECIFIC_CATEGORIES.map(name => ({
            name,
            amount: 0,
            percentage: 0
          }))
        }
      });
    }

    // Process transactions to get categorized data
    const categorizedData = await processTransactionsWithLLM(rows);

    return res.status(StatusCodes.OK).json({
      success: true,
      message: 'Transactions categorized successfully',
      data: categorizedData
    });
  } catch (error) {
    console.error('Error categorizing transactions:', error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: 'Failed to categorize transactions'
    });
  }
};

export default categorizeTransactions;